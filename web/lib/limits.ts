// Limits on how many transactions the relayer sends, so nobody can drain its gas.
// Per-IP and per-instance counters live in memory (serverless instances do not share them).
// The daily cap is read from the chain: the relayer's nonce now minus its nonce a day ago,
// which every instance sees the same way.
import type { Address } from "viem";
import { publicClient, relayerAddress } from "./chain";
import { RelayError } from "./relay";

const HOUR = 3_600_000;
const BLOCKS_PER_DAY = 43_200n; // Base produces a block every 2 seconds
export const PER_IP_PER_HOUR = 30;
export const PER_INSTANCE_PER_HOUR = 60;

const ipSends = new Map<string, number[]>();
let instanceSends: number[] = [];
let localDaily: number[] = [];
let dailyCache: { at: number; count: number } | null = null;

export function dailyCap(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.RELAYER_DAILY_TX_CAP);
  return Number.isInteger(v) && v > 0 ? v : 200;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

function recent(list: number[], now: number, window: number) {
  return list.filter((t) => now - t < window);
}

async function relayerTxsLastDay(relayer: Address): Promise<number> {
  const now = Date.now();
  if (dailyCache && now - dailyCache.at < 30_000) return dailyCache.count;
  let count: number;
  try {
    const pub = publicClient();
    const latest = await pub.getBlockNumber();
    const [nowNonce, thenNonce] = await Promise.all([
      pub.getTransactionCount({ address: relayer, blockNumber: latest }),
      pub.getTransactionCount({ address: relayer, blockNumber: latest > BLOCKS_PER_DAY ? latest - BLOCKS_PER_DAY : 0n }),
    ]);
    count = nowNonce - thenNonce;
  } catch {
    // An RPC without historical state: fall back to this instance's own count.
    count = recent(localDaily, now, 24 * HOUR).length;
  }
  dailyCache = { at: now, count };
  return count;
}

/** Reserve `n` relayed transactions for a request from `ip`, or throw a 429. */
export async function reserveTxs(n: number, ip: string): Promise<void> {
  const now = Date.now();
  const mine = recent(ipSends.get(ip) ?? [], now, HOUR);
  if (mine.length + n > PER_IP_PER_HOUR) throw new RelayError("Too many relayed transactions from this address. Try again later.", 429);
  instanceSends = recent(instanceSends, now, HOUR);
  if (instanceSends.length + n > PER_INSTANCE_PER_HOUR) throw new RelayError("The relayer is busy. Try again later.", 429);
  const relayer = relayerAddress();
  if (relayer) {
    const used = await relayerTxsLastDay(relayer);
    if (used + n > dailyCap()) throw new RelayError("The relayer has reached its daily transaction cap. Try again tomorrow.", 429);
  }
  const stamps = Array.from({ length: n }, () => now);
  ipSends.set(ip, [...mine, ...stamps]);
  if (ipSends.size > 5_000) ipSends.clear();
  instanceSends.push(...stamps);
  localDaily = [...recent(localDaily, now, 24 * HOUR), ...stamps];
  if (dailyCache) dailyCache.count += n;
}

/** Test hook. */
export function resetLimits() {
  ipSends.clear();
  instanceSends = [];
  localDaily = [];
  dailyCache = null;
}
