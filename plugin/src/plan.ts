// Turns a request into committed rungs, terms and an errand key.
import { getAddress, type Address } from "viem";
import { buildTree, encodeErrandKey, newSessionKey, predictErrand, randomHex32, rungLeaf, type Brief, type Rung, type RailId } from "./core.js";
import { FACTORY, IMPLEMENTATION } from "./config.js";
import { RAILS } from "./rails.js";

export interface PlannedRung {
  step: number;
  rail: RailId;
  label: string;
  payee: string;
  /** The step's one-time key; the only address the errand can pay for this step. */
  runner: Address;
  capUsd: string;
}

export interface Plan {
  errand: Address;
  budgetUsd: string;
  expiresAt: string;
  rungs: PlannedRung[];
  key: string;
}

const usd = (atomic: bigint) => (Number(atomic) / 1e6).toFixed(2);

/** The ladder for a brief: AI call, follow-up AI call, human caller, certified letter. */
export function rungsFor(brief: Brief, include: RailId[]): Rung[] {
  const out: Rung[] = [];
  const add = (rail: RailId, label: string) => {
    const runner = newSessionKey();
    out.push({ rail, label, to: runner.address, max: RAILS[rail].cap, nonce: randomHex32(), salt: randomHex32(), runnerKey: runner.privateKey });
  };
  if (include.includes("phone") && brief.business.phone) {
    add("phone", `AI call to ${brief.business.name}`);
    add("phone", `Follow-up AI call to ${brief.business.name}`);
  }
  if (include.includes("human") && brief.business.phone && brief.replyEmail) add("human", `A person calls ${brief.business.name}`);
  if (include.includes("mail") && brief.business.address && brief.sender && brief.replyEmail) add("mail", `Certified letter with return receipt to ${brief.business.name}`);
  if (out.length === 0) throw new Error("No rung fits this business: give a US phone number, an email, or a US postal address.");
  return out;
}

export function makePlan(input: { owner: string; brief: Brief; include: RailId[]; budgetUsd: number; hours: number }): Plan {
  const owner = getAddress(input.owner);
  const rungs = rungsFor(input.brief, input.include);
  const { root } = buildTree(rungs.map(rungLeaf));
  const session = newSessionKey();
  const expiry = Math.floor(Date.now() / 1000) + Math.round(input.hours * 3600);
  const terms = { factory: FACTORY, implementation: IMPLEMENTATION, owner, sessionSigner: session.address, expiry, rungsRoot: root };
  const budget = BigInt(Math.round(input.budgetUsd * 1e6));
  const errand = predictErrand(terms);
  const key = encodeErrandKey({
    v: 1,
    terms,
    sessionKey: session.privateKey,
    rungs: rungs.map((r) => ({ ...r, max: r.max.toString() })),
    budget: budget.toString(),
    brief: input.brief,
  });
  return {
    errand,
    budgetUsd: usd(budget),
    expiresAt: new Date(expiry * 1000).toISOString(),
    rungs: rungs.map((r, i) => ({ step: i + 1, rail: r.rail, label: r.label, payee: RAILS[r.rail].name, runner: r.to, capUsd: usd(r.max) })),
    key,
  };
}
