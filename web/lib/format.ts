import { type Address, type Hex, formatUnits } from "viem";

export const BASESCAN = "https://basescan.org";

export function usd(atomic: bigint | string): string {
  const v = typeof atomic === "string" ? BigInt(atomic) : atomic;
  const s = formatUnits(v < 0n ? -v : v, 6);
  const [whole, frac = ""] = s.split(".");
  // Cents, unless the amount is a fraction of a cent, which would otherwise read as $0.00.
  const keep = v !== 0n && (v < 0n ? -v : v) < 10_000n ? frac.replace(/0+$/, "").length : 2;
  const cents = (frac + "00").slice(0, keep);
  return `${v < 0n ? "-" : ""}$${Number(whole).toLocaleString("en-US")}.${cents}`;
}

export function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export const txUrl = (hash: Hex) => `${BASESCAN}/tx/${hash}`;
export const addressUrl = (a: Address) => `${BASESCAN}/address/${a}`;
export const sourcifyUrl = (a: Address) => `https://repo.sourcify.dev/8453/${a}`;

export function duration(seconds: number): string {
  const s = Math.abs(Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function isoTime(unix: number): string {
  return new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, "Z").replace("T", " ");
}
