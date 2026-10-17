// POST /api/refund { errand, sessionSig }: the finish bundle with no sweeps. The contract can
// only pay the owner, so the route needs no auth beyond the session signer's signature.
import { handleFinish } from "@/lib/finish";
import { options } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const OPTIONS = options;

export function POST(req: Request): Promise<Response> {
  return handleFinish(req, "refund", (body) =>
    body && typeof body === "object" ? { ...(body as Record<string, unknown>), sweeps: [] } : body,
  );
}
