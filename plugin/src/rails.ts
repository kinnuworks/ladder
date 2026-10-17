// The three rails a step can use, and how each step runs:
//   1. the errand releases at most the step's cap to the step's one-time runner key;
//   2. the runner pays the service with an ordinary x402 payment;
//   3. the runner signs in to read the result where the service requires it.
import { encodeFunctionData, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDC, signRungPayment, type Brief, type ErrandKey, type RailId, type Rung } from "./core.js";
import { PUBLIC_URL } from "./config.js";
import { RailRefused, fetchWithTimeout, getAsRunner, payAsRunner, probe, readChallenge, signAsRunner } from "./x402.js";

export const BASE_RPC = "https://mainnet.base.org";

export const RAILS: Record<RailId, { name: string; payTo?: Address; cap: bigint }> = {
  phone: { name: "StablePhone (AI phone call)", payTo: "0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801", cap: 540_000n },
  human: { name: "Mosbie (a person makes the call)", payTo: "0x4603366F72023572b139D19e354e9FA3A50c634B", cap: 15_000_000n },
  mail: { name: "PostalForm (USPS Certified Mail, return receipt)", cap: 20_000_000n },
};

const STABLEPHONE = "https://stablephone.dev/api/call";
const MOSBIE = "https://api.mosbie.com/v1/tasks/phone-call";
const POSTALFORM = "https://postalform.com/api/machine/orders";

// --- chain reads -------------------------------------------------------------

async function rpc(method: string, params: unknown[]) {
  const res = await fetchWithTimeout(
    BASE_RPC,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) },
    3000,
  );
  const j = (await res.json()) as { result?: Hex; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result!;
}

export async function usdcBalance(who: Address): Promise<bigint> {
  const data = encodeFunctionData({
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [who],
  });
  return BigInt(await rpc("eth_call", [{ to: USDC, data }, "latest"]));
}

async function post(path: string, body: unknown, ms = 6500) {
  const res = await fetchWithTimeout(`${PUBLIC_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, ms);
  const j = (await res.json().catch(() => ({}))) as any;
  if (res.status !== 200) throw new RailRefused("RELAY_FAILED", `${path}: ${j.error ?? res.status}`);
  return j;
}

/** Release `amount` from the errand to the step's runner, unless the runner already holds it. */
async function release(d: Decoded, rung: Rung, proof: Hex[], amount: bigint): Promise<string | undefined> {
  if ((await usdcBalance(rung.to)) >= amount) return undefined;
  const validBefore = BigInt(Math.min(Math.floor(Date.now() / 1000) + 300, d.key.terms.expiry - 1));
  const { authorization, signature } = await signRungPayment({ errand: d.errand, rung, proof, value: amount, validBefore, sessionKey: d.key.sessionKey });
  const r = await post("/api/move", { errand: d.errand, authorization, signature });
  return String(r.tx);
}

// --- what each rail is asked to do ----------------------------------------------

export function callTask(brief: Brief, followUp: boolean, reason: string): string {
  const who = brief.forName;
  return [
    `You are an automated assistant calling ${brief.business.name} on behalf of ${who}. Say this at the start of the call.`,
    `Goal: ${brief.goal}`,
    brief.accountRef ? `The account or membership reference is ${brief.accountRef}.` : "",
    followUp ? `This is a follow-up call. What happened before: ${reason}` : "",
    "Ask for the goal to be completed on this call. If it is done, ask for a confirmation or reference number and the date it takes effect, and repeat them back.",
    "If they say it cannot be done by phone, ask exactly how it must be done: the department, the postal address for written notice, and any form or wording they require. Write those down precisely.",
    "Do not agree to any new charge, plan change, retention offer or contract. Do not give out card numbers, passwords or full ID numbers. If they need identity verification you cannot provide, ask what is needed and end politely.",
    brief.callbackPhone ? `If they need to call back, give ${brief.callbackPhone}.` : "",
    "Be polite, brief and clear. At the end, summarise what was agreed.",
  ]
    .filter(Boolean)
    .join("\n");
}

function uuidFrom(nonce: Hex): string {
  const h = keccak256(toHex(`ladder-mail:${nonce}`)).slice(2, 34);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function mailOrder(brief: Brief, rung: Rung, letter: string) {
  const a = brief.business.address!;
  const s = brief.sender!;
  return {
    request_id: uuidFrom(rung.nonce),
    buyer_name: brief.forName.slice(0, 40),
    buyer_email: brief.replyEmail!,
    letter: { format: "markdown", title: brief.letterTitle ?? "Formal notice", body: letter, signature: brief.forName },
    file_name: "notice.pdf",
    sender_name: brief.forName.slice(0, 40),
    sender_address_type: "Manual",
    sender_address_manual: { line1: s.line1, ...(s.line2 ? { line2: s.line2 } : {}), city: s.city, state: s.state, zip: s.zip, countryCode: "US" },
    recipient_name: brief.business.name.slice(0, 40),
    recipient_address_type: "Manual",
    recipient_address_manual: { line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state, zip: a.zip, countryCode: "US" },
    double_sided: true,
    color: false,
    mail_class: "standard",
    certified: true,
    certified_return_receipt: true,
    return_receipt_format: "electronic",
    err_delivery: "email",
  };
}

// --- running and reading steps ---------------------------------------------------

export interface Decoded {
  key: ErrandKey;
  rungs: Rung[];
  proofs: Hex[][];
  errand: Address;
}

export interface StepResult {
  status: string;
  jobId: string;
  paid: { amount: string; transaction?: string };
  detail: Record<string, any>;
}

export async function runRung(d: Decoded & { index: number; reason: string; letter?: string }): Promise<StepResult> {
  const started = Date.now();
  const rung = d.rungs[d.index]!;
  const proof = d.proofs[d.index]!;
  const brief = d.key.brief!;
  const rail = RAILS[rung.rail];
  const earlierSameRail = d.rungs.slice(0, d.index).some((r) => r.rail === rung.rail);

  if (rung.rail === "phone") {
    const body = {
      phone_number: brief.business.phone!,
      task: callTask(brief, earlierSameRail, d.reason),
      first_sentence: `Hi, this is an automated assistant calling on behalf of ${brief.forName}.`,
      max_duration: 10,
      record: true,
      voicemail_action: "hangup",
      metadata: { ladder_errand: d.errand, ladder_step: String(d.index + 1) },
    };
    return payStep(d, rung, proof, STABLEPHONE, body, { payTo: rail.payTo, maxAmount: rung.max }, started, (b) => String(b.call_id));
  }

  if (rung.rail === "human") {
    if (!brief.replyEmail) throw new RailRefused("NEEDS_EMAIL", "The human-caller step reports by email; plan the errand with reply_email.");
    const body = {
      target_phone: brief.business.phone!,
      objective: `Call ${brief.business.name} on behalf of ${brief.forName}. ${brief.goal} ${brief.accountRef ? `Account reference: ${brief.accountRef}.` : ""} What happened so far: ${d.reason}. Do not agree to new charges. Report exactly what was said and any confirmation number.`.slice(0, 2000),
      reply_email: brief.replyEmail,
    };
    return payStep(d, rung, proof, MOSBIE, body, { payTo: rail.payTo, maxAmount: rung.max }, started, (b) => String(b.task_id));
  }

  // mail
  if (!d.letter) throw new RailRefused("NEEDS_LETTER", "Pass the full letter text for the certified-letter step.");
  if (!brief.business.address || !brief.sender || !brief.replyEmail) {
    throw new RailRefused("NEEDS_ADDRESSES", "The letter step needs the business's US address, the sender's US address and a reply email.");
  }
  const order = mailOrder(brief, rung, d.letter);
  const v = await fetchWithTimeout(`${POSTALFORM}/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(order) }, 4000);
  const quote = (await v.json().catch(() => ({}))) as any;
  if (v.status !== 200) throw new RailRefused("LETTER_INVALID", JSON.stringify(quote).slice(0, 400));
  const price = BigInt(Math.round(Number(quote.quote.price_usd) * 1e6));
  if (price > rung.max) throw new RailRefused("OVER_STEP_CAP", `The letter costs $${quote.quote.price_usd}; this step is capped at $${(Number(rung.max) / 1e6).toFixed(2)}.`);
  // The unpaid create returns this order's own deposit address; check it against the order's public status.
  const draft = await fetchWithTimeout(POSTALFORM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(order) }, 4000);
  const challenge = await readChallenge(draft);
  const orderId = String(challenge.body.order_id ?? order.request_id);
  const status = (await (await fetchWithTimeout(`${POSTALFORM}/${orderId}`, { headers: { accept: "application/json" } }, 3000)).json()) as any;
  const orderPayTo = getAddress(status?.x402?.pay_to ?? "0x0000000000000000000000000000000000000000");
  if (getAddress(challenge.requirement.payTo) !== orderPayTo) throw new RailRefused("PAYEE_MISMATCH", "PostalForm's payment address does not match the order's own status.");
  if (BigInt(challenge.requirement.amount) !== price) throw new RailRefused("PRICE_CHANGED", "PostalForm's payment request differs from its quote.");
  return payStep(d, rung, proof, POSTALFORM, order, { payTo: orderPayTo, maxAmount: price }, started, () => orderId, challenge);
}

async function payStep(
  d: Decoded,
  rung: Rung,
  proof: Hex[],
  url: string,
  body: unknown,
  expect: { payTo?: Address; maxAmount: bigint },
  started: number,
  jobId: (b: any) => string,
  known?: Awaited<ReturnType<typeof probe>>,
): Promise<StepResult> {
  const challenge = known ?? (await probe(url, "POST", body));
  const amount = BigInt(challenge.requirement.amount);
  const releaseTx = await release(d, rung, proof, amount);
  if (releaseTx && Date.now() - started > 4500) {
    return {
      status: "funds released to this step's key; run the same step again to place it",
      jobId: "",
      paid: { amount: "0" },
      detail: { release_tx: releaseTx, runner: rung.to },
    };
  }
  const res = await payAsRunner({ url, method: "POST", body, challenge, expect, runnerKey: rung.runnerKey });
  if (res.status >= 400) throw new RailRefused(`SERVICE_${res.status}`, `${RAILS[rung.rail].name} refused the request: ${JSON.stringify(res.body).slice(0, 300)} (not charged)`);
  return {
    status: "started",
    jobId: jobId(res.body),
    paid: { amount: res.amount.toString(), transaction: res.transaction },
    detail: { ...(releaseTx ? { release_tx: releaseTx } : {}), runner: rung.to, service: res.body },
  };
}

export async function readRung(d: Decoded & { index: number; jobId: string }) {
  const rung = d.rungs[d.index]!;
  const brief = d.key.brief!;
  if (rung.rail === "phone") {
    const r = await getAsRunner(`${STABLEPHONE}/${encodeURIComponent(d.jobId)}`, rung.runnerKey);
    const b = r.body ?? {};
    return {
      status: String(b.status ?? r.status),
      done: !!b.completed,
      summary: String(b.summary ?? b.error_message ?? "The call is still in progress."),
      detail: { answered_by: b.answered_by ?? null, call_length: b.call_length ?? null, transcript: b.transcript ?? null, recording_url: b.recording_url ?? null },
    };
  }
  if (rung.rail === "human") {
    return { status: "accepted", done: false, summary: `A person will make the call and email the report to ${brief.replyEmail}.`, detail: {} };
  }
  const res = await fetchWithTimeout(`${POSTALFORM}/${encodeURIComponent(d.jobId)}`, { headers: { accept: "application/json" } }, 4000);
  const b = (await res.json().catch(() => ({}))) as any;
  return {
    status: String(b.current_step ?? b.status ?? res.status),
    done: !!b.tracking_number,
    summary: b.tracking_number ? `Certified Mail article ${b.tracking_number}. Track: ${b.usps_tracking_url ?? b.tracking_url}` : "The letter is being prepared for mailing.",
    detail: { is_paid: b.is_paid ?? null, tracking_number: b.tracking_number ?? null, usps_tracking_url: b.usps_tracking_url ?? null, err_status: b.err_status ?? null },
  };
}

/** Return anything left on runner keys to the owner, then close the errand. */
export async function sweepRunners(d: Decoded): Promise<string[]> {
  const txs: string[] = [];
  for (const rung of d.rungs) {
    const bal = await usdcBalance(rung.to);
    if (bal === 0n) continue;
    const { authorization, signature } = await signAsRunner(rung.runnerKey, d.key.terms.owner, bal, BigInt(Math.floor(Date.now() / 1000) + 300));
    const r = await post("/api/sweep", { errand: d.errand, runner: privateKeyToAccount(rung.runnerKey).address, authorization, signature });
    txs.push(String(r.tx));
  }
  return txs;
}
