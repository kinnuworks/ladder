// GET /api/cron/sweep-expired: called by Vercel Cron with "Authorization: Bearer <CRON_SECRET>".
// It does nothing unless CRON_SECRET is set and matches. It only refunds errands that have
// expired, are still open and hold USDC; refund() then sends that USDC to each errand's owner.
// Each run handles at most a few errands and counts against the relayer's transaction caps.
// It finds errands through the factory's ErrandOpened events, so USDC sent to an address whose
// errand was never opened is out of its reach. That case needs someone with the terms to call
// factory.open first; /api/fund avoids it by refusing to fund unless the factory is deployed and
// opening the errand in the same request.
import { type Address, getAddress } from "viem";
import { USDC } from "@/lib/core";
import { errandAbi, factoryAbi, publicClient, usdcAbi } from "@/lib/chain";
import { readConfig } from "@/lib/config";
import { logsAdaptive } from "@/lib/errand";
import { errorResponse, json } from "@/lib/http";
import { reserveTxs } from "@/lib/limits";
import { relayExpiredRefund } from "@/lib/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_RUN = 5;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ ran: false }, 200);
  try {
    const cfg = readConfig();
    if (!cfg.factory || cfg.deployBlock === null) return json({ ran: false, reason: "FACTORY_ADDRESS or DEPLOY_BLOCK is not set." });
    const pub = publicClient();
    const latest = await pub.getBlock({ blockTag: "latest" });
    const now = Number(latest.timestamp);
    const event = factoryAbi.find((x) => x.type === "event" && x.name === "ErrandOpened")!;
    const opened = await logsAdaptive(cfg.deployBlock, latest.number, (f, t) =>
      pub.getLogs({ address: cfg.factory!, event, fromBlock: f, toBlock: t, strict: true }),
    );
    const expired = opened.filter((l) => Number(l.args.expiry) <= now).map((l) => getAddress(l.args.errand) as Address);
    const refunded: string[] = [];
    for (const errand of expired) {
      if (refunded.length >= PER_RUN) break;
      const [closed, balance] = await Promise.all([
        pub.readContract({ address: errand, abi: errandAbi, functionName: "closed" }),
        pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [errand] }),
      ]);
      if (closed || balance === 0n) continue;
      await reserveTxs(1, "cron");
      refunded.push(await relayExpiredRefund(errand));
    }
    return json({ ran: true, expired: expired.length, txs: refunded });
  } catch (err) {
    return errorResponse("cron", err);
  }
}

