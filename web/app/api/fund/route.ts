// POST /api/fund: x402 funding. Without a payment header it answers 402 with requirements whose
// payTo is the errand address computed from the body's terms. With one, it settles the USDC
// authorization from the relayer and opens the errand.
import { getAddress } from "viem";
import { requireConfig } from "@/lib/config";
import { checkFundRequest } from "@/lib/fund";
import { errorResponse, fail, json, options, readJson } from "@/lib/http";
import { clientIp, reserveTxs } from "@/lib/limits";
import { RelayError, settleFunding } from "@/lib/relay";
import { encodePlanParam } from "@/lib/schema";
import {
  type ErrorReason,
  HEADER_REQUIRED,
  HEADER_RESPONSE,
  HEADER_V1_RESPONSE,
  NETWORK_V1,
  checkAuthorization,
  encodeHeader,
  paymentRequired,
  readPayment,
  settlementResponse,
} from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const OPTIONS = options;

export async function POST(req: Request): Promise<Response> {
  try {
    const cfg = requireConfig();
    const now = Math.floor(Date.now() / 1000);
    const check = checkFundRequest(await readJson(req), cfg, now);
    if (!check.ok) return fail(check.message, check.status);
    const { terms, budget, plan, errand } = check;

    const requirement = {
      errand,
      budget,
      resource: `${cfg.publicUrl}/api/fund`,
      description: `Fund Ladder errand ${errand}`,
    };
    const challenge = (error?: string, settlement?: { version: 1 | 2; reason: ErrorReason; payer: string }) => {
      const { header, body } = paymentRequired(requirement, error);
      const headers: Record<string, string> = { [HEADER_REQUIRED]: header };
      if (settlement) {
        const s = settlementResponse({ success: false, transaction: "", payer: getAddress(settlement.payer), errorReason: settlement.reason });
        headers[HEADER_RESPONSE] = encodeHeader(s);
        if (settlement.version === 1) headers[HEADER_V1_RESPONSE] = encodeHeader({ ...s, network: NETWORK_V1 });
      }
      return json(body, 402, headers);
    };

    const read = readPayment(req.headers);
    if (read.kind === "none") return challenge();
    if (read.kind === "malformed") return fail(read.message, 400);
    if (read.kind === "invalid") return challenge(read.reason);

    const { version, authorization, signature } = read.payment;
    const ok = checkAuthorization(authorization, { errand, budget, owner: terms.owner }, now);
    if (!ok.ok) return challenge(ok.reason, { version, reason: ok.reason, payer: authorization.from });

    await reserveTxs(2, clientIp(req));
    let result;
    try {
      result = await settleFunding({ terms, errand, budget, authorization, signature });
    } catch (err) {
      if (err instanceof RelayError && err.status === 402 && err.reason) {
        return challenge(err.reason, { version, reason: err.reason, payer: authorization.from });
      }
      throw err;
    }

    const settlement = settlementResponse({ success: true, transaction: result.fundTx ?? "", payer: authorization.from });
    const headers: Record<string, string> = { [HEADER_RESPONSE]: encodeHeader(settlement) };
    if (version === 1) headers[HEADER_V1_RESPONSE] = encodeHeader({ ...settlement, network: NETWORK_V1 });
    return json(
      {
        errand,
        fundTx: result.fundTx,
        openTx: result.openTx,
        page: `${cfg.publicUrl}/e/${errand}`,
        // Opt-in link that also labels each step: business name, rung labels, rails, runners and caps.
        pageWithPlan: `${cfg.publicUrl}/e/${errand}?plan=${encodePlanParam(plan)}`,
      },
      200,
      headers,
    );
  } catch (err) {
    return errorResponse("fund", err);
  }
}
