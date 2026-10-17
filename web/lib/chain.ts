// Chain access: clients, ABIs, and the relayer's simulate-then-send pattern.
import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { ConfigError, readConfig, relayerKey } from "./config";

export const usdcAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
]);

export const factoryAbi = parseAbi([
  "event ErrandOpened(address indexed errand, address indexed owner, address sessionSigner, uint64 expiry, bytes32 rungsRoot)",
  "function predict(address owner, address sessionSigner, uint64 expiry, bytes32 rungsRoot) view returns (address)",
  "function open(address owner, address sessionSigner, uint64 expiry, bytes32 rungsRoot) returns (address)",
  "function implementation() view returns (address)",
]);

export const errandAbi = parseAbi([
  "event Refunded(address indexed to, uint256 amount, address indexed caller)",
  "function owner() view returns (address)",
  "function sessionSigner() view returns (address)",
  "function expiry() view returns (uint64)",
  "function closed() view returns (bool)",
  "function rungsRoot() view returns (bytes32)",
  "function factory() view returns (address)",
  "function refundWithSig(bytes sessionSig)",
  "function refund()",
]);

let cachedPublic: PublicClient | null = null;

export function publicClient(): PublicClient {
  if (cachedPublic) return cachedPublic;
  const { rpcUrl } = readConfig();
  if (!rpcUrl) throw new ConfigError("Server is missing BASE_RPC_URL.");
  cachedPublic = createPublicClient({ chain: base, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) }) as PublicClient;
  return cachedPublic;
}

export function relayer() {
  const key = relayerKey();
  const { rpcUrl } = readConfig();
  if (!key) throw new ConfigError("Server is missing RELAYER_PRIVATE_KEY.");
  if (!rpcUrl) throw new ConfigError("Server is missing BASE_RPC_URL.");
  const account = privateKeyToAccount(key);
  return createWalletClient({ chain: base, account, transport: http(rpcUrl, { timeout: 20_000, retryCount: 0 }) });
}

export function relayerAddress(): Address | null {
  const key = relayerKey();
  return key ? privateKeyToAccount(key).address : null;
}

/** EIP-1167 runtime code of an errand clone for this implementation. */
export function cloneRuntimeCode(implementation: Address): Hex {
  return `0x363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
}

/** True when `addr` is an errand clone of the configured implementation made by the configured factory. */
export async function isLadderErrand(addr: Address, cfg: { factory: Address; implementation: Address }): Promise<boolean> {
  const pub = publicClient();
  const code = await pub.getCode({ address: addr });
  if (!code || code.toLowerCase() !== cloneRuntimeCode(cfg.implementation)) return false;
  const factory = await pub.readContract({ address: addr, abi: errandAbi, functionName: "factory" });
  return getAddress(factory) === cfg.factory;
}

/** Short, non-sensitive reason from a viem error, for API responses. */
export function revertReason(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  const msg = e?.shortMessage ?? e?.message ?? "unknown error";
  return msg.split("\n")[0]!.slice(0, 300);
}
