// The rail registry. A rung commits a one-time runner address and a cap; when the step runs the
// errand releases at most the cap to the runner, and the runner pays the rail with a normal
// EOA x402 payment. So the registry fixes the per-rail caps, and the known rail payees used to
// label runner payments on the errand page.
import { type Address, getAddress } from "viem";
import type { RailId } from "./core";

export interface Rail {
  id: RailId;
  name: string;
  service: string;
  /** Fixed payee, when the rail has one. PostalForm uses a fresh deposit address per order. */
  payTo: Address | null;
  /** Label for what a runner on this rail pays. */
  paymentLabel: string;
  /** Typical price, for display. */
  price: string;
  /** The largest cap a rung on this rail may commit, in atomic USDC (6 decimals). */
  cap: bigint;
}

export const RAILS: readonly Rail[] = [
  {
    id: "phone",
    name: "StablePhone",
    service: "AI phone call",
    payTo: getAddress("0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801"),
    paymentLabel: "StablePhone call",
    price: "$0.54",
    cap: 540_000n,
  },
  {
    id: "human",
    name: "Mosbie",
    service: "Human call or email",
    payTo: getAddress("0x4603366F72023572b139D19e354e9FA3A50c634B"),
    paymentLabel: "Mosbie task",
    price: "$15",
    cap: 15_000_000n,
  },
  {
    id: "mail",
    name: "PostalForm",
    service: "Certified mail",
    payTo: null,
    paymentLabel: "PostalForm order deposit",
    price: "$11.40 to $14.40",
    cap: 20_000_000n,
  },
];

export const RAIL_IDS = RAILS.map((r) => r.id);

export function railById(id: string): Rail | undefined {
  return RAILS.find((r) => r.id === id);
}

export function railByPayee(addr: Address): Rail | undefined {
  const a = getAddress(addr);
  return RAILS.find((r) => r.payTo === a);
}
