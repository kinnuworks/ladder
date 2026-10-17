// POST /api/move { errand, authorization, signature }: releases a rung to its runner. The
// signature is the errand's ERC-1271 blob; USDC asks the errand contract whether it is valid.
// The route waits about four seconds for the receipt and otherwise reports the release as pending.
import { requireConfig } from "@/lib/config";
import { isLadderErrand } from "@/lib/chain";
import { errorResponse, fail, json, options, rateLimited, readJson } from "@/lib/http";
import { clientIp, reserveTxs } from "@/lib/limits";
import { checkMove, relayMove } from "@/lib/relay";
import { firstIssue, moveBodySchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const OPTIONS = options;

export async function POST(req: Request): Promise<Response> {
  try {
    const cfg = requireConfig();
    const parsed = moveBodySchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const problem = checkMove(parsed.data);
    if (problem) return fail(problem, 400);
    const { errand } = parsed.data;
    if (rateLimited(`move:${errand}`)) return fail("Too many releases for this errand. Wait a minute.", 429);
    if (!(await isLadderErrand(errand, cfg))) return fail("That address is not a Ladder errand.", 404);
    await reserveTxs(1, clientIp(req));
    const r = await relayMove(parsed.data);
    return json(r.pending ? { tx: r.tx, pending: true } : { tx: r.tx, blockNumber: r.blockNumber!.toString() });
  } catch (err) {
    return errorResponse("move", err);
  }
}
