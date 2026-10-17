// End-to-end against a local fork of Base: deploy the real factory, fund an errand before it
// exists, then pay a rung through real USDC using signatures made by core.ts.
// Needs anvil and forge (Foundry). Skips when LADDER_INTEROP is not set.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createPublicClient, createWalletClient, http, parseAbi, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  USDC,
  buildTree,
  newSessionKey,
  predictErrand,
  randomHex32,
  rungLeaf,
  signRefund,
  signRungPayment,
  type Rung,
} from "../src/core.ts";

const runner = () => { const k = newSessionKey(); return { to: k.address, runnerKey: k.privateKey }; };
const enabled = !!process.env.LADDER_INTEROP;
const RPC = "http://127.0.0.1:8547";
// anvil's first default account
const DEPLOYER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const _PHONE = getAddress("0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801");
const MAIL = getAddress("0x3ea31de08708a6eb65f345719e6b1cdb72df0406");

let anvil: ChildProcess | undefined;
let factory: Address;
let implementation: Address;

const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
]);
const factoryAbi = parseAbi([
  "function predict(address,address,uint64,bytes32) view returns (address)",
  "function open(address,address,uint64,bytes32) returns (address)",
  "function implementation() view returns (address)",
]);
const errandAbi = parseAbi(["function refundWithSig(bytes)", "function closed() view returns (bool)"]);

const pub = createPublicClient({ chain: base, transport: http(RPC) });
const wallet = createWalletClient({ chain: base, transport: http(RPC), account: privateKeyToAccount(DEPLOYER_KEY) });

async function waitForRpc() {
  for (let i = 0; i < 60; i++) {
    try {
      await pub.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("anvil did not start");
}

async function giveUsdc(to: Address, amount: bigint) {
  // FiatToken stores balances in mapping slot 9.
  const { keccak256, encodeAbiParameters, parseAbiParameters, toHex } = await import("viem");
  const slot = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [to, 9n]));
  await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setStorageAt", params: [USDC, slot, toHex(amount, { size: 32 })] }),
  });
}

before(async () => {
  if (!enabled) return;
  anvil = spawn("anvil", ["--fork-url", process.env.BASE_RPC_URL ?? "https://mainnet.base.org", "--port", "8547", "--silent"], {
    stdio: "ignore",
  });
  await waitForRpc();
  const out = execFileSync(
    "forge",
    ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--private-key", DEPLOYER_KEY, "--broadcast"],
    { cwd: new URL("../../contracts", import.meta.url).pathname, encoding: "utf8" },
  );
  factory = getAddress(/ErrandFactory (0x[0-9a-fA-F]{40})/.exec(out)![1]!);
  implementation = getAddress(/Errand implementation (0x[0-9a-fA-F]{40})/.exec(out)![1]!);
});

after(() => anvil?.kill());

test("core.ts and the deployed contracts agree end to end", { skip: !enabled }, async () => {
  const session = newSessionKey();
  const owner = newSessionKey().address;
  const rungs: Rung[] = [
    { rail: "phone", label: "AI call", ...runner(), max: 540_000n, nonce: randomHex32(), salt: randomHex32() },
    { rail: "mail", label: "Certified letter", ...runner(), max: 14_400_000n, nonce: randomHex32(), salt: randomHex32() },
  ];
  const { root, proofs } = buildTree(rungs.map(rungLeaf));
  const block = await pub.getBlock();
  const terms = { factory, implementation, owner, sessionSigner: session.address, expiry: Number(block.timestamp) + 86_400, rungsRoot: root };

  const predicted = predictErrand(terms);
  const onchain = await pub.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "predict",
    args: [owner, session.address, BigInt(terms.expiry), root],
  });
  assert.equal(predicted, onchain, "the plugin and the factory compute the same errand address");

  await giveUsdc(predicted, 20_000_000n);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: factory, abi: factoryAbi, functionName: "open", args: [owner, session.address, BigInt(terms.expiry), root] }),
  });

  const validBefore = block.timestamp + 300n;
  const { authorization: a, signature } = await signRungPayment({
    errand: predicted,
    rung: rungs[0]!,
    proof: proofs[0]!,
    value: 540_000n,
    validBefore,
    sessionKey: session.privateKey,
  });
  const PHONE = rungs[0]!.to;
  const before = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [PHONE] });
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "transferWithAuthorization",
      args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, signature],
    }),
  });
  const after = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [PHONE] });
  assert.equal(after - before, 540_000n, "real USDC paid the committed rung from the errand");

  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: predicted, abi: errandAbi, functionName: "refundWithSig", args: [await signRefund(predicted, session.privateKey)] }),
  });
  assert.equal(await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [owner] }), 20_000_000n - 540_000n);
  assert.equal(await pub.readContract({ address: predicted, abi: errandAbi, functionName: "closed" }), true);
});
