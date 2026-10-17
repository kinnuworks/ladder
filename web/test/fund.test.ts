// The funding route up to the point where it would touch the chain: policy checks, the 402
// challenge, and rejection of bad payments (all decided before any RPC call).
import { beforeAll, describe, expect, it } from "vitest";
import { checkFundRequest } from "../lib/fund";
import { HEADER_REQUIRED, HEADER_RESPONSE, HEADER_SIGNATURE, HEADER_V1_PAYMENT, HEADER_V1_RESPONSE } from "../lib/x402";
import { b64, FACTORY, fixture, IMPLEMENTATION, other, OTHER_KEY, owner, OWNER_KEY, signAuthorization, unb64 } from "./helpers";

const cfg = { factory: FACTORY, implementation: IMPLEMENTATION };

describe("funding policy", () => {
  it("fills factory and implementation and predicts the errand", () => {
    const { body, errand, now } = fixture();
    const r = checkFundRequest(body, cfg, now);
    expect(r.ok && r.errand).toBe(errand);
  });

  it("keeps only the business name and rungs from the plan", () => {
    const { body, now } = fixture();
    const b = structuredClone(body) as any;
    b.plan.goal = "Cancel the gym membership";
    b.plan.replyEmail = "sam@example.com";
    const r = checkFundRequest(b, cfg, now);
    expect(r.ok && r.plan).toEqual({ business: "Northside Gym", rungs: body.plan.rungs });
  });

  const reject = (mutate: (b: any) => void, match: RegExp) => {
    const { body, now } = fixture();
    const b = structuredClone(body) as any;
    mutate(b);
    const r = checkFundRequest(b, cfg, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(match);
  };

  it("rejects an expiry in the past or more than 30 days out", () => {
    const now = Math.floor(Date.now() / 1000);
    reject((b) => (b.terms.expiry = now - 10), /past/);
    reject((b) => (b.terms.expiry = now + 31 * 86_400), /30 days/);
  });

  it("rejects budgets over 100 USDC", () => reject((b) => (b.budget = "100000001"), /100 USDC/));
  it("rejects budgets under 1 USDC", () => reject((b) => (b.budget = "999999"), /under 1 USDC/));
  it("rejects a foreign factory", () => reject((b) => (b.terms.factory = other.address), /factory/));
  it("rejects an unknown rail", () => reject((b) => (b.plan.rungs[0].rail = "fax"), /rail/));
  it("rejects a cap above the rail cap", () => {
    reject((b) => (b.plan.rungs[0].max = "540001"), /rail cap/);
    reject((b) => (b.plan.rungs[1].max = "15000001"), /rail cap/);
    reject((b) => (b.plan.rungs[2].max = "15000001"), /rail cap/);
  });
  it("accepts any runner address on a rung", () => {
    const { body, now } = fixture();
    const b = structuredClone(body) as any;
    b.plan.rungs[0].to = other.address;
    expect(checkFundRequest(b, cfg, now).ok).toBe(true);
  });
});

describe("POST /api/fund", () => {
  let POST: (req: Request) => Promise<Response>;
  beforeAll(async () => {
    process.env.FACTORY_ADDRESS = FACTORY;
    process.env.IMPLEMENTATION_ADDRESS = IMPLEMENTATION;
    process.env.BASE_RPC_URL = "http://127.0.0.1:1"; // never reached in these cases
    process.env.PUBLIC_URL = "https://ladder.test";
    ({ POST } = await import("../app/api/fund/route"));
  });

  const call = (body: unknown, headers: Record<string, string> = {}) =>
    POST(new Request("https://ladder.test/api/fund", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  it("answers 402 with the errand as payTo, in both versions", async () => {
    const { body, errand } = fixture();
    const res = await call(body);
    expect(res.status).toBe(402);
    const v2 = unb64(res.headers.get(HEADER_REQUIRED)!);
    expect(v2.x402Version).toBe(2);
    expect(v2.accepts[0]).toMatchObject({ payTo: errand, amount: "30000000", network: "eip155:8453" });
    expect(v2.resource.url).toBe("https://ladder.test/api/fund");
    const v1 = await res.json();
    expect(v1.accepts[0]).toMatchObject({ payTo: errand, maxAmountRequired: "30000000", network: "base" });
  });

  it("answers 400 to a bad body", async () => {
    const res = await call({ terms: {}, budget: "1", plan: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  async function paid(over: Partial<{ from: `0x${string}`; to: `0x${string}`; value: string; validBefore: string }>, key = OWNER_KEY, v1 = false) {
    const { body, errand, now } = fixture();
    const { authorization, signature } = await signAuthorization(key, {
      from: owner.address,
      to: errand,
      value: "30000000",
      validBefore: String(now + 300),
      ...over,
    });
    const payload = v1
      ? { x402Version: 1, scheme: "exact", network: "base", payload: { signature, authorization } }
      : { x402Version: 2, accepted: { scheme: "exact", network: "eip155:8453" }, payload: { signature, authorization } };
    return call(body, { [v1 ? HEADER_V1_PAYMENT : HEADER_SIGNATURE]: b64(payload) });
  }

  const reasonOf = async (res: Response, v1 = false) => {
    expect(res.status).toBe(402);
    const s = unb64(res.headers.get(v1 ? HEADER_V1_RESPONSE : HEADER_RESPONSE)!);
    expect(s.success).toBe(false);
    expect(s.transaction).toBe("");
    expect(unb64(res.headers.get(HEADER_REQUIRED)!).error).toBe(s.errorReason);
    return s.errorReason;
  };

  it("rejects a payment to the wrong payTo", async () => {
    expect(await reasonOf(await paid({ to: other.address }))).toBe("invalid_exact_evm_payload_recipient_mismatch");
  });
  it("rejects the wrong amount", async () => {
    expect(await reasonOf(await paid({ value: "29000000" }))).toBe("invalid_exact_evm_payload_authorization_value_mismatch");
  });
  it("rejects a payer that is not the owner", async () => {
    expect(await reasonOf(await paid({ from: other.address }, OTHER_KEY))).toBe("invalid_exact_evm_payload_authorization_from_mismatch");
  });
  it("rejects an expired authorization, over v1 too", async () => {
    const past = String(Math.floor(Date.now() / 1000) - 5);
    expect(await reasonOf(await paid({ validBefore: past }))).toBe("invalid_exact_evm_payload_authorization_valid_before");
    expect(await reasonOf(await paid({ validBefore: past }, OWNER_KEY, true), true)).toBe("invalid_exact_evm_payload_authorization_valid_before");
  });
  it("answers 400 to an undecodable payment header", async () => {
    const { body } = fixture();
    expect((await call(body, { [HEADER_SIGNATURE]: "%%%" })).status).toBe(400);
  });
});
