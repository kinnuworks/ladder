// Shared by /api/finish and the /api/refund wrapper.
import type { Address } from "viem";
import { isLadderErrand } from "./chain";
import { requireConfig } from "./config";
import { findReceived } from "./errand";
import { errorResponse, fail, json, rateLimited, readJson } from "./http";
import { clientIp, reserveTxs } from "./limits";
import { relayFinish } from "./relay";
import { finishBodySchema, firstIssue } from "./schema";

export async function handleFinish(req: Request, route: string, adapt?: (body: unknown) => unknown): Promise<Response> {
  try {
    const cfg = requireConfig();
    const raw = await readJson(req);
    const parsed = finishBodySchema.safeParse(adapt ? adapt(raw) : raw);
    if (!parsed.success) return fail(firstIssue(parsed.error), 400);
    const { errand, sweeps, sessionSig } = parsed.data;
    if (rateLimited(`finish:${errand}`, 4)) return fail("Too many finish requests for this errand. Wait a minute.", 429);
    if (!(await isLadderErrand(errand, cfg))) return fail("That address is not a Ladder errand.", 404);
    await reserveTxs(sweeps.length + 1, clientIp(req));
    const r = await relayFinish({ errand, sweeps, sessionSig, findReceived: (runners: Address[]) => findReceived(errand, runners) });
    return json({ errand, txs: r.txs, tx: r.txs[r.txs.length - 1] ?? null, refundedUsd: r.refundedUsd, page: `${cfg.publicUrl}/e/${errand}` });
  } catch (err) {
    return errorResponse(route, err);
  }
}
