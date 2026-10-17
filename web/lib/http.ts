// Response helpers shared by the API routes. Error text is scrubbed of the RPC URL (which can
// carry a provider key) before it is logged or returned; the relayer key is never in scope here.
import { ConfigError, readConfig } from "./config";
import { RelayError } from "./errors";

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, payment-signature, x-payment",
  "access-control-expose-headers": "payment-required, payment-response, x-payment-response",
};

export function redact(text: string): string {
  const rpc = readConfig().rpcUrl;
  let out = rpc ? text.split(rpc).join("<rpc>") : text;
  out = out.replace(/https?:\/\/[^\s"']+/g, "<url>");
  return out.slice(0, 400);
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS, ...headers },
  });
}

export function fail(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: redact(message), ...extra }, status);
}

/** Map thrown errors to responses: config gaps are 503, relay refusals keep their status. */
export function errorResponse(route: string, err: unknown): Response {
  if (err instanceof ConfigError) return fail(err.message, 503);
  if (err instanceof RelayError) return fail(err.message, err.status, err.reason ? { reason: err.reason } : {});
  const e = err as { shortMessage?: string; message?: string };
  console.error(`[${route}]`, redact(e?.shortMessage ?? e?.message ?? String(err)));
  return fail("The request could not be completed. Try again shortly.", 502);
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 64 * 1024) throw new RelayError("Request body is over 64 KiB.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new RelayError("Request body is not JSON.", 400);
  }
}

export function options(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// A light per-instance limit. Serverless instances do not share it; the contracts decide validity.
const hits = new Map<string, number[]>();
export function rateLimited(key: string, limit = 6, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) hits.clear();
  return recent.length > limit;
}
