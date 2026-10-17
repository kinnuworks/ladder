// Deployment constants, baked into the bundle. scripts/set-deployment.mjs rewrites these
// after the factory is deployed; the bundle never reads environment variables.
import type { Address } from "viem";

export const PUBLIC_URL = "https://ladder-errands.vercel.app";
export const FACTORY: Address = "0x0000000000000000000000000000000000000000";
export const IMPLEMENTATION: Address = "0x0000000000000000000000000000000000000000";
export const DEPLOYED = false;
