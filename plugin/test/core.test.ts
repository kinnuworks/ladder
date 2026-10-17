import { test } from "node:test";
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
