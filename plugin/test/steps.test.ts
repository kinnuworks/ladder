// The money paths of a step, against a mocked network: Base RPC, Ladder's relay, StablePhone and
// PostalForm. Each test checks what was released, what was paid and what came back to the owner.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { USDC, decodeErrandKey, type Brief, type RailId } from "../src/core.ts";
import { RailRefused } from "../src/x402.ts";
import { Deadline, fundingProblem, runRung } from "../src/rails.ts";
import { makePlan } from "../src/plan.ts";

const OWNER = getAddress("0x996b38feec91d67a7f48af3a8ffd4c1eb0a92736");
const PHONE_PAYTO = getAddress("0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801");
const LETTER_PAYTO = getAddress("0x6be30876b241d7e944effcd91ece5cf5149d45c9");
const NOON_CHICAGO = new Date("2026-10-14T17:00:00Z"); // a Wednesday, 12:00 in Chicago
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

const brief: Brief = {
  goal: "Cancel my gym membership and stop the monthly charge.",
  forName: "Alex Example",
  business: { name: "Example Fitness", timeZone: "America/Chicago", phone: "+13125550100", address: { line1: "1 Main St", city: "Chicago", state: "IL", zip: "60601" } },
  replyEmail: "alex@example.com",
  sender: { line1: "2 Oak Ave", city: "Evanston", state: "IL", zip: "60201" },
};

const LETTER = "To Example Fitness,\n\n" + "Please cancel membership for Alex Example effective immediately and confirm in writing. ".repeat(4);

const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function authorizationState(address,bytes32) view returns (bool)"]);

interface World {
  balances: Map<string, bigint>;
  used: boolean;
  phonePayTo: Address;
  phonePrice: string;
  phoneStatus: number;
  letterPrice: string;
  calls: { url: string; body: any; headers: Record<string, string> }[];
}

let world: World;
const realFetch = globalThis.fetch;

function plan(include: RailId[]) {
  const p = makePlan({ owner: OWNER, brief, include, hours: 72 });
  return { ...decodeErrandKey(p.key), encodedKey: p.key };
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(() => {
  world = { balances: new Map(), used: false, phonePayTo: PHONE_PAYTO, phonePrice: "540000", phoneStatus: 200, letterPrice: "14400000", calls: [] };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    world.calls.push({ url, body, headers });

    if (url === "https://mainnet.base.org") {
      const call = body.params[0];
      assert.equal(getAddress(call.to), USDC);
      const { functionName, args } = decodeFunctionData({ abi: usdcAbi, data: call.data });
      const value = functionName === "balanceOf" ? (world.balances.get(getAddress(args[0] as Address)) ?? 0n) : world.used ? 1n : 0n;
      return respond(200, { jsonrpc: "2.0", id: 1, result: `0x${value.toString(16).padStart(64, "0")}` });
    }
    if (url.endsWith("/api/move")) return respond(200, { tx: "0xmove" });
    if (url.endsWith("/api/sweep")) return respond(200, { txs: ["0xsweep"], sweptUsd: "0.54" });
    if (url === "https://stablephone.dev/api/call") {
      if (!headers["payment-signature"]) {
        const accepts = [{ scheme: "exact", network: "eip155:8453", amount: world.phonePrice, asset: USDC, payTo: world.phonePayTo, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }];
        return respond(402, {}, { "PAYMENT-REQUIRED": b64({ x402Version: 2, accepts }) });
      }
      if (world.phoneStatus !== 200) return respond(world.phoneStatus, { error: "nope" });
      return respond(200, { call_id: "call_123" }, { "PAYMENT-RESPONSE": b64({ success: true, transaction: "0xpaid" }) });
    }
    if (url === "https://postalform.com/api/machine/orders/validate") return respond(200, { quote: { price_usd: (Number(world.letterPrice) / 1e6).toFixed(2) } });
    if (url === "https://postalform.com/api/machine/orders") {
      const accepts = [{ scheme: "exact", network: "eip155:8453", amount: world.letterPrice, asset: USDC, payTo: LETTER_PAYTO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }];
      return respond(402, { order_id: "ord_1", preview_url: "https://postalform.com/p/ord_1" }, { "PAYMENT-REQUIRED": b64({ x402Version: 2, accepts }) });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const moves = () => world.calls.filter((c) => c.url.endsWith("/api/move"));
const sweeps = () => world.calls.filter((c) => c.url.endsWith("/api/sweep"));
const payments = () => world.calls.filter((c) => c.headers["payment-signature"]);

describe("phone step", () => {
  test("first call releases exactly the step's cap to its own key and pays no one", async () => {
    const d = plan(["phone"]);
    const out = await runRung({ ...d, index: 0, reason: "first attempt", now: NOON_CHICAGO, dl: new Deadline() });
    assert.equal(out.status, "released");
    assert.equal(moves().length, 1);
    const auth = moves()[0]!.body.authorization;
    assert.equal(getAddress(auth.to), d.rungs[0]!.to);
    assert.equal(BigInt(auth.value), 540_000n);
    assert.equal(payments().length, 0);
  });

  test("second call pays the service once from the step key", async () => {
    const d = plan(["phone"]);
    world.used = true;
    world.balances.set(d.rungs[0]!.to, 540_000n);
    const out = await runRung({ ...d, index: 0, reason: "first attempt", now: NOON_CHICAGO, dl: new Deadline() });
    assert.equal(out.status, "started");
    assert.equal(out.jobId, "call_123");
    assert.equal(out.paid.amount, "540000");
    assert.equal(out.paid.transaction, "0xpaid");
    assert.equal(payments().length, 1);
    assert.equal(sweeps().length, 0);
  });

  test("a service asking to be paid somewhere else gets nothing, and the step's money goes back to the owner", async () => {
    const d = plan(["phone"]);
    world.used = true;
    world.balances.set(d.rungs[0]!.to, 540_000n);
    world.phonePayTo = getAddress("0x000000000000000000000000000000000000dEaD");
    await assert.rejects(runRung({ ...d, index: 0, reason: "first attempt", now: NOON_CHICAGO, dl: new Deadline() }), (e: RailRefused) => {
      assert.equal(e.code, "UNEXPECTED_PAYEE");
      assert.match(e.message, /went back to the owner's wallet/);
      return true;
    });
    assert.equal(payments().length, 0);
    assert.equal(sweeps().length, 1);
    const sweep = sweeps()[0]!.body.sweeps[0];
    assert.equal(getAddress(sweep.authorization.to), OWNER);
    assert.equal(BigInt(sweep.authorization.value), 540_000n);
  });

  test("a price above the cap is refused before paying and the money goes back", async () => {
    const d = plan(["phone"]);
    world.used = true;
    world.balances.set(d.rungs[0]!.to, 540_000n);
    world.phonePrice = "990000";
    await assert.rejects(runRung({ ...d, index: 0, reason: "first attempt", now: NOON_CHICAGO, dl: new Deadline() }), (e: RailRefused) => e.code === "OVER_STEP_CAP");
    assert.equal(payments().length, 0);
    assert.equal(sweeps().length, 1);
  });

  test("a service refusal (4xx) returns the money; a server error (5xx) keeps it for a retry", async () => {
    const d = plan(["phone"]);
    world.used = true;
    world.balances.set(d.rungs[0]!.to, 540_000n);
    world.phoneStatus = 400;
    await assert.rejects(runRung({ ...d, index: 0, reason: "first attempt", now: NOON_CHICAGO, dl: new Deadline() }), (e: RailRefused) => e.code === "SERVICE_400");
    assert.equal(sweeps().length, 1);

    world.calls = [];
    world.phoneStatus = 503;
    await assert.rejects(runRung({ ...d, index: 0, reason: "first attempt", now: NOON_CHICAGO, dl: new Deadline() }), (e: RailRefused) => e.code === "SERVICE_503");
    assert.equal(sweeps().length, 0);
  });

  test("an empty step key never pays twice", async () => {
    const d = plan(["phone"]);
    world.used = true;
    await assert.rejects(runRung({ ...d, index: 0, reason: "first attempt", now: NOON_CHICAGO, dl: new Deadline() }), (e: RailRefused) => e.code === "ALREADY_PAID_OR_CONFIRMING");
    assert.equal(payments().length, 0);
    assert.equal(sweeps().length, 0);
  });

  test("no call outside 9am to 6pm in the business's time zone, and nothing is released", async () => {
    const d = plan(["phone"]);
    await assert.rejects(runRung({ ...d, index: 0, reason: "first attempt", now: new Date("2026-10-14T03:00:00Z"), dl: new Deadline() }), (e: RailRefused) => e.code === "OUTSIDE_CALLING_HOURS");
    assert.equal(moves().length, 0);
  });
});

describe("letter step", () => {
  test("the first call quotes and previews the letter and moves no money", async () => {
    const d = plan(["phone", "mail"]);
    const out = await runRung({ ...d, index: 2, reason: "they need it in writing", letter: LETTER, dl: new Deadline() });
    assert.equal(out.status, "awaiting_letter_approval");
    assert.equal(moves().length, 0);
    assert.equal(payments().length, 0);
  });

  test("an approved letter releases its exact price, not the $15 cap, so nothing is left over", async () => {
    const d = plan(["phone", "mail"]);
    const preview = await runRung({ ...d, index: 2, reason: "they need it in writing", letter: LETTER, dl: new Deadline() });
    const hash = preview.detail.letter_sha256 as Hex;
    world.calls = [];
    const out = await runRung({ ...d, index: 2, reason: "they need it in writing", letter: LETTER, confirmLetter: hash, dl: new Deadline() });
    assert.equal(out.status, "released");
    assert.equal(BigInt(moves()[0]!.body.authorization.value), 14_400_000n);
  });

  test("a changed letter is refused before any money moves", async () => {
    const d = plan(["phone", "mail"]);
    await assert.rejects(
      runRung({ ...d, index: 2, reason: "they need it in writing", letter: LETTER, confirmLetter: `0x${"ab".repeat(32)}`, dl: new Deadline() }),
      (e: RailRefused) => e.code === "LETTER_CHANGED",
    );
    assert.equal(moves().length, 0);
  });
});

describe("funding check", () => {
  const errand = getAddress("0x7a3f00000000000000000000000000000000c41e");
  const challenge = (payTo: string, amount: string) =>
    ({ status: 402, headers: new Headers({ "payment-required": b64({ x402Version: 2, accepts: [{ scheme: "exact", payTo, amount }] }) }), body: {} });

  test("accepts only the computed errand and the exact budget", () => {
    assert.equal(fundingProblem(challenge(errand, "1080000"), errand, "1080000"), null);
  });
  test("PAYEE_MISMATCH when the endpoint would pay anyone else", () => {
    assert.equal(fundingProblem(challenge("0x000000000000000000000000000000000000dEaD", "1080000"), errand, "1080000")?.code, "PAYEE_MISMATCH");
  });
  test("AMOUNT_MISMATCH when the amount is not the budget", () => {
    assert.equal(fundingProblem(challenge(errand, "1080001"), errand, "1080000")?.code, "AMOUNT_MISMATCH");
  });
  test("NO_CHALLENGE without a 402", () => {
    assert.equal(fundingProblem({ status: 200, headers: new Headers(), body: {} }, errand, "1080000")?.code, "NO_CHALLENGE");
  });
});
