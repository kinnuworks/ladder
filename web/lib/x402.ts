// x402 for the funding endpoint: payment requirements (v2 header plus v1 JSON body), payment
// header decoding for both versions, and the checks made before anything touches the chain.
// Pure functions; the route does the I/O.
import { type Address, type Hex, getAddress } from "viem";
import { CHAIN_ID, USDC } from "./core";
import { authorizationSchema, hexBytes, type ParsedAuthorization } from "./schema";

export const NETWORK_V2 = `eip155:${CHAIN_ID}` as const;
export const NETWORK_V1 = "base" as const;
export const MAX_TIMEOUT_SECONDS = 300;
export const USDC_EXTRA = { name: "USD Coin", version: "2" } as const;
/** Seconds of headroom a payment must still have, so it cannot expire while we settle it. */
export const SETTLE_HEADROOM_SECONDS = 6;

export const HEADER_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_V1_PAYMENT = "X-PAYMENT";
export const HEADER_RESPONSE = "PAYMENT-RESPONSE";
export const HEADER_V1_RESPONSE = "X-PAYMENT-RESPONSE";

export type ErrorReason =
  | "invalid_x402_version"
  | "invalid_scheme"
  | "invalid_network"
  | "invalid_payload"
  | "invalid_payment_requirements"
  | "invalid_exact_evm_payload_recipient_mismatch"
  | "invalid_exact_evm_payload_authorization_value_mismatch"
  | "invalid_exact_evm_payload_authorization_from_mismatch"
  | "invalid_exact_evm_payload_authorization_valid_after"
  | "invalid_exact_evm_payload_authorization_valid_before"
  | "invalid_exact_evm_payload_signature"
  | "invalid_transaction_state"
  | "unexpected_settle_error";

export interface RequirementInput {
  errand: Address;
  budget: bigint;
  resource: string;
  description: string;
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeHeader(value: string): unknown {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) throw new Error("Payment header is not base64.");
  return JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
}

export function requirementsV2(r: RequirementInput, error?: string) {
  return {
    x402Version: 2 as const,
    ...(error ? { error } : {}),
    resource: { url: r.resource, description: r.description, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact" as const,
        network: NETWORK_V2,
        amount: r.budget.toString(),
        asset: USDC,
        payTo: r.errand,
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        extra: { ...USDC_EXTRA },
      },
    ],
  };
}

export function requirementsV1(r: RequirementInput, error?: string) {
  return {
    x402Version: 1 as const,
    ...(error ? { error } : {}),
    accepts: [
      {
        scheme: "exact" as const,
        network: NETWORK_V1,
        maxAmountRequired: r.budget.toString(),
        resource: r.resource,
        description: r.description,
        mimeType: "application/json",
        payTo: r.errand,
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        asset: USDC,
        extra: { ...USDC_EXTRA },
      },
    ],
  };
}

/** The 402 response parts: the v2 header value and the v1-compatible JSON body. */
export function paymentRequired(r: RequirementInput, error?: string) {
  return { header: encodeHeader(requirementsV2(r, error)), body: requirementsV1(r, error) };
}

export interface DecodedPayment {
  version: 1 | 2;
  authorization: ParsedAuthorization;
  signature: Hex;
}

export type PaymentRead =
  | { kind: "none" }
  | { kind: "malformed"; message: string }
  | { kind: "invalid"; version: 1 | 2; reason: ErrorReason; message: string }
  | { kind: "ok"; payment: DecodedPayment };

type HeaderSource = { get(name: string): string | null };

/** Read `PAYMENT-SIGNATURE` (v2) or `X-PAYMENT` (v1) and check its scheme, network and fields. */
export function readPayment(headers: HeaderSource): PaymentRead {
  const v2 = headers.get(HEADER_SIGNATURE);
  const v1 = headers.get(HEADER_V1_PAYMENT);
  const raw = v2 ?? v1;
  if (!raw) return { kind: "none" };
  const expected: 1 | 2 = v2 ? 2 : 1;

  let decoded: unknown;
  try {
    decoded = decodeHeader(raw);
  } catch {
    return { kind: "malformed", message: "The payment header is not base64-encoded JSON." };
  }
  if (!decoded || typeof decoded !== "object") return { kind: "malformed", message: "The payment header is not a JSON object." };
  const p = decoded as Record<string, unknown>;

  if (p.x402Version !== expected) {
    return { kind: "invalid", version: expected, reason: "invalid_x402_version", message: `Expected x402Version ${expected} in ${expected === 2 ? HEADER_SIGNATURE : HEADER_V1_PAYMENT}.` };
  }
  let scheme: unknown;
  let network: unknown;
  if (expected === 2) {
    const accepted = p.accepted as Record<string, unknown> | undefined;
    if (!accepted || typeof accepted !== "object") {
      return { kind: "invalid", version: 2, reason: "invalid_payload", message: "The v2 payment has no accepted requirements." };
    }
    scheme = accepted.scheme;
    network = accepted.network;
    if (typeof accepted.asset === "string" && accepted.asset.toLowerCase() !== USDC.toLowerCase()) {
      return { kind: "invalid", version: 2, reason: "invalid_payment_requirements", message: "The payment is not in Base USDC." };
    }
  } else {
    scheme = p.scheme;
    network = p.network;
  }
  if (scheme !== "exact") return { kind: "invalid", version: expected, reason: "invalid_scheme", message: "Only the exact scheme is accepted." };
  if (network !== (expected === 2 ? NETWORK_V2 : NETWORK_V1)) {
    return { kind: "invalid", version: expected, reason: "invalid_network", message: "Only Base mainnet is accepted." };
  }

  const inner = p.payload as Record<string, unknown> | undefined;
  const auth = authorizationSchema.safeParse(inner?.authorization);
  const sig = hexBytes.safeParse(inner?.signature);
  if (!auth.success || !sig.success || sig.data.length < 4) {
    return { kind: "invalid", version: expected, reason: "invalid_payload", message: "The payment payload needs an EIP-3009 authorization and a signature." };
  }
  return { kind: "ok", payment: { version: expected, authorization: auth.data, signature: sig.data } };
}

export type AuthorizationCheck = { ok: true } | { ok: false; reason: ErrorReason; message: string };

/** The checks the spec requires before verifying the signature: recipient, amount, payer, window. */
export function checkAuthorization(
  a: ParsedAuthorization,
  expected: { errand: Address; budget: bigint; owner: Address },
  nowSeconds: number,
): AuthorizationCheck {
  if (getAddress(a.to) !== getAddress(expected.errand)) {
    return { ok: false, reason: "invalid_exact_evm_payload_recipient_mismatch", message: "The payment is not to this errand's address." };
  }
  if (BigInt(a.value) !== expected.budget) {
    return { ok: false, reason: "invalid_exact_evm_payload_authorization_value_mismatch", message: "The payment amount is not the budget." };
  }
  if (getAddress(a.from) !== getAddress(expected.owner)) {
    return { ok: false, reason: "invalid_exact_evm_payload_authorization_from_mismatch", message: "The payer is not the errand's owner." };
  }
  const now = BigInt(Math.floor(nowSeconds));
  if (BigInt(a.validAfter) > now) {
    return { ok: false, reason: "invalid_exact_evm_payload_authorization_valid_after", message: "The payment is not valid yet." };
  }
  if (BigInt(a.validBefore) <= now + BigInt(SETTLE_HEADROOM_SECONDS)) {
    return { ok: false, reason: "invalid_exact_evm_payload_authorization_valid_before", message: "The payment authorization has expired." };
  }
  return { ok: true };
}

export function settlementResponse(s: { success: boolean; transaction: Hex | ""; payer: Address; errorReason?: ErrorReason }) {
  return {
    success: s.success,
    ...(s.errorReason ? { errorReason: s.errorReason } : {}),
    transaction: s.transaction,
    network: NETWORK_V2,
    payer: s.payer,
  };
}
