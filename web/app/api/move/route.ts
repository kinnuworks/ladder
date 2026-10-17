// POST /api/move { errand, authorization, signature }: releases a rung to its runner. The
// signature is the errand's ERC-1271 blob; USDC asks the errand contract whether it is valid.
import { requireConfig } from "@/lib/config";
import { isLadderErrand } from "@/lib/chain";
import { errorResponse, fail, json, options, rateLimited, readJson } from "@/lib/http";
import { relayMove } from "@/lib/relay";
import { firstIssue, moveBodySchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const OPTIONS = options;

export async function POST(req: Request): Promise<Response> {
  try {
    const cfg = requireConfig();
    const parsed = moveBodySchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { errand, authorization, signature } = parsed.data;
    if (authorization.from !== errand) return fail("authorization.from must be the errand.", 400);
    if (rateLimited(`move:${errand}`)) return fail("Too many releases for this errand. Wait a minute.", 429);
    if (!(await isLadderErrand(errand, cfg))) return fail("That address is not an open Ladder errand.", 404);
    const r = await relayMove({ errand, authorization, signature });
    return json({ tx: r.tx, blockNumber: r.blockNumber.toString() });
  } catch (err) {
    return errorResponse("move", err);
  }
}
