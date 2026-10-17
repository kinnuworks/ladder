// The errand page's data: read terms, balance and USDC transfers from chain, then shape them
// into a timeline. `shapeErrand` is pure so it can be tested against mocked logs.
import { type Address, type Hex, getAddress } from "viem";
import { USDC } from "./core";
import { errandAbi, factoryAbi, publicClient, usdcAbi } from "./chain";
import { readConfig } from "./config";
import { addressUrl, isoTime, txUrl, usd } from "./format";
import { railById, railByPayee } from "./rails";
import { type Plan, planRungIssues } from "./schema";

const BASE_BLOCK_SECONDS = 2;

export interface TransferLog {
  from: Address;
  to: Address;
  value: bigint;
  tx: Hex;
  block: bigint;
  logIndex: number;
}

export interface ErrandState {
  owner: Address;
  sessionSigner: Address;
  expiry: number;
  closed: boolean;
  rungsRoot: Hex;
}

export interface RawErrand {
  address: Address;
  now: number;
  latestBlock: bigint;
  latestTime: number;
  state: ErrandState | null;
  balance: bigint;
  opened: { tx: Hex; block: bigint } | null;
  transfersIn: TransferLog[];
  transfersOut: TransferLog[];
  runnerTransfers: TransferLog[];
  plan: Plan | null;
  planError: string | null;
}

export type RowKind = "fund" | "release" | "rail-payment" | "sweep" | "refund" | "unknown";

export interface Row {
  kind: RowKind;
  label: string;
  from: Address;
  to: Address;
  toLabel: string;
  amount: string;
  amountUsd: string;
  tx: Hex;
  txUrl: string;
  block: string;
  time: number;
  timeIso: string;
  rung: number | null;
  flagged: boolean;
  note: string | null;
}

export interface RungView {
  index: number;
  rail: string;
  railName: string;
  service: string;
  label: string;
  runner: Address;
  runnerUrl: string;
  max: string;
  maxUsd: string;
  state: "unused" | "released" | "paid";
  released: string;
  paid: string;
  swept: string;
  checks: Array<{ ok: boolean; text: string }>;
}

export interface ErrandView {
  address: Address;
  addressUrl: string;
  deployed: boolean;
  status: "not-opened" | "open" | "expired" | "closed";
  terms: (Omit<ErrandState, "expiry"> & { expiry: number; expiryIso: string }) | null;
  expiresIn: number | null;
  balance: string;
  balanceUsd: string;
  funded: string;
  fundedUsd: string;
  openTx: Hex | null;
  openTxUrl: string | null;
  timeline: Row[];
  plan: { business: string | null } | null;
  rungs: RungView[];
  planIssues: string[];
  flags: string[];
  runnersKnown: boolean;
  updatedAt: number;
}

function blockTime(raw: RawErrand, block: bigint): number {
  return raw.latestTime - Number(raw.latestBlock - block) * BASE_BLOCK_SECONDS;
}

function order(a: TransferLog, b: TransferLog) {
  return a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1;
}

export function shapeErrand(raw: RawErrand): ErrandView {
  const owner = raw.state?.owner ?? null;
  const plan = raw.plan;
  const planIssues: string[] = [];
  if (raw.planError) planIssues.push(raw.planError);
  if (plan) {
    planIssues.push(...planRungIssues(plan));
    if (plan.errand && plan.errand !== raw.address) planIssues.push("The plan names a different errand address.");
  }
  const runnerIndex = new Map<Address, number>();
  plan?.rungs.forEach((r, i) => runnerIndex.set(r.to, i));
  const flags: string[] = [];

  const row = (t: TransferLog, kind: RowKind, label: string, toLabel: string, rung: number | null, flagged = false, note: string | null = null): Row => {
    const time = blockTime(raw, t.block);
    return {
      kind,
      label,
      from: t.from,
      to: t.to,
      toLabel,
      amount: t.value.toString(),
      amountUsd: usd(t.value),
      tx: t.tx,
      txUrl: txUrl(t.tx),
      block: t.block.toString(),
      time,
      timeIso: isoTime(time),
      rung,
      flagged,
      note,
    };
  };

  const rows: Row[] = [];
  let funded = 0n;
  for (const t of raw.transfersIn) {
    const fromRunner = runnerIndex.get(t.from);
    if (fromRunner === undefined) funded += t.value;
    rows.push(
      row(t, "fund", fromRunner !== undefined ? "Returned by runner" : t.from === owner ? "Funded by owner" : "Deposit", "Errand", fromRunner ?? null),
    );
  }

  const released = new Map<number, bigint>();
  const releaseCount = new Map<number, number>();
  for (const t of raw.transfersOut) {
    if (owner && t.to === owner) {
      rows.push(row(t, "refund", "Refund to owner", "Owner", null));
      continue;
    }
    const i = runnerIndex.get(t.to);
    if (i !== undefined) {
      const r = plan!.rungs[i]!;
      released.set(i, (released.get(i) ?? 0n) + t.value);
      releaseCount.set(i, (releaseCount.get(i) ?? 0) + 1);
      const over = t.value > BigInt(r.max);
      if (over) flags.push(`Rung ${i + 1} released ${usd(t.value)}, above its planned cap of ${usd(r.max)}.`);
      rows.push(row(t, "release", `Released to rung ${i + 1} runner`, `Runner ${i + 1}`, i, over));
    } else if (plan) {
      flags.push(`The errand paid ${usd(t.value)} to ${t.to}, which is not a runner in the plan.`);
      rows.push(row(t, "unknown", "Payment to an address not in the plan", "Unknown", null, true));
    } else {
      rows.push(row(t, "release", "Released to a runner", "Runner", null, false, "Add the plan link to see which rung this was."));
    }
  }

  const paid = new Map<number, bigint>();
  const swept = new Map<number, bigint>();
  for (const t of raw.runnerTransfers) {
    const i = runnerIndex.get(t.from);
    if (i === undefined) continue;
    const r = plan!.rungs[i]!;
    const rail = railById(r.rail);
    if (owner && t.to === owner) {
      swept.set(i, (swept.get(i) ?? 0n) + t.value);
      rows.push(row(t, "sweep", `Runner ${i + 1} returned unspent money to owner`, "Owner", i));
      continue;
    }
    if (t.to === raw.address) continue; // already listed as a transfer in
    const payee = railByPayee(t.to);
    const expected = rail?.payTo ? payee?.id === rail.id : rail?.id === "mail" && !payee;
    paid.set(i, (paid.get(i) ?? 0n) + t.value);
    if (expected && rail) {
      rows.push(row(t, "rail-payment", `Runner ${i + 1} paid ${rail.name}`, rail.paymentLabel, i));
    } else {
      flags.push(`Runner ${i + 1} paid ${usd(t.value)} to ${t.to}, which is not the ${rail?.name ?? "planned"} rail.`);
      rows.push(row(t, "unknown", `Runner ${i + 1} paid an unexpected address`, "Unknown", i, true));
    }
  }

  rows.sort((a, b) => (a.block === b.block ? 0 : BigInt(a.block) < BigInt(b.block) ? -1 : 1));

  const rungs: RungView[] = (plan?.rungs ?? []).map((r, i) => {
    const rail = railById(r.rail);
    const rel = released.get(i) ?? 0n;
    const pay = paid.get(i) ?? 0n;
    const sw = swept.get(i) ?? 0n;
    const checks: RungView["checks"] = [];
    if (rel > 0n) {
      checks.push({ ok: rel <= BigInt(r.max), text: `Released ${usd(rel)} against a cap of ${usd(r.max)}.` });
      checks.push({ ok: (releaseCount.get(i) ?? 0) <= 1, text: `Released ${releaseCount.get(i)} time${releaseCount.get(i) === 1 ? "" : "s"}.` });
      checks.push({ ok: pay + sw <= rel, text: `Runner spent ${usd(pay)} and returned ${usd(sw)} of ${usd(rel)}.` });
    }
    return {
      index: i,
      rail: r.rail,
      railName: rail?.name ?? r.rail,
      service: rail?.service ?? "",
      label: r.label,
      runner: r.to,
      runnerUrl: addressUrl(r.to),
      max: r.max,
      maxUsd: usd(r.max),
      state: pay > 0n ? "paid" : rel > 0n ? "released" : "unused",
      released: rel.toString(),
      paid: pay.toString(),
      swept: sw.toString(),
      checks,
    };
  });

  const s = raw.state;
  const status: ErrandView["status"] = !s ? "not-opened" : s.closed ? "closed" : raw.now >= s.expiry ? "expired" : "open";
  return {
    address: raw.address,
    addressUrl: addressUrl(raw.address),
    deployed: !!s,
    status,
    terms: s ? { ...s, expiryIso: isoTime(s.expiry) } : null,
    expiresIn: s ? s.expiry - raw.now : null,
    balance: raw.balance.toString(),
    balanceUsd: usd(raw.balance),
    funded: funded.toString(),
    fundedUsd: usd(funded),
    openTx: raw.opened?.tx ?? null,
    openTxUrl: raw.opened ? txUrl(raw.opened.tx) : null,
    timeline: rows,
    plan: plan ? { business: plan.business } : null,
    rungs,
    planIssues,
    flags,
    runnersKnown: !!plan,
    updatedAt: raw.now,
  };
}

// --- chain reads -----------------------------------------------------------

const MAX_SPLIT_DEPTH = 12;

/** getLogs over a range, halving the range whenever the RPC refuses it as too large. */
export async function logsAdaptive<T>(from: bigint, to: bigint, fetch: (from: bigint, to: bigint) => Promise<T[]>, depth = 0): Promise<T[]> {
  try {
    return await fetch(from, to);
  } catch (err) {
    if (depth >= MAX_SPLIT_DEPTH || to <= from) throw err;
    // Halves run one after the other so a range-limited RPC is not hit with a burst.
    const mid = from + (to - from) / 2n;
    const a = await logsAdaptive(from, mid, fetch, depth + 1);
    const b = await logsAdaptive(mid + 1n, to, fetch, depth + 1);
    return [...a, ...b];
  }
}

const transferEvent = usdcAbi.find((x) => x.type === "event" && x.name === "Transfer")!;

async function transfers(args: { from?: Address; to?: Address | Address[] }, fromBlock: bigint, toBlock: bigint): Promise<TransferLog[]> {
  const pub = publicClient();
  const logs = await logsAdaptive(fromBlock, toBlock, (f, t) =>
    pub.getLogs({ address: USDC, event: transferEvent, args, fromBlock: f, toBlock: t, strict: true }),
  );
  return logs
    .map((l) => ({
      from: getAddress(l.args.from),
      to: getAddress(l.args.to),
      value: l.args.value,
      tx: l.transactionHash as Hex,
      block: l.blockNumber as bigint,
      logIndex: l.logIndex as number,
    }))
    .sort(order);
}

export async function readErrand(address: Address, plan: Plan | null, planError: string | null): Promise<RawErrand> {
  const cfg = readConfig();
  const pub = publicClient();
  const [latest, code, balance] = await Promise.all([
    pub.getBlock({ blockTag: "latest" }),
    pub.getCode({ address }),
    pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
  ]);
  const now = Math.floor(Date.now() / 1000);
  let state: ErrandState | null = null;
  if (code && code !== "0x") {
    const call = <F extends "owner" | "sessionSigner" | "expiry" | "closed" | "rungsRoot">(functionName: F) =>
      pub.readContract({ address, abi: errandAbi, functionName });
    const [owner, sessionSigner, expiry, closed, rungsRoot] = await Promise.all([
      call("owner"),
      call("sessionSigner"),
      call("expiry"),
      call("closed"),
      call("rungsRoot"),
    ]);
    state = {
      owner: getAddress(owner as Address),
      sessionSigner: getAddress(sessionSigner as Address),
      expiry: Number(expiry),
      closed: closed as boolean,
      rungsRoot: rungsRoot as Hex,
    };
  }

  // Funding happens at most 30 days before expiry, so start there (with a day of margin).
  const latestBlock = latest.number;
  const latestTime = Number(latest.timestamp);
  let fromBlock = cfg.deployBlock ?? (latestBlock > 1_400_000n ? latestBlock - 1_400_000n : 0n);
  if (state) {
    const earliest = state.expiry - 31 * 86_400;
    const back = BigInt(Math.max(0, Math.ceil((latestTime - earliest) / BASE_BLOCK_SECONDS)));
    const estimate = latestBlock > back ? latestBlock - back : 0n;
    if (estimate > fromBlock) fromBlock = estimate;
  }

  const runners = plan?.rungs.map((r) => r.to) ?? [];
  const [transfersIn, transfersOut, runnerTransfers, opened] = await Promise.all([
    transfers({ to: address }, fromBlock, latestBlock),
    transfers({ from: address }, fromBlock, latestBlock),
    runners.length
      ? Promise.all(runners.map((r) => transfers({ from: r }, fromBlock, latestBlock))).then((x) => x.flat().sort(order))
      : Promise.resolve([]),
    state && cfg.factory
      ? logsAdaptive(fromBlock, latestBlock, (f, t) =>
          pub.getLogs({
            address: cfg.factory!,
            event: factoryAbi.find((x) => x.type === "event" && x.name === "ErrandOpened")!,
            args: { errand: address },
            fromBlock: f,
            toBlock: t,
          }),
        ).then((l) => (l[0] ? { tx: l[0].transactionHash as Hex, block: l[0].blockNumber as bigint } : null))
      : Promise.resolve(null),
  ]);

  return { address, now, latestBlock, latestTime, state, balance, opened, transfersIn, transfersOut, runnerTransfers, plan, planError };
}

/** JSON-safe view (bigints are already strings in ErrandView). */
export async function loadErrandView(address: Address, plan: Plan | null, planError: string | null): Promise<ErrandView> {
  return shapeErrand(await readErrand(address, plan, planError));
}

/** The runners among `runners` that appear as recipients of a USDC transfer from `errand`. */
export function receivedRunners(errand: Address, runners: Address[], logs: TransferLog[]): Set<Address> {
  const wanted = new Set(runners.map((r) => getAddress(r)));
  const out = new Set<Address>();
  for (const l of logs) if (l.from === errand && wanted.has(l.to)) out.add(l.to);
  return out;
}

/** Look up which runners have been paid by the errand, from DEPLOY_BLOCK (or 32 days back) to now. */
export async function findReceived(errand: Address, runners: Address[]): Promise<Set<Address>> {
  const cfg = readConfig();
  const pub = publicClient();
  const [latest, expiry] = await Promise.all([
    pub.getBlock({ blockTag: "latest" }),
    pub.readContract({ address: errand, abi: errandAbi, functionName: "expiry" }),
  ]);
  // Releases happen at most 30 days before expiry, so start there, with a day of margin.
  const back = BigInt(Math.max(0, Math.ceil((Number(latest.timestamp) - (Number(expiry) - 31 * 86_400)) / BASE_BLOCK_SECONDS)));
  let fromBlock = latest.number > back ? latest.number - back : 0n;
  if (cfg.deployBlock && cfg.deployBlock > fromBlock) fromBlock = cfg.deployBlock;
  const logs = await transfers({ from: errand, to: runners }, fromBlock, latest.number);
  return receivedRunners(errand, runners, logs);
}
