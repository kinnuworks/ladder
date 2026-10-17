// Deployment constants, baked into the bundle. scripts/set-deployment.mjs rewrites these
// after the factory is deployed; the bundle never reads environment variables.
import type { Address } from "viem";

export const PUBLIC_URL = "https://ladder-errands.vercel.app";
export const FACTORY: Address = "0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c";
export const IMPLEMENTATION: Address = "0xc580544b22560C97f360d3e40Fb48464D85E7c06";
// The factory is deployed from the relayer's first transaction, so these addresses are fixed in advance.
export const DEPLOYED = true;
