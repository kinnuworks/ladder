// Everything the relayer sends: funding settlement, factory.open, rung releases (move), runner
// sweeps and refunds. Each one is simulated first, then sent, then waited on.
import {
  type Address,
  type Hex,
  type Log,
  decodeEventLog,
  getAddress,
  parseSignature,
  recoverAddress,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  verifyTypedData,
} from "viem";
import { CHAIN_ID, REFUND_TYPEHASH, USDC, type Terms } from "./core";
import { errandAbi, factoryAbi, publicClient, relayer, usdcAbi } from "./chain";
import type { ParsedAuthorization } from "./schema";
import type { ErrorReason } from "./x402";

const RECEIPT_TIMEOUT_MS = 60_000;

export class RelayError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: ErrorReason,
  ) {
    super(message);
  }
}

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

function transferArgs(a: ParsedAuthorization, signature: Hex) {
  const head = [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce] as const;
  if (signature.length === 132) {
    const s = parseSignature(signature);
    const v = s.v !== undefined ? Number(s.v) : 27 + (s.yParity ?? 0);
    return [...head, v, s.r, s.s] as const;
  }
  return [...head, signature] as const;
}

async function sendTransferWithAuthorization(a: ParsedAuthorization, signature: Hex) {
  const pub = publicClient();
  const wallet = relayer();
  let request;
  try {
    ({ request } = await pub.simulateContract({
      account: wallet.account,
      address: USDC,
      abi: usdcAbi,
      functionName: "transferWithAuthorization",
      args: transferArgs(a, signature) as never,
    }));
  } catch (err) {
    throw new RelayError(`USDC would reject this transfer: ${short(err)}`, 422, "invalid_transaction_state");
  }
  const { tx, blockNumber } = await sendAndWait(request);
  return { tx, blockNumber };
}

async function sendAndWait(request: unknown): Promise<{ tx: Hex; blockNumber: bigint; logs: Log[] }> {
  const pub = publicClient();
  const wallet = relayer();
  const tx = await wallet.writeContract(request as never);
  const receipt = await pub.waitForTransactionReceipt({ hash: tx, timeout: RECEIPT_TIMEOUT_MS });
  if (receipt.status !== "success") throw new RelayError(`Transaction ${tx} reverted.`, 502, "unexpected_settle_error");
  return { tx, blockNumber: receipt.blockNumber, logs: receipt.logs };
}

function short(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return (e?.shortMessage ?? e?.message ?? "unknown error").split("\n")[0]!.slice(0, 200);
}

async function hasCode(addr: Address): Promise<boolean> {
  const code = await publicClient().getCode({ address: addr });
  return !!code && code !== "0x";
}

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
    fundTx = (await sendTransferWithAuthorization(a, signature)).tx;
  }

  let openTx: Hex | null = null;
  if (!(await hasCode(errand))) {
    const wallet = relayer();
    const { request } = await pub.simulateContract({
      account: wallet.account,
      address: terms.factory,
      abi: factoryAbi,
      functionName: "open",
      args: [terms.owner, terms.sessionSigner, BigInt(terms.expiry), terms.rungsRoot],
    });
    openTx = (await sendAndWait(request)).tx;
  }
  return { fundTx, openTx };
}

/** Release a rung: the errand's ERC-1271 signature authorizes a USDC transfer to the rung's runner. */
export async function relayMove(input: { errand: Address; authorization: ParsedAuthorization; signature: Hex }) {
  if (input.authorization.from !== input.errand) throw new RelayError("authorization.from must be the errand.", 400);
  if (input.signature.length === 132) throw new RelayError("A rung release carries the errand's ERC-1271 signature, not a 65-byte one.", 400);
  return sendTransferWithAuthorization(input.authorization, input.signature);
}

/** Return a runner's unspent USDC to the errand's owner with the runner's EIP-3009 signature. */
export async function relaySweep(input: { errand: Address; runner: Address; authorization: ParsedAuthorization; signature: Hex }) {
  const a = input.authorization;
  if (a.from !== input.runner) throw new RelayError("authorization.from must be the runner.", 400);
  if (input.signature.length !== 132) throw new RelayError("A runner sweep needs a 65-byte signature.", 400);
  const owner = getAddress(await publicClient().readContract({ address: input.errand, abi: errandAbi, functionName: "owner" }));
  if (a.to !== owner) throw new RelayError("A sweep can only pay the errand's owner.", 400);
  return sendTransferWithAuthorization(a, input.signature);
}

export function refundDigest(errand: Address): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32, address, uint256"), [REFUND_TYPEHASH, errand, BigInt(CHAIN_ID)]));
}

/** Relay refundWithSig. The contract sends everything to the owner; we only check the signer first. */
export async function relayRefund(input: { errand: Address; sessionSig: Hex }) {
  const pub = publicClient();
  const [signer, closed] = await Promise.all([
    pub.readContract({ address: input.errand, abi: errandAbi, functionName: "sessionSigner" }),
    pub.readContract({ address: input.errand, abi: errandAbi, functionName: "closed" }),
  ]);
  if (closed) throw new RelayError("This errand is already closed.", 409);
  let recovered: Address;
  try {
    recovered = await recoverAddress({ hash: refundDigest(input.errand), signature: input.sessionSig });
  } catch {
    throw new RelayError("The refund signature is malformed.", 400);
  }
  if (recovered !== getAddress(signer)) throw new RelayError("The refund signature is not from this errand's session signer.", 400);
  const wallet = relayer();
  const { request } = await pub.simulateContract({
    account: wallet.account,
    address: input.errand,
    abi: errandAbi,
    functionName: "refundWithSig",
    args: [input.sessionSig],
  });
  const sent = await sendAndWait(request);
  let refunded = 0n;
  for (const log of sent.logs) {
    if (getAddress(log.address) !== input.errand) continue;
    try {
      const ev = decodeEventLog({ abi: errandAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Refunded") refunded = ev.args.amount;
    } catch {
      // not a Refunded log
    }
  }
  return { tx: sent.tx, blockNumber: sent.blockNumber, refunded };
}
