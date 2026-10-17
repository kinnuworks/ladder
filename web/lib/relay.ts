// Everything the relayer sends: funding settlement, factory.open, rung releases (move), and the
// finish bundle (runner sweeps to the owner, then the errand refund). Each transaction is
// simulated before it is sent.
import {
  type Address,
  type Hex,
  type Log,
  encodeAbiParameters,
  formatUnits,
  getAddress,
  keccak256,
  parseAbiParameters,
  parseSignature,
  recoverAddress,
  verifyTypedData,
} from "viem";
import { CHAIN_ID, REFUND_TYPEHASH, USDC, type Terms } from "./core";
import { errandAbi, factoryAbi, publicClient, relayer, usdcAbi } from "./chain";
import { RelayError } from "./errors";
import type { ParsedAuthorization, Sweep } from "./schema";

export { RelayError };

const FUND_RECEIPT_TIMEOUT_MS = 60_000;
export const MOVE_RECEIPT_TIMEOUT_MS = 4_000;

const transferTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function typedAuthorization(a: ParsedAuthorization) {
  return {
    domain: { name: "USD Coin", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: transferTypes,
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: a.from,
      to: a.to,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
      nonce: a.nonce,
    },
  };
}

/** Verify the payer's EIP-712 signature. Contract payers (ERC-1271, ERC-6492) go through the RPC. */
export async function verifyPayerSignature(a: ParsedAuthorization, signature: Hex): Promise<boolean> {
  const pub = publicClient();
  const code = await pub.getCode({ address: a.from });
  const typed = typedAuthorization(a);
  try {
    if ((code && code !== "0x") || signature.length !== 132) {
      return await pub.verifyTypedData({ address: a.from, signature, ...typed });
    }
    return await verifyTypedData({ address: a.from, signature, ...typed });
  } catch {
    return false;
  }
}

/** 65-byte signatures use the v,r,s overload of transferWithAuthorization; anything else the bytes one. */
export function transferArgs(a: ParsedAuthorization, signature: Hex) {
  const head = [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce] as const;
  if (signature.length === 132) {
    const s = parseSignature(signature);
    const v = s.v !== undefined ? Number(s.v) : 27 + (s.yParity ?? 0);
    return [...head, v, s.r, s.s] as const;
  }
  return [...head, signature] as const;
}

function short(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return (e?.shortMessage ?? e?.message ?? "unknown error").split("\n")[0]!.slice(0, 200);
}

async function simulateTransfer(a: ParsedAuthorization, signature: Hex) {
  const wallet = relayer();
  try {
    const { request } = await publicClient().simulateContract({
      account: wallet.account,
      address: USDC,
      abi: usdcAbi,
      functionName: "transferWithAuthorization",
      args: transferArgs(a, signature) as never,
    });
    return request;
  } catch (err) {
    throw new RelayError(`USDC would reject this transfer: ${short(err)}`, 422, "invalid_transaction_state");
  }
}

async function send(request: unknown, nonce?: number): Promise<Hex> {
  return relayer().writeContract({ ...(request as object), ...(nonce === undefined ? {} : { nonce }) } as never);
}

async function sendAndWait(request: unknown, timeout = FUND_RECEIPT_TIMEOUT_MS): Promise<{ tx: Hex; blockNumber: bigint; logs: Log[] }> {
  const tx = await send(request);
  const receipt = await publicClient().waitForTransactionReceipt({ hash: tx, timeout });
  if (receipt.status !== "success") throw new RelayError(`Transaction ${tx} reverted.`, 502, "unexpected_settle_error");
  return { tx, blockNumber: receipt.blockNumber, logs: receipt.logs };
}

async function hasCode(addr: Address): Promise<boolean> {
  const code = await publicClient().getCode({ address: addr });
  return !!code && code !== "0x";
}

// --- funding ----------------------------------------------------------------

/** Settle the funding payment and open the errand. Retrying an already-settled payment only opens. */
export async function settleFunding(input: {
  terms: Terms;
  errand: Address;
  budget: bigint;
  authorization: ParsedAuthorization;
  signature: Hex;
}): Promise<{ fundTx: Hex | null; openTx: Hex | null }> {
  const { terms, errand, budget, authorization: a, signature } = input;
  const pub = publicClient();

  // Never move money toward an errand that could not be opened afterwards.
  if (!(await hasCode(terms.factory))) {
    throw new RelayError("Ladder's factory is not deployed yet, so no errand can be funded.", 503);
  }

  const used = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "authorizationState", args: [a.from, a.nonce] });
  let fundTx: Hex | null = null;
  if (used) {
    const balance = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [errand] });
    if (balance < budget && !(await hasCode(errand))) {
      throw new RelayError("This payment authorization was already used.", 402, "invalid_transaction_state");
    }
  } else {
    if (!(await verifyPayerSignature(a, signature))) {
      throw new RelayError("The payment signature does not verify for the payer.", 402, "invalid_exact_evm_payload_signature");
    }
    fundTx = (await sendAndWait(await simulateTransfer(a, signature))).tx;
  }

  let openTx: Hex | null = null;
  if (!(await hasCode(errand))) {
    const { request } = await pub.simulateContract({
      account: relayer().account,
      address: terms.factory,
      abi: factoryAbi,
      functionName: "open",
      args: [terms.owner, terms.sessionSigner, BigInt(terms.expiry), terms.rungsRoot],
    });
    openTx = (await sendAndWait(request)).tx;
  }
  return { fundTx, openTx };
}

// --- move: release a rung to its runner -------------------------------------

/** Checks on a release before any RPC call. Returns an error message, or null when acceptable. */
export function checkMove(input: { errand: Address; authorization: ParsedAuthorization; signature: Hex }): string | null {
  if (input.authorization.from !== input.errand) return "authorization.from must be the errand.";
  if (BigInt(input.authorization.value) === 0n) return "A release must move more than zero.";
  if (input.signature.length === 132) return "A rung release carries the errand's ERC-1271 signature, not a 65-byte one.";
  return null;
}

/** Send the release and wait briefly. If it is not mined in time, report it as pending. */
export async function relayMove(input: { errand: Address; authorization: ParsedAuthorization; signature: Hex }) {
  const problem = checkMove(input);
  if (problem) throw new RelayError(problem, 400);
  const tx = await send(await simulateTransfer(input.authorization, input.signature));
  try {
    const receipt = await publicClient().waitForTransactionReceipt({ hash: tx, timeout: MOVE_RECEIPT_TIMEOUT_MS, pollingInterval: 500 });
    if (receipt.status !== "success") throw new RelayError(`Transaction ${tx} reverted.`, 502);
    return { tx, blockNumber: receipt.blockNumber, pending: false };
  } catch (err) {
    if (err instanceof RelayError) throw err;
    return { tx, blockNumber: null, pending: true };
  }
}

// --- finish: sweep runners to the owner, then refund ----------------------------

export function refundDigest(errand: Address): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32, address, uint256"), [REFUND_TYPEHASH, errand, BigInt(CHAIN_ID)]));
}

/**
 * Checks on a finish bundle. `received` holds the runners that have received USDC from this
 * errand, from Transfer logs. Returns an error message, or null when every sweep is acceptable.
 */
export function checkFinish(input: { owner: Address; sweeps: Sweep[]; received: ReadonlySet<Address> }): string | null {
  const seen = new Set<Address>();
  for (const [i, s] of input.sweeps.entries()) {
    const a = s.authorization;
    if (a.from !== s.runner) return `Sweep ${i + 1}: authorization.from must be the runner.`;
    if (a.to !== input.owner) return `Sweep ${i + 1}: a sweep can only pay the errand's owner.`;
    if (BigInt(a.value) === 0n) return `Sweep ${i + 1}: the amount must be more than zero.`;
    if (s.signature.length !== 132) return `Sweep ${i + 1}: a runner sweep needs a 65-byte signature.`;
    if (!input.received.has(s.runner)) return `Sweep ${i + 1}: this runner never received USDC from this errand.`;
    if (seen.has(s.runner)) return `Sweep ${i + 1}: this runner is swept twice.`;
    seen.add(s.runner);
  }
  return null;
}

export function usd2(atomic: bigint): string {
  return Number(formatUnits(atomic, 6)).toFixed(2);
}

/**
 * Relay the sweeps and the refund with consecutive nonces, without waiting for receipts.
 * `findReceived` returns the runners that have received USDC from the errand.
 */
export async function relayFinish(input: {
  errand: Address;
  sweeps: Sweep[];
  sessionSig: Hex;
  findReceived: (runners: Address[]) => Promise<Set<Address>>;
}): Promise<{ txs: Hex[]; refundedUsd: string }> {
  const pub = publicClient();
  const { errand, sweeps, sessionSig } = input;
  const [owner, signer, closed, balance] = await Promise.all([
    pub.readContract({ address: errand, abi: errandAbi, functionName: "owner" }).then(getAddress),
    pub.readContract({ address: errand, abi: errandAbi, functionName: "sessionSigner" }).then(getAddress),
    pub.readContract({ address: errand, abi: errandAbi, functionName: "closed" }),
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [errand] }),
  ]);

  let recovered: Address | null = null;
  try {
    recovered = await recoverAddress({ hash: refundDigest(errand), signature: sessionSig });
  } catch {
    // reported below
  }
  if (recovered !== signer) throw new RelayError("The refund signature is not from this errand's session signer.", 400);

  const received = sweeps.length ? await input.findReceived(sweeps.map((s) => s.runner)) : new Set<Address>();
  const problem = checkFinish({ owner, sweeps, received });
  if (problem) throw new RelayError(problem, 400);
  if (closed && sweeps.length === 0) throw new RelayError("This errand is already closed and there is nothing to sweep.", 409);

  const wallet = relayer();
  const requests = await Promise.all([
    ...sweeps.map((s) => simulateTransfer(s.authorization, s.signature)),
    ...(closed
      ? []
      : [
          pub
            .simulateContract({ account: wallet.account, address: errand, abi: errandAbi, functionName: "refundWithSig", args: [sessionSig] })
            .then((r) => r.request),
        ]),
  ]);

  const nonce = await pub.getTransactionCount({ address: wallet.account.address, blockTag: "pending" });
  const txs: Hex[] = [];
  for (const [i, request] of requests.entries()) txs.push(await send(request, nonce + i));

  const swept = sweeps.reduce((sum, s) => sum + BigInt(s.authorization.value), 0n);
  return { txs, refundedUsd: usd2((closed ? 0n : balance) + swept) };
}

/** Refund one expired errand with the permissionless refund(). Used by the cron route. */
export async function relayExpiredRefund(errand: Address): Promise<Hex> {
  const { request } = await publicClient().simulateContract({
    account: relayer().account,
    address: errand,
    abi: errandAbi,
    functionName: "refund",
  });
  return send(request);
}
