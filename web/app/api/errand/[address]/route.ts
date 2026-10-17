// GET /api/errand/<address>[?plan=...]: everything the errand page shows, as JSON.
import { getAddress, isAddress } from "viem";
import { loadErrandView } from "@/lib/errand";
import { errorResponse, fail, json, options } from "@/lib/http";
import { decodePlanParam } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = options;

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }): Promise<Response> {
  try {
    const { address } = await ctx.params;
    if (!isAddress(address, { strict: false })) return fail("Not an address.", 400);
    const { plan, error } = decodePlanParam(new URL(req.url).searchParams.get("plan"));
    const view = await loadErrandView(getAddress(address), plan, error);
    return json(view, 200, { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" });
  } catch (err) {
    return errorResponse("errand", err);
  }
}
