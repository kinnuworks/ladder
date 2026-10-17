// /verify: recompute an errand address from pasted terms and compare with what is on chain.
import { type Address, getAddress } from "viem";
import { predictErrand, type Terms } from "./core";
import { cloneRuntimeCode, errandAbi, factoryAbi, publicClient } from "./chain";
import { readConfig } from "./config";
import { firstIssue, termsInputSchema } from "./schema";

export type ParsedTerms = { ok: true; terms: Terms; filled: string[] } | { ok: false; message: string };

export function parseTermsInput(input: string): ParsedTerms {
  const text = input.trim();
  if (text.startsWith("ldr1_")) {
    return { ok: false, message: "That is an errand key. It contains the session key, so do not paste it anywhere. Paste only the terms." };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: "The terms are not valid JSON." };
  }
  if (json && typeof json === "object" && "terms" in json) json = (json as { terms: unknown }).terms;
  const parsed = termsInputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const cfg = readConfig();
  const filled: string[] = [];
  let { factory, implementation } = parsed.data;
  if (!factory) {
    if (!cfg.factory) return { ok: false, message: "The terms have no factory and this site has no FACTORY_ADDRESS set." };
    factory = cfg.factory;
    filled.push("factory");
  }
  if (!implementation) {
    if (!cfg.implementation) return { ok: false, message: "The terms have no implementation and this site has no IMPLEMENTATION_ADDRESS set." };
    implementation = cfg.implementation;
    filled.push("implementation");
  }
  return { ok: true, terms: { ...parsed.data, factory, implementation }, filled };
}

export interface VerifyResult {
  predicted: Address;
  factoryIsLadder: boolean | null;
  factoryPredict: Address | null;
  deployed: boolean;
  cloneOfImplementation: boolean | null;
  stored: Array<{ field: string; expected: string; onChain: string; match: boolean }>;
}

export async function verifyTerms(terms: Terms): Promise<VerifyResult> {
  const cfg = readConfig();
  const predicted = predictErrand(terms);
  const pub = publicClient();
  const [code, factoryPredict] = await Promise.all([
    pub.getCode({ address: predicted }),
    pub
      .readContract({
        address: terms.factory,
        abi: factoryAbi,
        functionName: "predict",
        args: [terms.owner, terms.sessionSigner, BigInt(terms.expiry), terms.rungsRoot],
      })
      .then(getAddress)
      .catch(() => null),
  ]);
  const deployed = !!code && code !== "0x";
  const stored: VerifyResult["stored"] = [];
  if (deployed) {
    const read = <F extends "owner" | "sessionSigner" | "expiry" | "rungsRoot">(functionName: F) =>
      pub.readContract({ address: predicted, abi: errandAbi, functionName });
    const [owner, signer, expiry, root] = await Promise.all([read("owner"), read("sessionSigner"), read("expiry"), read("rungsRoot")]);
    const row = (field: string, expected: string, onChain: string) =>
      stored.push({ field, expected, onChain, match: expected.toLowerCase() === onChain.toLowerCase() });
    row("owner", terms.owner, getAddress(owner as Address));
    row("sessionSigner", terms.sessionSigner, getAddress(signer as Address));
    row("expiry", String(terms.expiry), String(expiry));
    row("rungsRoot", terms.rungsRoot, root as string);
  }
  return {
    predicted,
    factoryIsLadder: cfg.factory ? terms.factory === cfg.factory : null,
    factoryPredict,
    deployed,
    cloneOfImplementation: deployed ? code!.toLowerCase() === cloneRuntimeCode(terms.implementation) : null,
    stored,
  };
}
