// POST /api/finish { errand, sweeps: [{ runner, authorization, signature }], sessionSig }
// Sends each runner's unspent USDC back to the errand's owner, then relays refundWithSig.
// Every sweep must pay the owner, and its runner must have received USDC from this errand.
// The transactions go out with consecutive nonces and the route does not wait for receipts.
import { handleFinish } from "@/lib/finish";
import { options } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const OPTIONS = options;

export function POST(req: Request): Promise<Response> {
  return handleFinish(req, "finish");
}
