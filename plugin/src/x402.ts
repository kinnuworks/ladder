// A small x402 client used by a step's runner key. The runner is an ordinary key, so services
// can both take its payment and let it sign in to read results.
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, USDC, randomHex32, siweMessage } from "./core.js";

export interface Requirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** The requirement exactly as the service sent it, echoed back as `accepted`. */
  raw: Record<string, unknown>;
}

export interface Challenge {
  version: 1 | 2;
  requirement: Requirement;
  resource?: unknown;
  body: any;
}

export class RailRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
const tob64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

function pickBase(accepts: any[], version: 1 | 2): Requirement | undefined {
  for (const a of accepts ?? []) {
    const network = String(a.network);
    if (a.scheme !== "exact" || (network !== "eip155:8453" && network !== "base")) continue;
    if (String(a.asset).toLowerCase() !== USDC.toLowerCase()) continue;
    return {
      scheme: "exact",
      network,
      amount: String(version === 2 ? a.amount : (a.maxAmountRequired ?? a.amount)),
      asset: a.asset,
      payTo: a.payTo,
      maxTimeoutSeconds: Number(a.maxTimeoutSeconds ?? 300),
      raw: a,
    };
  }
  return undefined;
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Read a 402 challenge from the v2 header, a v1 JSON body, or PostalForm's nested body. */
export async function readChallenge(res: Response): Promise<Challenge> {
  const body = await res
    .clone()
    .json()
    .catch(() => ({}));
  const header = res.headers.get("payment-required");
  const candidates = [header ? b64json(header) : undefined, body?.payment?.payment_required, body].filter(Boolean);
  for (const pr of candidates) {
    const version: 1 | 2 = pr.x402Version === 1 ? 1 : 2;
    const requirement = pickBase(pr.accepts, version);
    if (requirement) return { version, requirement, resource: pr.resource, body };
  }
  throw new RailRefused("NO_BASE_USDC_OPTION", "The service did not offer a Base USDC payment.");
}

const AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** A runner's EIP-3009 authorization, signed as an ordinary key. */
export async function signAsRunner(runnerKey: Hex, to: Address, value: bigint, validBefore: bigint) {
  const account = privateKeyToAccount(runnerKey);
  const authorization = {
    from: account.address,
    to,
    value: value.toString(),
    validAfter: "0",
    validBefore: validBefore.toString(),
    nonce: randomHex32(),
  };
  const signature = await account.signTypedData({
    domain: { name: "USD Coin", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value, validAfter: 0n, validBefore },
  });
  return { authorization, signature };
}

export interface Expectation {
  /** Pay only this address, when the service's payee is fixed. */
  payTo?: Address;
  /** Pay at most this many atomic USDC. */
  maxAmount: bigint;
}

export function checkChallenge(c: Challenge, expect: Expectation): { payTo: Address; amount: bigint } {
  const payTo = getAddress(c.requirement.payTo);
  const amount = BigInt(c.requirement.amount);
  if (expect.payTo && payTo !== expect.payTo) {
    throw new RailRefused("UNEXPECTED_PAYEE", `The service asked to be paid at ${payTo}, not its known address ${expect.payTo}.`);
  }
  if (amount > expect.maxAmount) {
    throw new RailRefused("OVER_STEP_CAP", `The service asked for $${(Number(amount) / 1e6).toFixed(2)}; this step is capped at $${(Number(expect.maxAmount) / 1e6).toFixed(2)}.`);
  }
  return { payTo, amount };
}

/** Repeat a request with the runner's payment attached. */
export async function payAsRunner(input: {
  url: string;
  method: "GET" | "POST";
  body?: unknown;
  challenge: Challenge;
  expect: Expectation;
  runnerKey: Hex;
  timeoutMs?: number;
}): Promise<{ status: number; body: any; transaction?: string; amount: bigint; payTo: Address }> {
  const { payTo, amount } = checkChallenge(input.challenge, input.expect);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + Math.min(input.challenge.requirement.maxTimeoutSeconds, 300));
  const { authorization, signature } = await signAsRunner(input.runnerKey, payTo, amount, validBefore);
  const { version, requirement, resource } = input.challenge;
  const payload =
    version === 2
      ? { x402Version: 2, ...(resource ? { resource } : {}), accepted: requirement.raw, payload: { signature, authorization } }
      : { x402Version: 1, scheme: "exact", network: requirement.network, payload: { signature, authorization } };
  const res = await fetchWithTimeout(
    input.url,
    {
      method: input.method,
      headers: { "content-type": "application/json", accept: "application/json", [version === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT"]: tob64(payload) },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    },
    input.timeoutMs ?? 6000,
  );
  const settlement = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  const body = await res.json().catch(() => ({}));
  if (res.status === 402) throw new RailRefused("PAYMENT_REJECTED", `The service rejected the payment: ${JSON.stringify(body).slice(0, 300)}`);
  return { status: res.status, body, transaction: settlement ? b64json(settlement)?.transaction : undefined, amount, payTo };
}

/** Probe a paid endpoint with the real request and return its challenge. */
export async function probe(url: string, method: "GET" | "POST", body?: unknown): Promise<Challenge> {
  const res = await fetchWithTimeout(
    url,
    { method, headers: { "content-type": "application/json", accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    4000,
  );
  if (res.status !== 402) {
    const text = await res.text().catch(() => "");
    throw new RailRefused("NOT_A_PAYMENT_CHALLENGE", `Expected a 402 from the service, got ${res.status}: ${text.slice(0, 200)}`);
  }
  return readChallenge(res);
}

/** GET a resource only the paying wallet may read (x402 sign-in-with-x), signed by the runner. */
export async function getAsRunner(url: string, runnerKey: Hex): Promise<{ status: number; body: any }> {
  const first = await fetchWithTimeout(url, { headers: { accept: "application/json" } }, 4000);
  if (first.status !== 402 && first.status !== 401) return { status: first.status, body: await first.json().catch(() => ({})) };
  const header = first.headers.get("payment-required");
  const pr = header ? b64json(header) : await first.json().catch(() => ({}));
  const ext = pr?.extensions?.["sign-in-with-x"];
  if (!ext?.info) throw new RailRefused("NO_SIGN_IN", "The service did not offer sign-in for this resource.");
  const account = privateKeyToAccount(runnerKey);
  const info = { ...ext.info, chainId: ext.info.chainId ?? "eip155:8453", type: ext.info.type ?? "eip191" };
  const signature = await account.signMessage({ message: siweMessage(info, account.address) });
  const res = await fetchWithTimeout(
    url,
    { headers: { accept: "application/json", "SIGN-IN-WITH-X": tob64({ ...info, address: account.address, signature }) } },
    4500,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
