// Policy checks on a funding request, before any 402 is issued. Pure.
import type { Address } from "viem";
import { predictErrand, type Terms } from "./core";
import { type FundBody, type Plan, fundBodySchema, firstIssue, planRungIssues } from "./schema";

export const MAX_BUDGET = 100_000_000n; // 100 USDC
export const MIN_BUDGET = 1_000_000n; // 1 USDC
export const MAX_EXPIRY_SECONDS = 30 * 86_400;
/** An errand must have at least this long left, or factory.open could revert during settlement. */
export const MIN_EXPIRY_SECONDS = 600;

export type FundCheck =
  | { ok: true; terms: Terms; budget: bigint; plan: Plan; errand: Address }
  | { ok: false; status: 400; message: string };

export function checkFundRequest(
  body: unknown,
  cfg: { factory: Address; implementation: Address },
  nowSeconds: number,
): FundCheck {
  const parsed = fundBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, message: firstIssue(parsed.error) };
  const { terms: input, plan } = parsed.data as FundBody;
  const budget = BigInt(parsed.data.budget);

  if (input.factory && input.factory !== cfg.factory) return { ok: false, status: 400, message: "terms.factory is not the Ladder factory." };
  if (input.implementation && input.implementation !== cfg.implementation) {
    return { ok: false, status: 400, message: "terms.implementation is not the Ladder errand implementation." };
  }
  const terms: Terms = { ...input, factory: cfg.factory, implementation: cfg.implementation };
  if (terms.expiry <= nowSeconds + MIN_EXPIRY_SECONDS) return { ok: false, status: 400, message: "The errand expiry is in the past or too close." };
  if (terms.expiry > nowSeconds + MAX_EXPIRY_SECONDS) return { ok: false, status: 400, message: "The errand expiry is more than 30 days out." };
  if (budget > MAX_BUDGET) return { ok: false, status: 400, message: "The budget is over 100 USDC." };
  if (budget < MIN_BUDGET) return { ok: false, status: 400, message: "The budget is under 1 USDC." };

  const issues = planRungIssues(plan);
  if (issues.length) return { ok: false, status: 400, message: issues[0]! };
  const caps = parsed.data.plan.rungs.reduce((t, r) => t + BigInt(r.max), 0n);
  if (budget < caps) return { ok: false, status: 400, message: "The budget is below the total of the step caps, so a later step could not be released." };

  const errand = predictErrand(terms);
  if (plan.errand && plan.errand !== errand) return { ok: false, status: 400, message: "plan.errand does not match the terms." };
  return { ok: true, terms, budget, plan, errand };
}
