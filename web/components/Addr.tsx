import { addressUrl, short, txUrl } from "@/lib/format";
import type { Address, Hex } from "viem";

export function Addr({ a, full = false }: { a: Address; full?: boolean }) {
  return (
    <a className="mono" href={addressUrl(a)} title={a} rel="noreferrer">
      {full ? a : short(a)}
    </a>
  );
}

export function Tx({ h, children }: { h: Hex; children?: React.ReactNode }) {
  return (
    <a className="mono" href={txUrl(h)} title={h} rel="noreferrer">
      {children ?? short(h)}
    </a>
  );
}
