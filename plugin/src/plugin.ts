import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { getAddress } from "viem";
import { x402OutputSchema, proposeX402 } from "./paybox.js";
import { decodeErrandKey, signRefund, type RailId } from "./core.js";
import { DEPLOYED, PUBLIC_URL } from "./config.js";
import { makePlan } from "./plan.js";
import { RailRefused } from "./x402.js";
import { RAILS, runRung, readRung, sweepRunners } from "./rails.js";

const PROTOCOL_VERSION = "2026-07-28";

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const usPhone = z.string().regex(/^\+1\d{10}$/, "US numbers only, in the form +15551234567");
const errandKey = z.string().startsWith("ldr1_").max(16_000);

const refusal = z.object({ refused: z.literal(true), code: z.string(), reason: z.string() }).strict();

function refuse(code: string, reason: string) {
  return { content: [{ type: "text" as const, text: `Refused (${code}): ${reason}` }], structuredContent: { refused: true as const, code, reason } };
}

async function getJson(path: string, init?: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch(`${PUBLIC_URL}${path}`, { ...init, signal: ctl.signal, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    return { status: res.status, headers: res.headers, body: (await res.json().catch(() => ({}))) as any };
  } finally {
    clearTimeout(t);
  }
}

function createServer() {
  const server = new McpServer({ name: "ladder", version: "1.0.0" }, { supportedProtocolVersions: [PROTOCOL_VERSION] });

  // 1. Plan ------------------------------------------------------------------
  server.registerTool(
    "ladder_plan",
    {
      title: "Plan an errand",
      description:
        "Plan a real-world errand (cancel a subscription, get a refund, dispute a charge, get a deposit back) as a ladder of paid steps: an AI phone call, a follow-up call, a human caller, then a certified letter. Each step has a fixed payee and cap, committed on-chain. Returns the errand address, the exact mandate to show the user, and an errand key. Keep the errand key in the conversation and pass it to the other Ladder tools; it is never sent to Ladder's servers. Nothing is paid by this tool.",
      inputSchema: z
        .object({
          owner: evmAddress.describe("The user's PayBox Base wallet address. Refunds can only ever go here."),
          goal: z.string().min(10).max(600).describe("What the user wants, in their words, e.g. 'Cancel my gym membership and stop the monthly charge.'"),
          for_name: z.string().min(1).max(80).describe("Whose account this is, as the business knows them."),
          business_name: z.string().min(1).max(120),
          business_phone: usPhone.optional(),
          business_email: z.email().optional(),
          business_address: z
            .object({ line1: z.string().max(120), line2: z.string().max(120).optional(), city: z.string().max(80), state: z.string().length(2), zip: z.string().regex(/^\d{5}(-\d{4})?$/) })
            .strict()
            .optional()
            .describe("US postal address, needed for the certified-letter step."),
          account_ref: z.string().max(80).optional().describe("Membership or account number, if the user has one."),
          callback_phone: usPhone.optional().describe("A number the business can call back, if the user wants that."),
          reply_email: z.email().optional().describe("Where the human caller's report and the letter's return receipt go. Needed for those steps."),
          sender_address: z
            .object({ line1: z.string().max(120), line2: z.string().max(120).optional(), city: z.string().max(80), state: z.string().length(2), zip: z.string().regex(/^\d{5}(-\d{4})?$/) })
            .strict()
            .optional()
            .describe("The user's US return address for the certified letter."),
          steps: z.array(z.enum(["phone", "human", "mail"])).min(1).max(3).default(["phone", "human", "mail"]),
          budget_usd: z.number().positive().max(100).default(30),
          hours: z.number().min(1).max(720).default(72),
        })
        .strict(),
      outputSchema: z.union([
        z
          .object({
            errand: evmAddress,
            budget_usd: z.string(),
            expires_at: z.string(),
            mandate: z.array(z.object({ step: z.number(), label: z.string(), service: z.string(), step_key: evmAddress, cap_usd: z.string() }).strict()),
            errand_key: z.string(),
            page: z.string(),
          })
          .strict(),
        refusal,
      ]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (a) => {
      if (!DEPLOYED) return refuse("NOT_DEPLOYED", "Ladder's errand contracts are not deployed yet.");
      try {
        const brief = {
          goal: a.goal,
          forName: a.for_name,
          business: { name: a.business_name, phone: a.business_phone, email: a.business_email, address: a.business_address },
          accountRef: a.account_ref,
          callbackPhone: a.callback_phone,
          replyEmail: a.reply_email,
          sender: a.sender_address,
        };
        const p = makePlan({ owner: a.owner, brief, include: a.steps as RailId[], budgetUsd: a.budget_usd, hours: a.hours });
        const mandate = p.rungs.map((r) => ({ step: r.step, label: r.label, service: r.payee, step_key: r.runner, cap_usd: r.capUsd }));
        const lines = mandate.map((m) => `  ${m.step}. ${m.label} via ${m.service}: at most $${m.cap_usd}, once`).join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                `Errand ${p.errand}\nBudget $${p.budgetUsd}, expires ${p.expiresAt}.\nThis account can only pay:\n${lines}\n` +
                `Anything left goes back to ${getAddress(a.owner)}. Show this mandate to the user, then call ladder_fund with the errand key.`,
            },
          ],
          structuredContent: { errand: p.errand, budget_usd: p.budgetUsd, expires_at: p.expiresAt, mandate, errand_key: p.key, page: `${PUBLIC_URL}/e/${p.errand}` },
        };
      } catch (e) {
        return refuse("BAD_PLAN", (e as Error).message);
      }
    },
  );

  // 2. Fund (the one approval) ----------------------------------------------
  server.registerTool(
    "ladder_fund",
    {
      title: "Fund the errand",
      description:
        "Propose the single payment that funds the errand account. Before proposing, Ladder fetches the payment request itself and refuses unless the payee is exactly the errand address computed from the committed terms and the amount is exactly the budget. After the user approves in PayBox, the errand opens on Base.",
      inputSchema: z.object({ errand_key: errandKey }).strict(),
      outputSchema: z.union([x402OutputSchema, refusal]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ errand_key }) => {
      try {
        const { key, errand } = decodeErrandKey(errand_key);
        const budget = key.budget!;
        const body = JSON.parse(JSON.stringify({
          terms: { owner: key.terms.owner, sessionSigner: key.terms.sessionSigner, expiry: key.terms.expiry, rungsRoot: key.terms.rungsRoot },
          budget,
          plan: { brief: key.brief, rungs: key.rungs.map((r) => ({ rail: r.rail, label: r.label, to: r.to, max: r.max })) },
        }));
        const probe = await getJson("/api/fund", { method: "POST", body: JSON.stringify(body) });
        const header = probe.headers.get("payment-required");
        const pr = header ? JSON.parse(Buffer.from(header, "base64").toString()) : probe.body;
        const req = (pr.accepts ?? []).find((x: any) => x.scheme === "exact");
        if (probe.status !== 402 || !req) return refuse("NO_CHALLENGE", "The funding endpoint did not return a payment request.");
        if (getAddress(req.payTo) !== errand) return refuse("PAYEE_MISMATCH", `The funding request pays ${req.payTo}, not the errand ${errand}.`);
        if (String(req.amount ?? req.maxAmountRequired) !== budget) return refuse("AMOUNT_MISMATCH", "The funding amount differs from the budget.");
        return proposeX402({ chain: "eip155:8453", url: `${PUBLIC_URL}/api/fund`, method: "POST", body, maxAmount: budget });
      } catch (e) {
        return refuse("FUND_FAILED", (e as Error).message);
      }
    },
  );

  // 3. Run a rung --------------------------------------------------------------
  server.registerTool(
    "ladder_step",
    {
      title: "Run the next step",
      description:
        "Run one committed step of the errand, paid from the errand account with no further approval: the account itself enforces the payee, the cap and one use. Steps: 1-2 are AI phone calls, then a human caller, then a certified letter. Escalate only when the previous step did not get the job done; say why in `reason`. For a letter, pass the full letter text in `letter` (cite what happened on the calls).",
      inputSchema: z
        .object({
          errand_key: errandKey,
          step: z.number().int().min(1).max(8),
          reason: z.string().min(5).max(400),
          letter: z.string().min(200).max(12_000).optional(),
        })
        .strict(),
      outputSchema: z.union([
        z.object({ step: z.number(), rail: z.string(), status: z.string(), job_id: z.string(), paid_usd: z.string(), payment_tx: z.string().optional(), detail: z.record(z.string(), z.json()) }).strict(),
        refusal,
      ]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ errand_key, step, reason, letter }) => {
      try {
        const d = decodeErrandKey(errand_key);
        const rung = d.rungs[step - 1];
        if (!rung) return refuse("NO_SUCH_STEP", `This errand has ${d.rungs.length} steps.`);
        const out = await runRung({ ...d, index: step - 1, reason, letter });
        return {
          content: [{ type: "text", text: `Step ${step} (${RAILS[rung.rail].name}) started: ${out.status}. Paid $${(Number(out.paid.amount) / 1e6).toFixed(2)} from the errand. Check it with ladder_check.` }],
          structuredContent: { step, rail: rung.rail, status: out.status, job_id: out.jobId, paid_usd: (Number(out.paid.amount) / 1e6).toFixed(2), payment_tx: out.paid.transaction, detail: out.detail },
        };
      } catch (e) {
        if (e instanceof RailRefused) return refuse(e.code, e.message);
        return refuse("STEP_FAILED", (e as Error).message);
      }
    },
  );

  // 4. Check a step ------------------------------------------------------------
  server.registerTool(
    "ladder_check",
    {
      title: "Check a step",
      description: "Read the result of a step: the call transcript and outcome, the human caller's report, or the letter's tracking and receipt. Free.",
      inputSchema: z.object({ errand_key: errandKey, step: z.number().int().min(1).max(8), job_id: z.string().min(1).max(200) }).strict(),
      outputSchema: z.union([z.object({ step: z.number(), status: z.string(), done: z.boolean(), summary: z.string(), detail: z.record(z.string(), z.json()) }).strict(), refusal]),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ errand_key, step, job_id }) => {
      try {
        const d = decodeErrandKey(errand_key);
        const r = await readRung({ ...d, index: step - 1, jobId: job_id });
        return { content: [{ type: "text", text: `Step ${step}: ${r.status}. ${r.summary}` }], structuredContent: { step, ...r } };
      } catch (e) {
        if (e instanceof RailRefused) return refuse(e.code, e.message);
        return refuse("CHECK_FAILED", (e as Error).message);
      }
    },
  );

  // 5. Status ------------------------------------------------------------------
  server.registerTool(
    "ladder_status",
    {
      title: "Errand status",
      description: "Show the errand's state as recorded on Base: funded amount, every payment it made and to whom, balance, refunds and time left. Free.",
      inputSchema: z.object({ errand: evmAddress }).strict(),
      outputSchema: z.object({ errand: evmAddress, page: z.string(), state: z.record(z.string(), z.json()) }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ errand }) => {
      const addr = getAddress(errand);
      const r = await getJson(`/api/errand/${addr}`);
      return {
        content: [{ type: "text", text: `Errand ${addr}: ${JSON.stringify(r.body).slice(0, 1500)}` }],
        structuredContent: { errand: addr, page: `${PUBLIC_URL}/e/${addr}`, state: r.body ?? {} },
      };
    },
  );

  // 6. Finish and refund -------------------------------------------------------
  server.registerTool(
    "ladder_finish",
    {
      title: "Finish and refund",
      description: "Close the errand and send every unspent dollar back to the owner's wallet. Gas is paid by Ladder; the refund can only go to the owner. Call this when the job is done or the user wants to stop.",
      inputSchema: z.object({ errand_key: errandKey }).strict(),
      outputSchema: z.union([z.object({ errand: evmAddress, refund_tx: z.string(), refunded_usd: z.string() }).strict(), refusal]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ errand_key }) => {
      try {
        const d = decodeErrandKey(errand_key);
        const { key, errand } = d;
        await sweepRunners(d);
        const sessionSig = await signRefund(errand, key.sessionKey);
        const r = await getJson("/api/refund", { method: "POST", body: JSON.stringify({ errand, sessionSig }) });
        if (r.status !== 200) return refuse("REFUND_FAILED", JSON.stringify(r.body).slice(0, 300));
        return {
          content: [{ type: "text", text: `Closed. Refunded $${r.body.refundedUsd} to the owner in ${r.body.tx}.` }],
          structuredContent: { errand, refund_tx: String(r.body.tx), refunded_usd: String(r.body.refundedUsd) },
        };
      } catch (e) {
        return refuse("REFUND_FAILED", (e as Error).message);
      }
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
