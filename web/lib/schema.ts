// Request and plan shapes, validated at the edge of every route.
import { type Address, type Hex, getAddress, isAddress } from "viem";
import * as z from "zod/v4";
import type { Terms } from "./core";
import { RAIL_IDS, railById } from "./rails";

export const address = z
  .string()
  .refine((s) => isAddress(s, { strict: false }), "Not an address.")
  .transform((s) => getAddress(s) as Address);
export const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected 32 bytes of hex.")
  .transform((s) => s.toLowerCase() as Hex);
export const hexBytes = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/, "Expected hex bytes.")
  .transform((s) => s as Hex);
export const uintString = z.string().regex(/^(0|[1-9][0-9]{0,77})$/, "Expected a non-negative integer string.");

export const termsSchema = z
  .object({
    factory: address,
    implementation: address,
    owner: address,
    sessionSigner: address,
    expiry: z.number().int().positive().max(2 ** 63),
    rungsRoot: bytes32,
  })
  .strict() satisfies z.ZodType<Terms, unknown>;

export const planRungSchema = z.object({
  rail: z.enum(RAIL_IDS as [string, ...string[]]),
  label: z.string().max(200),
  /** The rung's one-time runner address. */
  to: address,
  max: uintString,
});

export const planSchema = z.object({
  v: z.literal(1).optional(),
  goal: z.string().max(500),
  business: z.string().max(200).optional(),
  errand: address.optional(),
  rungs: z.array(planRungSchema).min(1).max(16),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanRung = Plan["rungs"][number];

export const fundBodySchema = z.object({
  terms: termsSchema,
  budget: z.string().regex(/^[1-9][0-9]{0,19}$/, "Budget is atomic USDC, a positive integer string."),
  plan: planSchema,
});

export type FundBody = z.infer<typeof fundBodySchema>;

export const authorizationSchema = z.object({
  from: address,
  to: address,
  value: uintString,
  validAfter: uintString,
  validBefore: uintString,
  nonce: bytes32,
});

export type ParsedAuthorization = z.infer<typeof authorizationSchema>;

export const refundBodySchema = z.object({ errand: address, sessionSig: hexBytes });
export const moveBodySchema = z.object({ errand: address, authorization: authorizationSchema, signature: hexBytes });
export const sweepBodySchema = z.object({
  errand: address,
  runner: address,
  authorization: authorizationSchema,
  signature: hexBytes,
});

/** Decode a `?plan=` value: base64url of the plan JSON. */
export function decodePlanParam(value: string | undefined | null): { plan: Plan | null; error: string | null } {
  if (!value) return { plan: null, error: null };
  try {
    const json = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = planSchema.safeParse(json);
    if (!parsed.success) return { plan: null, error: "The plan in this link is not in the expected shape." };
    return { plan: parsed.data, error: null };
  } catch {
    return { plan: null, error: "The plan in this link could not be decoded." };
  }
}

export function encodePlanParam(plan: Plan): string {
  return Buffer.from(JSON.stringify(plan)).toString("base64url");
}

/** Problems with a plan's rungs against the rail caps. Empty when the plan is acceptable. */
export function planRungIssues(plan: Plan): string[] {
  const issues: string[] = [];
  const runners = new Set<string>();
  plan.rungs.forEach((r, i) => {
    const rail = railById(r.rail);
    if (!rail) {
      issues.push(`Rung ${i + 1} uses an unknown rail.`);
      return;
    }
    if (BigInt(r.max) === 0n) issues.push(`Rung ${i + 1} has a zero cap.`);
    if (BigInt(r.max) > rail.cap) issues.push(`Rung ${i + 1} (${rail.name}) caps at ${r.max}, above the rail cap of ${rail.cap}.`);
    if (runners.has(r.to)) issues.push(`Rung ${i + 1} reuses a runner address.`);
    runners.add(r.to);
  });
  return issues;
}

export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.path.join(".") || "body"}: ${i.message}` : "Invalid request.";
}
