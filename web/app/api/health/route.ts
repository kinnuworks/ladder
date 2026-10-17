// GET /api/health: configuration and chain reachability. Never returns secrets.
import { formatEther, getAddress } from "viem";
import { CHAIN_ID } from "@/lib/core";
import { factoryAbi, publicClient, relayerAddress } from "@/lib/chain";
import { readConfig } from "@/lib/config";
import { json, redact } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const cfg = readConfig();
  const relayer = relayerAddress();
  const configured = {
    FACTORY_ADDRESS: !!cfg.factory,
    IMPLEMENTATION_ADDRESS: !!cfg.implementation,
    DEPLOY_BLOCK: cfg.deployBlock !== null,
    RELAYER_PRIVATE_KEY: !!relayer,
    BASE_RPC_URL: !!cfg.rpcUrl,
    PUBLIC_URL: !!cfg.publicUrl,
  };
  const out: Record<string, unknown> = {
    chainId: CHAIN_ID,
    configured,
    factory: cfg.factory,
    implementation: cfg.implementation,
    deployBlock: cfg.deployBlock?.toString() ?? null,
    relayer,
  };
  let rpcOk = false;
  let factoryOk = false;
  if (cfg.rpcUrl) {
    try {
      const pub = publicClient();
      const [chainId, block] = await Promise.all([pub.getChainId(), pub.getBlockNumber()]);
      rpcOk = chainId === CHAIN_ID;
      out.rpc = { chainId, blockNumber: block.toString() };
      if (relayer) out.relayerBalanceEth = formatEther(await pub.getBalance({ address: relayer }));
      if (cfg.factory && cfg.implementation) {
        const impl = await pub.readContract({ address: cfg.factory, abi: factoryAbi, functionName: "implementation" });
        factoryOk = getAddress(impl) === cfg.implementation;
        out.factoryImplementationMatches = factoryOk;
      }
    } catch (err) {
      out.rpcError = redact((err as { shortMessage?: string })?.shortMessage ?? "RPC unreachable");
    }
  }
  const ok = Object.values(configured).every(Boolean) && rpcOk && factoryOk;
  return json({ ok, ...out }, ok ? 200 : 503);
}
