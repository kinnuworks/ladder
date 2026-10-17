// POST /api/sweep { errand, runner, authorization, signature }: relays a runner's own EIP-3009
// transfer of its unspent USDC back to the errand's owner. Any other recipient is refused.
import { requireConfig } from "@/lib/config";
import { isLadderErrand } from "@/lib/chain";
import { errorResponse, fail, json, options, rateLimited, readJson } from "@/lib/http";
import { relaySweep } from "@/lib/relay";
import { firstIssue, sweepBodySchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const OPTIONS = options;

export async function POST(req: Request): Promise<Response> {
  try {
    const cfg = requireConfig();
    const parsed = sweepBodySchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { errand, runner, authorization, signature } = parsed.data;
    if (rateLimited(`sweep:${errand}`, 12)) return fail("Too many sweeps for this errand. Wait a minute.", 429);
    if (!(await isLadderErrand(errand, cfg))) return fail("That address is not a Ladder errand.", 404);
    const r = await relaySweep({ errand, runner, authorization, signature });
    return json({ tx: r.tx, blockNumber: r.blockNumber.toString() });
  } catch (err) {
    return errorResponse("sweep", err);
  }
}
