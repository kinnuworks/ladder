import { verifyTypedData } from "viem";
import { describe, expect, it } from "vitest";
import { USDC } from "../lib/core";
import { typedAuthorization } from "../lib/relay";
import {
  HEADER_SIGNATURE,
  HEADER_V1_PAYMENT,
  checkAuthorization,
  decodeHeader,
  paymentRequired,
  readPayment,
} from "../lib/x402";
import { b64, fixture, other, owner, OTHER_KEY, OWNER_KEY, signAuthorization } from "./helpers";

const headers = (h: Record<string, string>) => new Headers(h);

describe("402 payment requirements", () => {
  const { errand } = fixture();
  const req = { errand, budget: 30_000_000n, resource: "https://ladder.test/api/fund", description: `Fund Ladder errand ${errand}` };

  it("v2 header decodes to x402Version 2 with a CAIP-2 network and amount", () => {
    const { header } = paymentRequired(req);
    const pr = decodeHeader(header) as any;
    expect(pr.x402Version).toBe(2);
    expect(pr.resource).toEqual({ url: req.resource, description: req.description, mimeType: "application/json" });
    expect(pr.accepts).toEqual([
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "30000000",
        asset: USDC,
        payTo: errand,
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
    ]);
  });

  it("v1 body uses network base and maxAmountRequired", () => {
    const { body } = paymentRequired(req);
    expect(body).toEqual({
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: "30000000",
          resource: req.resource,
          description: req.description,
          mimeType: "application/json",
          payTo: errand,
          maxTimeoutSeconds: 300,
          asset: USDC,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    });
  });

  it("carries an error reason when re-issued after a bad payment", () => {
    const { header, body } = paymentRequired(req, "invalid_exact_evm_payload_recipient_mismatch");
    expect((decodeHeader(header) as any).error).toBe("invalid_exact_evm_payload_recipient_mismatch");
    expect(body.error).toBe("invalid_exact_evm_payload_recipient_mismatch");
  });
});

describe("payment header parsing", () => {
  const { errand, now } = fixture();
  const validBefore = String(now + 300);

  async function v2Header(over: Record<string, unknown> = {}) {
    const { authorization, signature } = await signAuthorization(OWNER_KEY, { from: owner.address, to: errand, value: "30000000", validBefore });
    return {
      authorization,
      value: b64({
        x402Version: 2,
        resource: { url: "https://ladder.test/api/fund" },
        accepted: { scheme: "exact", network: "eip155:8453", amount: "30000000", asset: USDC, payTo: errand, maxTimeoutSeconds: 300, extra: {} },
        payload: { signature, authorization },
        ...over,
      }),
    };
  }

  it("reads no header as none", () => {
    expect(readPayment(headers({})).kind).toBe("none");
  });

  it("decodes a v2 PAYMENT-SIGNATURE header", async () => {
    const h = await v2Header();
    const r = readPayment(headers({ [HEADER_SIGNATURE]: h.value }));
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.payment.version).toBe(2);
      expect(r.payment.authorization).toEqual(h.authorization);
    }
  });

  it("decodes a v1 X-PAYMENT header", async () => {
    const { authorization, signature } = await signAuthorization(OWNER_KEY, { from: owner.address, to: errand, value: "30000000", validBefore });
    const v = b64({ x402Version: 1, scheme: "exact", network: "base", payload: { signature, authorization } });
    const r = readPayment(headers({ [HEADER_V1_PAYMENT]: v }));
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.payment.version).toBe(1);
  });

  it("treats non-base64 as malformed", () => {
    expect(readPayment(headers({ [HEADER_SIGNATURE]: "not base64!" })).kind).toBe("malformed");
  });

  it("rejects the wrong version, scheme, network and asset", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ x402Version: 1 }, "invalid_x402_version"],
      [{ accepted: { scheme: "upto", network: "eip155:8453" } }, "invalid_scheme"],
      [{ accepted: { scheme: "exact", network: "eip155:84532" } }, "invalid_network"],
      [{ accepted: { scheme: "exact", network: "eip155:8453", asset: "0x0000000000000000000000000000000000000001" } }, "invalid_payment_requirements"],
      [{ payload: { signature: "0x" } }, "invalid_payload"],
    ];
    for (const [over, reason] of cases) {
      const r = readPayment(headers({ [HEADER_SIGNATURE]: (await v2Header(over)).value }));
      expect(r.kind === "invalid" && r.reason, JSON.stringify(over)).toBe(reason);
    }
  });
});

describe("authorization checks", () => {
  const { errand, now } = fixture();
  const expected = { errand, budget: 30_000_000n, owner: owner.address };
  const base = { from: owner.address, to: errand, value: "30000000", validAfter: "0", validBefore: String(now + 300), nonce: `0x${"11".repeat(32)}` as const };

  it("accepts a payment that matches", () => {
    expect(checkAuthorization(base, expected, now)).toEqual({ ok: true });
  });

  it("rejects the wrong payTo", () => {
    const r = checkAuthorization({ ...base, to: other.address }, expected, now);
    expect(r.ok === false && r.reason).toBe("invalid_exact_evm_payload_recipient_mismatch");
  });

  it("rejects the wrong amount, over or under", () => {
    for (const value of ["29999999", "30000001"]) {
      const r = checkAuthorization({ ...base, value }, expected, now);
      expect(r.ok === false && r.reason).toBe("invalid_exact_evm_payload_authorization_value_mismatch");
    }
  });

  it("rejects a payer other than the owner", () => {
    const r = checkAuthorization({ ...base, from: other.address }, expected, now);
    expect(r.ok === false && r.reason).toBe("invalid_exact_evm_payload_authorization_from_mismatch");
  });

  it("rejects an expired authorization, and one about to expire", () => {
    for (const validBefore of [String(now - 1), String(now), String(now + 6)]) {
      const r = checkAuthorization({ ...base, validBefore }, expected, now);
      expect(r.ok === false && r.reason).toBe("invalid_exact_evm_payload_authorization_valid_before");
    }
  });

  it("rejects an authorization that is not valid yet", () => {
    const r = checkAuthorization({ ...base, validAfter: String(now + 60) }, expected, now);
    expect(r.ok === false && r.reason).toBe("invalid_exact_evm_payload_authorization_valid_after");
  });
});

describe("payer signature", () => {
  it("verifies for the owner and not for another key", async () => {
    const { errand, now } = fixture();
    const good = await signAuthorization(OWNER_KEY, { from: owner.address, to: errand, value: "1", validBefore: String(now + 300) });
    const typed = typedAuthorization(good.authorization);
    expect(await verifyTypedData({ address: owner.address, signature: good.signature, ...typed })).toBe(true);
    const forged = await signAuthorization(OTHER_KEY, { ...good.authorization });
    expect(await verifyTypedData({ address: owner.address, signature: forged.signature, ...typed })).toBe(false);
  });
});
