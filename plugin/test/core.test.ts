import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Hex } from "viem";
import {
  buildTree,
  decodeErrandKey,
  encodeErrandKey,
  newSessionKey,
  predictErrand,
  randomHex32,
  rungLeaf,
  signRungPayment,
  verifyProof,
  type Rung,
} from "../src/core.ts";

const runner = () => { const k = newSessionKey(); return { to: k.address, runnerKey: k.privateKey }; };
const leaves = (n: number) => Array.from({ length: n }, () => randomHex32());

test("every leaf proves against the root, for trees of 1 to 9 leaves", () => {
  for (let n = 1; n <= 9; n++) {
    const ls = leaves(n);
    const { root, proofs } = buildTree(ls);
    ls.forEach((l, i) => assert.ok(verifyProof(proofs[i]!, root, l), `n=${n} i=${i}`));
    assert.ok(!verifyProof(proofs[0]!, root, randomHex32()));
  }
});

const rungs = (): Rung[] => [
  { rail: "phone", label: "AI call", ...runner(), max: 540_000n, nonce: randomHex32(), salt: randomHex32() },
  { rail: "human", label: "Human call", ...runner(), max: 15_000_000n, nonce: randomHex32(), salt: randomHex32() },
];

function key() {
  const s = newSessionKey();
  const rs = rungs();
  const { root } = buildTree(rs.map(rungLeaf));
  const terms = {
    factory: getAddress("0x1111111111111111111111111111111111111111"),
    implementation: getAddress("0x2222222222222222222222222222222222222222"),
    owner: getAddress("0x3333333333333333333333333333333333333333"),
    sessionSigner: s.address,
    expiry: 2_000_000_000,
    rungsRoot: root,
  };
  return { s, rs, terms, encoded: encodeErrandKey({ v: 1, terms, sessionKey: s.privateKey, rungs: rs.map((r) => ({ ...r, max: r.max.toString() })) }) };
}

test("an errand key round-trips and re-derives its address", () => {
  const { encoded, terms } = key();
  const d = decodeErrandKey(encoded);
  assert.equal(d.errand, predictErrand(terms));
  assert.equal(d.rungs[1]!.max, 15_000_000n);
});

test("a tampered errand key is rejected", () => {
  const { encoded } = key();
  const raw = JSON.parse(Buffer.from(encoded.slice(5), "base64url").toString());
  raw.rungs[0].to = "0x000000000000000000000000000000000000dEaD";
  assert.throws(() => decodeErrandKey("ldr1_" + Buffer.from(JSON.stringify(raw)).toString("base64url")), /commitment/);
});

test("signing refuses to exceed a rung's cap", async () => {
  const { s, rs } = key();
  await assert.rejects(
    signRungPayment({ errand: getAddress("0x4444444444444444444444444444444444444444"), rung: rs[0]!, proof: [] as Hex[], value: 540_001n, validBefore: 1n, sessionKey: s.privateKey }),
    /capped/,
  );
});

describe("seeded errand keys (v2)", () => {
  const owner = "0x996b38feec91d67a7f48af3a8ffd4c1eb0a92736";
  const brief = { goal: "Ask whether the membership can be cancelled by phone.", forName: "Alex Example", business: { name: "Example Fitness", timeZone: "America/Chicago", phone: "+13125550100" } };

  test("decode rebuilds every key, nonce and salt from the seed and matches the errand", async () => {
    const { makePlan } = await import("../src/plan.ts");
    const p = makePlan({ owner, brief, include: ["phone"], hours: 72 });
    const d = decodeErrandKey(p.key);
    assert.equal(d.errand, p.errand);
    assert.equal(d.key.v, 2);
    assert.equal(d.rungs.length, 2);
    assert.equal(d.rungs[0]!.to, p.rungs[0]!.runner);
    assert.notEqual(d.rungs[0]!.runnerKey, d.rungs[1]!.runnerKey);
    assert.notEqual(d.rungs[0]!.nonce, d.rungs[1]!.nonce);
    assert.ok(p.key.length < 1300, `key is ${p.key.length} characters`);
  });

  test("a mistyped seed is caught instead of pointing at another errand", async () => {
    const { makePlan } = await import("../src/plan.ts");
    const p = makePlan({ owner, brief, include: ["phone"], hours: 72 });
    const raw = JSON.parse(Buffer.from(p.key.slice(5), "base64url").toString());
    raw.seed = raw.seed.slice(0, -1) + (raw.seed.endsWith("0") ? "1" : "0");
    assert.throws(() => decodeErrandKey("ldr1_" + Buffer.from(JSON.stringify(raw)).toString("base64url")), /damaged/);
  });

  test("a raised step cap is caught", async () => {
    const { makePlan } = await import("../src/plan.ts");
    const p = makePlan({ owner, brief, include: ["phone"], hours: 72 });
    const raw = JSON.parse(Buffer.from(p.key.slice(5), "base64url").toString());
    raw.rungs[0][2] = "15000000";
    assert.throws(() => decodeErrandKey("ldr1_" + Buffer.from(JSON.stringify(raw)).toString("base64url")), /damaged/);
  });
});
