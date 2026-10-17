// POST /api/sweep { errand, sweeps: [{ runner, authorization, signature }] }
// Sends unspent step-key USDC back to the errand's owner and leaves the errand open. The plugin
// calls this when a service refuses a step after its cap was released.
import type { Address } from "viem";
import { isLadderErrand } from "@/lib/chain";
import { requireConfig } from "@/lib/config";
import { findReceived } from "@/lib/errand";
import { errorResponse, fail, json, options, rateLimited, readJson } from "@/lib/http";
import { clientIp, reserveTxs } from "@/lib/limits";
import { relaySweeps } from "@/lib/relay";
import { firstIssue, sweepBodySchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const OPTIONS = options;

export async function POST(req: Request): Promise<Response> {
  try {
    const cfg = requireConfig();
    const parsed = sweepBodySchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { errand, sweeps } = parsed.data;
    if (rateLimited(`sweep:${errand}`, 4)) return fail("Too many sweep requests for this errand. Wait a minute.", 429);
    if (!(await isLadderErrand(errand, cfg))) return fail("That address is not a Ladder errand.", 404);
    await reserveTxs(sweeps.length, clientIp(req));
    const r = await relaySweeps({ errand, sweeps, findReceived: (runners: Address[]) => findReceived(errand, runners) });
    return json({ errand, txs: r.txs, sweptUsd: r.sweptUsd });
  } catch (err) {
    return errorResponse("sweep", err);
  }
}
