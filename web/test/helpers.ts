import { type Address, type Hex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildTree, predictErrand, randomHex32, rungLeaf, type Terms } from "../lib/core";
import { typedAuthorization } from "../lib/relay";
import type { ParsedAuthorization } from "../lib/schema";

export const FACTORY = getAddress("0x1111111111111111111111111111111111111111");
export const IMPLEMENTATION = getAddress("0x2222222222222222222222222222222222222222");
// Fixed test keys (anvil's default accounts 1 and 2). Never funded on mainnet.
export const OWNER_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const OTHER_KEY: Hex = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
export const owner = privateKeyToAccount(OWNER_KEY);
export const other = privateKeyToAccount(OTHER_KEY);

export const runners = {
  phone: getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"),
  human: getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2"),
  mail: getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3"),
};

export function fixture(now = Math.floor(Date.now() / 1000)) {
  const leaves = [randomHex32(), randomHex32(), randomHex32()];
  const { root } = buildTree(leaves.map((l) => rungLeaf({ nonce: l, to: runners.phone, max: 1n, salt: l })));
  const terms: Terms = {
    factory: FACTORY,
    implementation: IMPLEMENTATION,
    owner: owner.address,
    sessionSigner: getAddress("0x3333333333333333333333333333333333333333"),
    expiry: now + 86_400,
    rungsRoot: root,
  };
  const errand = predictErrand(terms);
  const plan = {
    business: "Northside Gym",
    rungs: [
      { rail: "phone", label: "AI call to Northside Gym", to: runners.phone, max: "540000" },
      { rail: "human", label: "A person calls Northside Gym", to: runners.human, max: "15000000" },
      { rail: "mail", label: "Certified letter to Northside Gym", to: runners.mail, max: "15000000" },
    ],
  };
  const body = {
    terms: { owner: terms.owner, sessionSigner: terms.sessionSigner, expiry: terms.expiry, rungsRoot: terms.rungsRoot },
    budget: "30540000",
    plan,
  };
  return { terms, errand, plan, body, now };
}

export async function signAuthorization(
  key: Hex,
  a: { from: Address; to: Address; value: string; validAfter?: string; validBefore: string; nonce?: Hex },
): Promise<{ authorization: ParsedAuthorization; signature: Hex }> {
  const authorization: ParsedAuthorization = {
    from: a.from,
    to: a.to,
    value: a.value,
    validAfter: a.validAfter ?? "0",
    validBefore: a.validBefore,
    nonce: (a.nonce ?? randomHex32()).toLowerCase() as Hex,
  };
  const signature = await privateKeyToAccount(key).signTypedData(typedAuthorization(authorization));
  return { authorization, signature };
}

export const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
export const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
