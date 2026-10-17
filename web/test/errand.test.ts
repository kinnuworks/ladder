import { type Address, type Hex, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { buildTree, randomHex32, rungLeaf } from "../lib/core";
import { type RawErrand, type TransferLog, planCommitment, shapeErrand } from "../lib/errand";
import { decodePlanParam, encodePlanParam, planSchema } from "../lib/schema";
import { fixture, owner, runners } from "./helpers";

const STABLEPHONE = getAddress("0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801");
const MOSBIE = getAddress("0x4603366F72023572b139D19e354e9FA3A50c634B");
const POSTALFORM_ORDER = getAddress("0x9999999999999999999999999999999999999999");
const STRANGER = getAddress("0x00000000000000000000000000000000000bad01");

let n = 0;
const t = (from: Address, to: Address, value: bigint, block: bigint): TransferLog => ({
  from,
  to,
  value,
  tx: `0x${(++n).toString(16).padStart(64, "0")}` as Hex,
  block,
  logIndex: 0,
});

function raw(over: Partial<RawErrand> = {}): RawErrand {
  const { errand, terms, plan } = fixture(1_800_000_000);
  return {
    address: errand,
    now: 1_800_000_000,
    latestBlock: 1_000n,
    latestTime: 1_800_000_000,
    state: { owner: owner.address, sessionSigner: terms.sessionSigner, expiry: terms.expiry, closed: false, rungsRoot: terms.rungsRoot },
    balance: 0n,
    opened: { tx: `0x${"ab".repeat(32)}`, block: 101n },
    transfersIn: [],
    transfersOut: [],
    runnerTransfers: [],
    plan: planSchema.parse(plan),
    planError: null,
    ...over,
  };
}

describe("errand timeline shaping", () => {
  it("labels funding, releases, rail payments, sweeps and refunds", () => {
    const base = raw();
    const e = base.address;
    const v = shapeErrand({
      ...base,
      balance: 0n,
      transfersIn: [t(owner.address, e, 30_000_000n, 100n)],
      transfersOut: [
        t(e, runners.phone, 540_000n, 200n),
        t(e, runners.mail, 14_400_000n, 300n),
        t(e, owner.address, 15_060_000n, 500n),
      ],
      runnerTransfers: [
        t(runners.phone, STABLEPHONE, 540_000n, 201n),
        t(runners.mail, POSTALFORM_ORDER, 12_900_000n, 301n),
        t(runners.mail, owner.address, 1_500_000n, 400n),
      ],
      state: { ...base.state!, closed: true },
    });
    expect(v.status).toBe("closed");
    expect(v.funded).toBe("30000000");
    expect(v.fundedUsd).toBe("$30.00");
    expect(v.flags).toEqual([]);
    expect(v.timeline.map((r) => [r.kind, r.toLabel])).toEqual([
      ["fund", "Errand"],
      ["release", "Runner 1"],
      ["rail-payment", "StablePhone call"],
      ["release", "Runner 3"],
      ["rail-payment", "PostalForm order deposit"],
      ["sweep", "Owner"],
      ["refund", "Owner"],
    ]);
    expect(v.timeline.every((r) => r.txUrl.startsWith("https://basescan.org/tx/0x"))).toBe(true);
    expect(v.rungs.map((r) => r.state)).toEqual(["paid", "unused", "paid"]);
    expect(v.rungs[2]!.checks.every((c) => c.ok)).toBe(true);
    expect(v.plan).toEqual({ business: "Northside Gym" });
  });

  it("flags an errand payment to an address that is not a planned runner", () => {
    const base = raw();
    const v = shapeErrand({ ...base, transfersOut: [t(base.address, STRANGER, 1_000_000n, 200n)] });
    expect(v.timeline[0]!.flagged).toBe(true);
    expect(v.timeline[0]!.kind).toBe("unknown");
    expect(v.flags).toHaveLength(1);
  });

  it("flags a runner that pays someone other than its rail", () => {
    const base = raw();
    const v = shapeErrand({
      ...base,
      transfersOut: [t(base.address, runners.phone, 540_000n, 200n)],
      runnerTransfers: [t(runners.phone, MOSBIE, 540_000n, 201n)],
    });
    expect(v.timeline.find((r) => r.kind === "unknown")?.flagged).toBe(true);
    expect(v.flags[0]).toMatch(/not the StablePhone rail/);
  });

  it("flags a release above the planned cap", () => {
    const base = raw();
    const v = shapeErrand({ ...base, transfersOut: [t(base.address, runners.phone, 600_000n, 200n)] });
    expect(v.timeline[0]!.flagged).toBe(true);
    expect(v.rungs[0]!.checks[0]!.ok).toBe(false);
  });

  it("without a plan shows errand-level transfers only, unflagged", () => {
    const base = raw({ plan: null });
    const v = shapeErrand({
      ...base,
      transfersIn: [t(owner.address, base.address, 5_000_000n, 100n)],
      transfersOut: [t(base.address, runners.phone, 540_000n, 200n)],
    });
    expect(v.runnersKnown).toBe(false);
    expect(v.rungs).toEqual([]);
    expect(v.timeline.map((r) => r.kind)).toEqual(["fund", "release"]);
    expect(v.flags).toEqual([]);
  });

  it("reports an errand that is not deployed yet", () => {
    const v = shapeErrand(raw({ state: null, opened: null }));
    expect(v.status).toBe("not-opened");
    expect(v.terms).toBeNull();
    expect(v.expiresIn).toBeNull();
  });

  it("is JSON-serialisable", () => {
    expect(() => JSON.stringify(shapeErrand(raw()))).not.toThrow();
  });
});

describe("plan links", () => {
  it("round-trip and keep only public fields", () => {
    const { plan } = fixture();
    const parsed = planSchema.parse(plan);
    const back = decodePlanParam(encodePlanParam(parsed));
    expect(back.error).toBeNull();
    expect(back.plan).toEqual(parsed);
    const withExtras = planSchema.parse({ ...plan, goal: "Cancel the gym membership", replyEmail: "sam@example.com" });
    expect(Buffer.from(encodePlanParam(withExtras), "base64url").toString()).not.toMatch(/goal|Cancel|example\.com/);
  });

  it("report a broken plan without throwing", () => {
    expect(decodePlanParam("not-json").error).toMatch(/decoded/);
    expect(decodePlanParam(Buffer.from('{"rungs":[]}').toString("base64url")).error).toMatch(/shape/);
  });
});

describe("plan labels against the on-chain commitment", () => {
  function committed() {
    const { plan } = fixture();
    const rungs = plan.rungs.map((r) => ({ ...r, nonce: randomHex32(), salt: randomHex32() }));
    const { root } = buildTree(rungs.map((r) => rungLeaf({ nonce: r.nonce, to: r.to, max: BigInt(r.max), salt: r.salt })));
    return { plan: planSchema.parse({ business: plan.business, rungs }), root };
  }

  it("matches when every rung carries nonce and salt and the root agrees", () => {
    const { plan, root } = committed();
    expect(planCommitment(plan, root)).toBe("matches");
    const base = raw();
    const v = shapeErrand({ ...base, plan, state: { ...base.state!, rungsRoot: root } });
    expect(v.planCommitment).toBe("matches");
    expect(v.flags).toEqual([]);
  });

  it("flags a plan whose rungs differ from the commitment", () => {
    const { plan, root } = committed();
    const tampered = { ...plan, rungs: plan.rungs.map((r, i) => (i === 0 ? { ...r, max: "540001" } : r)) };
    expect(planCommitment(tampered, root)).toBe("mismatch");
    const base = raw();
    const v = shapeErrand({ ...base, plan: tampered, state: { ...base.state!, rungsRoot: root } });
    expect(v.planCommitment).toBe("mismatch");
    expect(v.flags.some((f) => /does not match the rungs/.test(f))).toBe(true);
  });

  it("flags a reordered plan", () => {
    const { plan, root } = committed();
    expect(planCommitment({ ...plan, rungs: [...plan.rungs].reverse() }, root)).toBe("mismatch");
  });

  it("calls labels unverified without nonce and salt, or before the errand is opened", () => {
    const { plan, root } = committed();
    const bare = planSchema.parse({ business: plan.business, rungs: plan.rungs.map(({ nonce, salt, ...r }) => r) });
    expect(planCommitment(bare, root)).toBe("unverified");
    expect(planCommitment(plan, null)).toBe("unverified");
    expect(shapeErrand(raw({ plan: bare })).planCommitment).toBe("unverified");
  });

  it("accepts the plugin's link shape", () => {
    const { plan } = committed();
    const link = Buffer.from(JSON.stringify({ business: plan.business, rungs: plan.rungs })).toString("base64url");
    const back = decodePlanParam(link);
    expect(back.error).toBeNull();
    expect(back.plan!.rungs[0]!.nonce).toBe(plan.rungs[0]!.nonce);
  });
});

describe("funded but never opened", () => {
  it("is reported when USDC sits at an address with no errand contract", () => {
    const v = shapeErrand(raw({ state: null, opened: null, balance: 16_080_000n }));
    expect(v.fundedButNotOpened).toBe(true);
    expect(shapeErrand(raw({ state: null, opened: null, balance: 0n })).fundedButNotOpened).toBe(false);
  });
});
