// Server-side configuration. Values come only from the environment; nothing here is a default
// address. Secrets (RELAYER_PRIVATE_KEY) are never returned or logged.
import { type Address, type Hex, getAddress, isAddress, isHex } from "viem";

export interface PublicConfig {
  factory: Address | null;
  implementation: Address | null;
  deployBlock: bigint | null;
  rpcUrl: string | null;
  publicUrl: string | null;
  exampleErrand: Address | null;
  examplePlan: string | null;
  repoUrl: string | null;
  payboxInstallUrl: string | null;
}

function addr(v: string | undefined): Address | null {
  return v && isAddress(v, { strict: false }) ? getAddress(v) : null;
}

export function readConfig(env: Record<string, string | undefined> = process.env): PublicConfig {
  const block = env.DEPLOY_BLOCK?.trim();
  return {
    factory: addr(env.FACTORY_ADDRESS?.trim()),
    implementation: addr(env.IMPLEMENTATION_ADDRESS?.trim()),
    deployBlock: block && /^\d+$/.test(block) ? BigInt(block) : null,
    rpcUrl: env.BASE_RPC_URL?.trim() || null,
    publicUrl: env.PUBLIC_URL?.trim().replace(/\/+$/, "") || null,
    exampleErrand: addr(env.EXAMPLE_ERRAND?.trim()),
    examplePlan: env.EXAMPLE_PLAN?.trim() || null,
    repoUrl: env.REPO_URL?.trim().replace(/\/+$/, "") || null,
    payboxInstallUrl: env.PAYBOX_INSTALL_URL?.trim() || null,
  };
}

export function relayerKey(env: Record<string, string | undefined> = process.env): Hex | null {
  const k = env.RELAYER_PRIVATE_KEY?.trim();
  if (!k) return null;
  const hex = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  return isHex(hex) && hex.length === 66 ? hex : null;
}

export class ConfigError extends Error {}

/** The parts the funding and refund routes cannot run without. */
export function requireConfig(cfg = readConfig()) {
  const missing: string[] = [];
  if (!cfg.factory) missing.push("FACTORY_ADDRESS");
  if (!cfg.implementation) missing.push("IMPLEMENTATION_ADDRESS");
  if (!cfg.rpcUrl) missing.push("BASE_RPC_URL");
  if (!cfg.publicUrl) missing.push("PUBLIC_URL");
  if (missing.length) throw new ConfigError(`Server is missing ${missing.join(", ")}.`);
  return cfg as PublicConfig & { factory: Address; implementation: Address; rpcUrl: string; publicUrl: string };
}

/** Where "Add to PayBox" points: the configured install link, else the plugin's source, else the page section. */
export function installUrl(cfg: PublicConfig): string {
  if (cfg.payboxInstallUrl) return cfg.payboxInstallUrl;
  if (cfg.repoUrl) return `${cfg.repoUrl}/tree/HEAD/plugin`;
  return "/#add";
}
