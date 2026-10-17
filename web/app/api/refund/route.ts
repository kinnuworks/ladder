// POST /api/refund { errand, sessionSig }: relays refundWithSig. The contract can only pay the
// owner, so no auth is needed; we check the address is a Ladder errand and the signer first.
import { formatUnits } from "viem";
import { requireConfig } from "@/lib/config";
import { isLadderErrand } from "@/lib/chain";
import { errorResponse, fail, json, options, rateLimited, readJson } from "@/lib/http";
import { relayRefund } from "@/lib/relay";
import { firstIssue, refundBodySchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const OPTIONS = options;

export async function POST(req: Request): Promise<Response> {
  try {
    const cfg = requireConfig();
    const parsed = refundBodySchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { errand, sessionSig } = parsed.data;
    if (rateLimited(`refund:${errand}`, 3)) return fail("Too many refund requests for this errand. Wait a minute.", 429);
    if (!(await isLadderErrand(errand, cfg))) return fail("That address is not an open Ladder errand.", 404);
    const r = await relayRefund({ errand, sessionSig });
    return json({
      errand,
      tx: r.tx,
      blockNumber: r.blockNumber.toString(),
      refunded: r.refunded.toString(),
      refundedUsd: formatUnits(r.refunded, 6),
      page: `${cfg.publicUrl}/e/${errand}`,
    });
  } catch (err) {
    return errorResponse("refund", err);
  }
}
