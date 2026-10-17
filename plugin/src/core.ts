// Shared errand logic: terms, the rung tree, the errand address, and the signatures
// the errand contract accepts. Pure functions only, so the backend and tests reuse them.
import {
  type Address,
  type Hex,
  bytesToHex,
  concat,
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  toHex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

export const CHAIN_ID = 8453;
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Base USDC (FiatTokenV2_2) EIP-712 domain separator, as read from the token. */
export const USDC_DOMAIN_SEPARATOR: Hex = keccak256(
  encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"), [
    keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
    keccak256(toHex("USD Coin")),
    keccak256(toHex("2")),
    BigInt(CHAIN_ID),
    USDC,
  ]),
);

export const TRANSFER_WITH_AUTHORIZATION_TYPEHASH: Hex =
  "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267";

export type RailId = "phone" | "human" | "mail";

/** One step of the ladder as committed on-chain: who may be paid, at most how much, once. */
export interface Rung {
  rail: RailId;
  label: string;
  /** The step's one-time runner: the only address this rung can pay. */
  to: Address;
  max: bigint;
  nonce: Hex;
  salt: Hex;
  /** The runner's private key. Secret; kept only in the agent's errand key. */
  runnerKey: Hex;
}

export interface Terms {
  factory: Address;
  implementation: Address;
  owner: Address;
  sessionSigner: Address;
  expiry: number;
  rungsRoot: Hex;
}

// --- rung tree -------------------------------------------------------------

export function rungLeaf(r: { nonce: Hex; to: Address; max: bigint; salt: Hex }): Hex {
  return keccak256(
    keccak256(encodeAbiParameters(parseAbiParameters("bytes32, address, uint256, bytes32"), [r.nonce, r.to, r.max, r.salt])),
  );
}

function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** Sorted-pair Merkle tree, compatible with OpenZeppelin's MerkleProof.verify. Odd nodes carry up. */
export function buildTree(leaves: Hex[]): { root: Hex; proofs: Hex[][] } {
  if (leaves.length === 0) throw new Error("An errand needs at least one rung.");
  const proofs: Hex[][] = leaves.map(() => []);
  let layer = leaves.map((h, i) => ({ h, members: [i] }));
  while (layer.length > 1) {
    const next: typeof layer = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      for (const m of left.members) proofs[m]!.push(right.h);
      for (const m of right.members) proofs[m]!.push(left.h);
      next.push({ h: hashPair(left.h, right.h), members: [...left.members, ...right.members] });
    }
    layer = next;
  }
  return { root: layer[0]!.h, proofs };
}

export function verifyProof(proof: Hex[], root: Hex, leaf: Hex): boolean {
  return proof.reduce((acc, p) => hashPair(acc, p), leaf) === root;
}

// --- errand address --------------------------------------------------------

export function termsSalt(t: Pick<Terms, "owner" | "sessionSigner" | "expiry" | "rungsRoot">): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address, address, uint64, bytes32"), [
      t.owner,
      t.sessionSigner,
      BigInt(t.expiry),
      t.rungsRoot,
    ]),
  );
}

/** EIP-1167 creation code, as deployed by OpenZeppelin Clones.cloneDeterministic. */
export function cloneInitCode(implementation: Address): Hex {
  return concat([
    "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
    implementation.toLowerCase() as Hex,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]);
}

export function predictErrand(t: Terms): Address {
  return getContractAddress({
    opcode: "CREATE2",
    from: t.factory,
    salt: termsSalt(t),
    bytecode: cloneInitCode(t.implementation),
  });
}

// --- signatures the errand accepts ----------------------------------------

export function authorizationDigest(input: {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}): Hex {
  const structHash = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, address, address, uint256, uint256, uint256, bytes32"), [
      TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
      input.from,
      input.to,
      input.value,
      input.validAfter,
      input.validBefore,
      input.nonce,
    ]),
  );
  return keccak256(concat(["0x1901", USDC_DOMAIN_SEPARATOR, structHash]));
}

async function signRaw(digest: Hex, privateKey: Hex): Promise<Hex> {
  const s = await sign({ hash: digest, privateKey });
  const v = s.yParity === 1 ? 28 : 27;
  return concat([s.r, s.s, toHex(v, { size: 1 })]);
}

const RUNG_AUTH = parseAbiParameters(
  "(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint256 max, bytes32 salt, bytes32[] proof, bytes sessionSig)",
);

export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

/** Build the USDC authorization and the ERC-1271 signature for one rung payment. */
export async function signRungPayment(input: {
  errand: Address;
  rung: Rung;
  proof: Hex[];
  value: bigint;
  validBefore: bigint;
  sessionKey: Hex;
}): Promise<{ authorization: Authorization; signature: Hex }> {
  const { errand, rung, proof, value, validBefore, sessionKey } = input;
  if (value > rung.max) throw new Error(`The ${rung.rail} rung is capped at ${rung.max} and this costs ${value}.`);
  const validAfter = 0n;
  const digest = authorizationDigest({ from: errand, to: rung.to, value, validAfter, validBefore, nonce: rung.nonce });
  const sessionSig = await signRaw(digest, sessionKey);
  const signature = encodeAbiParameters(RUNG_AUTH, [
    { to: rung.to, value, validAfter, validBefore, nonce: rung.nonce, max: rung.max, salt: rung.salt, proof, sessionSig },
  ]);
  return {
    authorization: {
      from: errand,
      to: rung.to,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce: rung.nonce,
    },
    signature,
  };
}

export const REFUND_TYPEHASH: Hex = keccak256(toHex("LadderRefund(address errand,uint256 chainId)"));

export async function signRefund(errand: Address, sessionKey: Hex): Promise<Hex> {
  const digest = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, address, uint256"), [REFUND_TYPEHASH, errand, BigInt(CHAIN_ID)]),
  );
  return signRaw(digest, sessionKey);
}

// --- sign-in (SIWX / EIP-4361), signed by a step's runner key -------------

export interface SignInInfo {
  domain: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  statement?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

/** EIP-4361 message text, matching the siwe library's prepareMessage(). */
export function siweMessage(info: SignInInfo, address: Address): string {
  const chainId = Number(/^eip155:(\d+)$/.exec(info.chainId)?.[1] ?? info.chainId);
  const head = `${info.domain} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\n`;
  const statement = info.statement ? `${info.statement}\n\n` : "";
  const fields = [`URI: ${info.uri}`, `Version: ${info.version}`, `Chain ID: ${chainId}`, `Nonce: ${info.nonce}`, `Issued At: ${info.issuedAt}`];
  if (info.expirationTime) fields.push(`Expiration Time: ${info.expirationTime}`);
  if (info.notBefore) fields.push(`Not Before: ${info.notBefore}`);
  if (info.requestId) fields.push(`Request ID: ${info.requestId}`);
  if (info.resources?.length) fields.push(`Resources:\n${info.resources.map((r) => `- ${r}`).join("\n")}`);
  return head + statement + fields.join("\n");
}

// --- the errand key the agent keeps --------------------------------------

/** Everything the agent must hold to run the errand. Never sent to the Ladder backend. */
export interface ErrandKey {
  v: 1 | 2;
  terms: Terms;
  sessionKey: Hex;
  rungs: Array<Omit<Rung, "max"> & { max: string }>;
  /** Atomic USDC the owner funds. */
  budget?: string;
  brief?: Brief;
  /** Version 2: the 32-byte secret every key, nonce and salt is derived from. */
  seed?: Hex;
}

/** The compact form the agent carries: one seed instead of every key. Decodes to an ErrandKey. */
interface SeededKey {
  v: 2;
  seed: Hex;
  terms: { factory: Address; implementation: Address; owner: Address; expiry: number };
  /** [rail, label, max] per step, in order. */
  rungs: [RailId, string, string][];
  budget?: string;
  brief?: Brief;
  /** The errand address these values produce, so a mistyped key is caught instead of pointing elsewhere. */
  errand: Address;
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** A value derived from the errand seed for one purpose, such as "session" or "runner:0". */
export function fromSeed(seed: Hex, purpose: string): Hex {
  return keccak256(concat([seed, toHex(`ladder:${purpose}`)]));
}

/** A private key derived from the seed; re-hashed in the (vanishingly rare) case it is out of range. */
export function keyFromSeed(seed: Hex, purpose: string): Hex {
  let k = fromSeed(seed, purpose);
  while (BigInt(k) === 0n || BigInt(k) >= SECP256K1_N) k = keccak256(k);
  return k;
}

/** Step i of an errand, entirely determined by the seed, its rail, label and cap. */
export function seededRung(seed: Hex, i: number, rail: RailId, label: string, max: bigint): Rung {
  const runnerKey = keyFromSeed(seed, `runner:${i}`);
  return { rail, label, to: privateKeyToAccount(runnerKey).address, max, nonce: fromSeed(seed, `nonce:${i}`), salt: fromSeed(seed, `salt:${i}`), runnerKey };
}

/** Encode a version-2 key from its seed. Everything else is recomputed when it is decoded. */
export function encodeSeededKey(k: Omit<SeededKey, "v">): string {
  return "ldr1_" + Buffer.from(JSON.stringify({ v: 2, ...k })).toString("base64url");
}

function expandSeeded(k: SeededKey): ErrandKey {
  const rungs = k.rungs.map(([rail, label, max], i) => seededRung(k.seed, i, rail, label, BigInt(max)));
  const sessionKey = keyFromSeed(k.seed, "session");
  const terms: Terms = {
    ...k.terms,
    sessionSigner: privateKeyToAccount(sessionKey).address,
    rungsRoot: buildTree(rungs.map(rungLeaf)).root,
  };
  if (predictErrand(terms) !== getAddress(k.errand)) throw new Error("This errand key is damaged: it no longer produces its errand's address.");
  return { v: 2, terms, sessionKey, rungs: rungs.map((r) => ({ ...r, max: r.max.toString() })), budget: k.budget, brief: k.brief, seed: k.seed };
}

/** What the errand is for. Stays in the agent's errand key; only the business name is sent to Ladder's server. */
export interface Brief {
  goal: string;
  forName: string;
  business: {
    name: string;
    /** IANA time zone, used to call only during business hours. */
    timeZone?: string;
    phone?: string;
    email?: string;
    address?: { line1: string; line2?: string; city: string; state: string; zip: string };
  };
  accountRef?: string;
  callbackPhone?: string;
  /** Where the human caller's report and the letter's return receipt are emailed. */
  replyEmail?: string;
  /** The user's US return address, printed on the certified letter. */
  sender?: { line1: string; line2?: string; city: string; state: string; zip: string };
  letterTitle?: string;
}

export function encodeErrandKey(k: ErrandKey): string {
  return "ldr1_" + Buffer.from(JSON.stringify(k)).toString("base64url");
}

export function decodeErrandKey(s: string): { key: ErrandKey; rungs: Rung[]; proofs: Hex[][]; errand: Address } {
  if (!s.startsWith("ldr1_")) throw new Error("That is not a Ladder errand key.");
  const raw = JSON.parse(Buffer.from(s.slice(5), "base64url").toString("utf8")) as { v?: unknown; seed?: unknown };
  if (raw.v !== 1 && raw.v !== 2) throw new Error("Unsupported errand key version.");
  if (raw.v === 2 && !(typeof raw.seed === "string" && /^0x[0-9a-fA-F]{64}$/.test(raw.seed))) throw new Error("This errand key's seed is malformed.");
  const key = raw.v === 2 ? expandSeeded(raw as SeededKey) : (raw as ErrandKey);
  const rungs: Rung[] = key.rungs.map((r) => ({ ...r, to: getAddress(r.to), max: BigInt(r.max) }));
  const { root, proofs } = buildTree(rungs.map(rungLeaf));
  if (root !== key.terms.rungsRoot) throw new Error("This errand key does not match its own rung commitment.");
  if (privateKeyToAccount(key.sessionKey).address !== getAddress(key.terms.sessionSigner)) {
    throw new Error("This errand key's session key does not match its signer.");
  }
  for (const r of rungs) {
    if (privateKeyToAccount(r.runnerKey).address !== r.to) throw new Error("A step's runner key does not match its committed runner.");
  }
  return { key, rungs, proofs, errand: predictErrand(key.terms) };
}

export function randomHex32(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function newSessionKey(): { privateKey: Hex; address: Address } {
  for (;;) {
    const privateKey = randomHex32();
    const n = BigInt(privateKey);
    if (n > 0n && n < 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n) {
      return { privateKey, address: privateKeyToAccount(privateKey).address };
    }
  }
}

export { hexToBytes };
