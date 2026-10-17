import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getAddress, recoverTypedDataAddress, verifyMessage, type Hex } from "viem";
import { USDC, CHAIN_ID, newSessionKey, randomHex32, siweMessage, decodeErrandKey, type Brief, type Rung } from "../src/core.ts";
import { readChallenge, checkChallenge, signAsRunner, RailRefused, type Challenge } from "../src/x402.ts";
import { assertCallingHours, assertNoSecrets, callTask, letterHash, mailOrder, RAILS } from "../src/rails.ts";
import { makePlan, rungsFor } from "../src/plan.ts";

const PHONE_PAYTO = getAddress("0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801");
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const accept = (over: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: "eip155:8453",
  amount: "540000",
  asset: USDC,
  payTo: PHONE_PAYTO,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
  ...over,
});

const brief = (over: Partial<Brief> = {}): Brief => ({
  goal: "Cancel my gym membership and stop the monthly charge.",
  forName: "Alex Example",
  business: {
    name: "Example Fitness",
    timeZone: "America/Chicago",
    phone: "+13125550100",
    address: { line1: "1 Main St", city: "Chicago", state: "IL", zip: "60601" },
  },
  replyEmail: "alex@example.com",
  sender: { line1: "2 Oak Ave", city: "Evanston", state: "IL", zip: "60201" },
  ...over,
});

describe("reading payment challenges", () => {
  test("v2 header", async () => {
    const res = new Response("", { status: 402, headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, accepts: [accept()] }) } });
    const c = await readChallenge(res);
    assert.equal(c.version, 2);
    assert.equal(c.requirement.amount, "540000");
    assert.deepEqual(c.requirement.raw, accept());
  });

  test("v1 body uses maxAmountRequired", async () => {
    const res = new Response(JSON.stringify({ x402Version: 1, accepts: [{ ...accept({ network: "base" }), amount: undefined, maxAmountRequired: "777" }] }), { status: 402 });
    const c = await readChallenge(res);
    assert.equal(c.version, 1);
    assert.equal(c.requirement.amount, "777");
  });

  test("PostalForm's nested challenge", async () => {
    const body = { order_id: "o-1", payment: { payment_required: { x402Version: 2, accepts: [accept({ amount: "14400000", payTo: "0x6be30876b241d7e944effcd91ece5cf5149d45c9" })] } } };
    const c = await readChallenge(new Response(JSON.stringify(body), { status: 402 }));
    assert.equal(c.requirement.amount, "14400000");
    assert.equal(c.body.order_id, "o-1");
  });

  test("ignores other networks and assets", async () => {
    const res = new Response("", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, accepts: [accept({ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }), accept({ asset: "0x0000000000000000000000000000000000000001" })] }) },
    });
    await assert.rejects(readChallenge(res), (e: RailRefused) => e.code === "NO_BASE_USDC_OPTION");
  });
});

describe("checking a challenge before a step key signs", () => {
  const c = (over = {}): Challenge => ({ version: 2, requirement: { ...accept(over), raw: accept(over) } as any, body: {} });
  test("accepts the known payee within the cap", () => {
    assert.deepEqual(checkChallenge(c(), { payTo: PHONE_PAYTO, maxAmount: 540_000n }), { payTo: PHONE_PAYTO, amount: 540_000n });
  });
  test("refuses an unexpected payee", () => {
    assert.throws(() => checkChallenge(c({ payTo: "0x000000000000000000000000000000000000bEEF" }), { payTo: PHONE_PAYTO, maxAmount: 540_000n }), (e: RailRefused) => e.code === "UNEXPECTED_PAYEE");
  });
  test("refuses a price over the step's cap", () => {
    assert.throws(() => checkChallenge(c({ amount: "540001" }), { payTo: PHONE_PAYTO, maxAmount: 540_000n }), (e: RailRefused) => e.code === "OVER_STEP_CAP");
  });
});

describe("step keys", () => {
  test("sign a USDC authorization that recovers to the key", async () => {
    const k = newSessionKey();
    const { authorization, signature } = await signAsRunner(k.privateKey, PHONE_PAYTO, 540_000n, 2_000_000_000n);
    const signer = await recoverTypedDataAddress({
      domain: { name: "USD Coin", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: { ...authorization, value: 540_000n, validAfter: 0n, validBefore: 2_000_000_000n, nonce: authorization.nonce as Hex },
      signature,
    });
    assert.equal(signer, k.address);
    assert.equal(signature.length, 132, "65-byte signature, so facilitators use the v,r,s path");
  });

  test("sign-in message matches EIP-4361 and verifies", async () => {
    const k = newSessionKey();
    const info = { domain: "stablephone.dev", uri: "https://stablephone.dev/api/call/abc", version: "1", chainId: "eip155:8453", nonce: "5217f8e1de2e46cf", issuedAt: "2026-10-17T17:31:00.563Z", expirationTime: "2026-10-17T17:36:00.563Z", statement: "Sign in to verify your wallet identity" };
    const m = siweMessage(info, k.address);
    assert.equal(
      m,
      `stablephone.dev wants you to sign in with your Ethereum account:\n${k.address}\n\nSign in to verify your wallet identity\n\nURI: https://stablephone.dev/api/call/abc\nVersion: 1\nChain ID: 8453\nNonce: 5217f8e1de2e46cf\nIssued At: 2026-10-17T17:31:00.563Z\nExpiration Time: 2026-10-17T17:36:00.563Z`,
    );
    const { privateKeyToAccount } = await import("viem/accounts");
    const sig = await privateKeyToAccount(k.privateKey).signMessage({ message: m });
    assert.ok(await verifyMessage({ address: k.address, message: m, signature: sig }));
  });
});

describe("guards", () => {
  test("no keys in text that leaves for a third party", () => {
    assert.throws(() => assertNoSecrets("letter", "Please verify with ldr1_eyJ2IjoxfQ"), (e: RailRefused) => e.code === "SECRET_IN_OUTPUT");
    assert.throws(() => assertNoSecrets("reason", `key ${randomHex32()}`), (e: RailRefused) => e.code === "SECRET_IN_OUTPUT");
    assert.doesNotThrow(() => assertNoSecrets("letter", "Account 0x1234 and reference 99812."));
  });

  test("calls only on weekdays, 9am to 6pm in the business's zone", () => {
    const tz = "America/Chicago";
    assert.doesNotThrow(() => assertCallingHours(tz, new Date("2026-10-15T15:00:00Z"))); // Thu 10:00 CDT
    assert.throws(() => assertCallingHours(tz, new Date("2026-10-15T03:00:00Z")), (e: RailRefused) => e.code === "OUTSIDE_CALLING_HOURS"); // Wed 22:00
    assert.throws(() => assertCallingHours(tz, new Date("2026-10-17T16:00:00Z")), (e: RailRefused) => e.code === "OUTSIDE_CALLING_HOURS"); // Saturday
    assert.throws(() => assertCallingHours(undefined), (e: RailRefused) => e.code === "NEEDS_TIMEZONE");
  });

  test("the call script discloses the AI, the recording and the do-not-call request", () => {
    const t = callTask(brief(), false, "first call");
    assert.match(t, /automated assistant/);
    assert.match(t, /recorded/);
    assert.match(t, /stop calling/);
    assert.match(t, /Do not agree to any new charge/);
    assert.doesNotMatch(callTask(brief(), false, "first call"), /follow-up/);
    assert.match(callTask(brief(), true, "they asked for written notice"), /follow-up call.*written notice/);
  });
});

describe("plans", () => {
  test("defaults to two calls and a letter, budget equal to the caps", () => {
    const p = makePlan({ owner: "0x000000000000000000000000000000000000dEaD", brief: brief(), include: ["phone", "mail"], hours: 72 });
    assert.deepEqual(p.rungs.map((r) => r.rail), ["phone", "phone", "mail"]);
    assert.equal(p.budgetUsd, "16.08");
    const d = decodeErrandKey(p.key);
    assert.equal(d.errand, p.errand);
    assert.equal(new Set(d.rungs.map((r) => r.to)).size, 3, "every step has its own key");
  });

  test("refuses phone steps without a time zone, and budgets under $1", () => {
    assert.throws(() => makePlan({ owner: "0x000000000000000000000000000000000000dEaD", brief: brief({ business: { name: "X", phone: "+13125550100" } }), include: ["phone"], hours: 1 }), /timezone/);
    assert.throws(() => makePlan({ owner: "0x000000000000000000000000000000000000dEaD", brief: brief(), include: ["phone"], budgetUsd: 0.5, hours: 1 }), /at least \$1/);
  });

  test("leaves out steps the brief can't support", () => {
    const rs = rungsFor(brief({ replyEmail: undefined }), ["phone", "human", "mail"]);
    assert.deepEqual(rs.map((r) => r.rail), ["phone", "phone"]);
  });

  test("caps come from the rail registry", () => {
    assert.equal(RAILS.mail.cap, 15_000_000n);
    assert.equal(RAILS.phone.cap, 540_000n);
  });
});

describe("certified letters", () => {
  const rung: Rung = { rail: "mail", label: "Letter", ...(() => { const k = newSessionKey(); return { to: k.address, runnerKey: k.privateKey }; })(), max: 15_000_000n, nonce: randomHex32(), salt: randomHex32() };
  const letter = "Dear Example Fitness,\n\n".padEnd(260, "I am writing to cancel my membership. ");

  test("one order per step and letter text", () => {
    const a = mailOrder(brief(), rung, letter);
    assert.equal(a.request_id, mailOrder(brief(), rung, letter).request_id, "same letter, same order");
    assert.notEqual(a.request_id, mailOrder(brief(), rung, letter + " Thank you.").request_id, "edited letter, new order");
    assert.match(a.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("certified with an electronic return receipt, US to US, names within limits", () => {
    const o = mailOrder(brief({ forName: "A".repeat(60) }), rung, letter);
    assert.equal(o.certified, true);
    assert.equal(o.certified_return_receipt, true);
    assert.equal(o.mail_class, "standard");
    assert.equal(o.recipient_address_manual.countryCode, "US");
    assert.equal(o.sender_name.length, 40);
  });

  test("the approval hash is the sha256 of the exact text", () => {
    assert.equal(letterHash(letter), letterHash(letter));
    assert.notEqual(letterHash(letter), letterHash(letter + " "));
  });
});
