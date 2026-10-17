# Ladder rails: integration spec

Rails covered: **StablePhone** (AI phone call), **Mosbie** (human phone call / email / site visit), **PostalForm** (print-and-mail, USPS Certified Mail).

Researched 2026-10-17 from each rail's llms.txt, openapi.json and docs, plus **unpaid** probes only. No payment was signed, no call was placed, and no order was paid. Exception: two **unpaid** PostalForm drafts were created, because a real per-order x402 challenge is only issued by the create endpoint (see §3.6). They will never be paid.

Conventions used below:
- USDC on Base: `asset = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `network = eip155:8453`, 6 decimals (`"540000"` = $0.54).
- "Verified" means observed in a live probe today. "Docs" means stated in the rail's own documentation. "Inferred" means read from published package source, or reasoned and not yet tested end to end.

---

## 0. Summary matrix

| | StablePhone | Mosbie | PostalForm |
|---|---|---|---|
| Base URL | `https://stablephone.dev` | `https://api.mosbie.com` | `https://postalform.com` |
| Paid create | `POST /api/call` | `POST /v1/tasks/phone-call`, `/v1/tasks/email`, `/v1/tasks/site-visit` | `POST /api/machine/orders` |
| Price | **$0.54 fixed** (body-independent, verified) | **$15 / $15 / $30 fixed** (verified) | **Body-dependent**: $3.40 to $200 (quote via free `/validate`) |
| x402 version | v2 | v2 | v2 (v1 `X-PAYMENT` explicitly **not** accepted) |
| Challenge header | `PAYMENT-REQUIRED` (empty body) | `PAYMENT-REQUIRED` (body `{}`) | `PAYMENT-REQUIRED` and the same challenge in JSON body `payment.payment_required` |
| Retry header | `PAYMENT-SIGNATURE` (legacy `X-PAYMENT` also read) | `PAYMENT-SIGNATURE` (inferred, undocumented) | `PAYMENT-SIGNATURE` |
| payTo | **Fixed** `0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801` | **Fixed** `0x4603366F72023572b139D19e354e9FA3A50c634B` | **Varies per order** (Stripe deposit address per PaymentIntent); stable for the same `request_id` |
| Facilitator | CDP (AgentCash router default) | unknown | CDP (`https://api.cdp.coinbase.com/platform/v2/x402`) |
| Result retrieval | `GET /api/call/{id}`, **SIWX required, payer wallet only** | **No status API.** Result pushed to `agent_callback_url` (https) or `reply_email` | `GET /api/machine/orders/{id}`, **public, no auth** (UUID is the capability) |
| Smart-account (ERC-1271) friendliness | Payment: likely OK. **Reading results: blocked** (SIWX verifier is EOA-only, see §1.4) | Payment: unknown facilitator. Reading results: webhook/email, no signature needed | Payment: likely OK. Reading results: no signature needed |
| Proof of completion | transcript, summary, recording_url, answered_by, call_length | human-written report (format undocumented) | USPS tracking number (= Certified Mail number), tracking URL, electronic return receipt PDF (by email) |
| Latency | minutes (max_duration 1 to 30 min) | "same-day" in SAST (UTC+2) business hours | 1 to 3 business days production, then 4 to 7 business days First-Class transit; ERR after delivery |
| Cancel | none | none | none via API (support before carrier handoff; refund via Stripe to payer wallet) |

---

## 1. StablePhone (AI phone call)

Discovery: `https://stablephone.dev/llms.txt`, `https://stablephone.dev/openapi.json`, `https://stablephone.dev/.well-known/x402`.
Built on Merit Systems' `@agentcash/router` (source inspected: `@agentcash/router@1.20.0`, which uses `@x402/extensions@2.x` and `@x402/evm@2.x`). Header behaviour matches that router exactly.

### 1.1 Endpoints

| Purpose | Method and path | Auth | Price |
|---|---|---|---|
| Place call | `POST /api/call` | x402 | $0.54 |
| Status, transcript, recording | `GET /api/call/{call_id}` | SIWX (payer wallet only) | free |
| (optional) Buy caller-ID number | `POST /api/number` | x402 | $20.00 / 30 days |
| (optional) Top up number | `POST /api/number/topup` | x402 | $15.00 / 30 days |
| (optional) List my numbers | `GET /api/numbers` | SIWX | free |
| (optional) iMessage/FaceTime lookup | `POST /api/lookup`, then `GET /api/lookup/status?token=` | x402 $0.05, then SIWX | |
| Cancel | **none** | | |

### 1.2 `POST /api/call` request schema (from openapi.json, `additionalProperties: false`)

| Field | Type | Required | Constraint |
|---|---|---|---|
| `phone_number` | string | yes | `^\+1\d{10}$`. **US/Canada (+1) only.** |
| `task` | string | yes | 1 to 4000 chars. The instructions for the AI agent |
| `from` | string | no | `^\+1\d{10}$`; must be an active StablePhone number you bought |
| `first_sentence` | string | no | at most 500 chars |
| `voice` | string | no | preset ID (default "Caylee" `ffe9ba88-4d68-4b37-9172-e94e2caa32fa`) or any Bland.ai voice ID |
| `max_duration` | integer | no | 1 to 30 minutes, default 5 |
| `wait_for_greeting` | boolean | no | default false |
| `record` | boolean | no | default true (needed for `recording_url`) |
| `model` | enum | no | `base` (default) or `turbo` |
| `transfer_phone_number` | string | no | |
| `voicemail_action` | enum | no | `hangup` (default), `leave_message`, `ignore` |
| `voicemail_message` | string | no | at most 500; required if `leave_message` |
| `metadata` | object | no | free-form key/value |

There is **no webhook or callback field**, and unknown fields are rejected.

Limits and policy:
- **Do-Not-Call**: returns **403** if the number is on the DNC list. Do not retry. The router only settles payment when the handler returns a status below 400, so a 403 or 400 on the paid retry is **not charged** (router source: `if (result.response.status >= 400) return finalize(...)` happens before `settle`).
- The body is **not validated on the unpaid probe**. An empty `{}` or a +44 number both still get a 402 (verified). On the paid retry, the body is parsed and validated **before** verify and settle, so a 400 costs nothing (router README). Ladder should still validate locally with the schema above before signing.

Example body:
```json
{
  "phone_number": "+14155550100",
  "task": "You are calling a restaurant on behalf of Alex. Ask whether they have a table for two at 7pm this Friday. If yes, ask them to hold it under the name Alex and ask for the cancellation policy. Be polite and brief. If you reach voicemail, hang up.",
  "first_sentence": "Hi, I'm calling to ask about a dinner reservation for this Friday.",
  "max_duration": 5,
  "record": true,
  "voicemail_action": "hangup",
  "metadata": { "ladder_errand_id": "err_123" }
}
```
Success response (200): `{ "success": true, "call_id": "abc-123-def", "message": "Call initiated" }`

### 1.3 Payment (verified)

Unpaid `POST /api/call` returns `HTTP 402`, an empty body, and these headers:
- `PAYMENT-REQUIRED: <base64 JSON>`, decoded:
```json
{
  "x402Version": 2,
  "resource": { "url": "https://stablephone.dev/api/call", "method": "POST", "mimeType": "application/json", "serviceName": "StablePhone", "description": "Make an AI phone call ($0.54)..." },
  "accepts": [
    { "scheme": "exact", "network": "eip155:8453", "amount": "540000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801",
      "maxTimeoutSeconds": 300, "extra": { "name": "USD Coin", "version": "2" } },
    { "scheme": "exact", "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "amount": "540000", "...": "..." }
  ],
  "extensions": { "bazaar": { "...": "input schema" } }
}
```
- `WWW-Authenticate: Payment ... method="tempo"` (MPP on Tempo chain 4217; ignore for Base).
- `X-Agent-Identity: <base64 {"v":1,"challenge":{domain,route,nonce,issuedAt,expirationTime}}>`. This is an **optional DID-auth challenge** (`did-auth-challenge` package). It "never gates the request" and is unrelated to SIWX and payment. **Ignore it.**

**payTo is fixed and the price is body-independent.** Two different bodies (realistic restaurant task with defaults; `"task":"hi","max_duration":30,"model":"turbo"`) both gave `amount 540000` and `payTo 0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801`. The price is the same for a 1-minute and a 30-minute call.

Retry: same method, URL and body, plus header `PAYMENT-SIGNATURE: base64(JSON PaymentPayload)`. The router also reads legacy `X-PAYMENT`. PaymentPayload (x402 v2, `exact`, EIP-3009):
```json
{
  "x402Version": 2,
  "resource": { "url": "https://stablephone.dev/api/call", "method": "POST", "mimeType": "application/json" },
  "accepted": { "scheme": "exact", "network": "eip155:8453", "amount": "540000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801",
    "maxTimeoutSeconds": 300, "extra": { "name": "USD Coin", "version": "2" } },
  "payload": {
    "signature": "0x<EIP-712 sig over TransferWithAuthorization>",
    "authorization": {
      "from": "0x<payer>", "to": "0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801",
      "value": "540000", "validAfter": "<unix s>", "validBefore": "<unix s, <= now+300>",
      "nonce": "0x<32 random bytes>"
    }
  }
}
```
EIP-712 domain: `{ name: "USD Coin", version: "2", chainId: 8453, verifyingContract: 0x8335…2913 }`. Type: `TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)`.

Smart-account payer: the reference `@x402/evm` exact facilitator verifies **ERC-1271 and ERC-6492** signatures (`verifyTypedDataSignature`, `classifyErc6492Payer`), and Base USDC v2.2 accepts `bytes` signatures in `transferWithAuthorization`. StablePhone settles via CDP. This is expected to work but is **untested**. Confirm with the cheapest paid call (`POST /api/lookup`, $0.05) once paying is allowed.

Success: `200` with JSON and a `PAYMENT-RESPONSE` header (base64 settlement result, including the tx hash). Persist both.

### 1.4 Reading the result: SIWX (verified challenge format; smart-account support is a **blocker**)

`GET /api/call/{call_id}` without auth returns `402` with a JSON body equal to the `PAYMENT-REQUIRED` header (verified):
```json
{
  "x402Version": 2, "error": "SIWX authentication required",
  "resource": { "url": "https://stablephone.dev/api/call/abc-123", "...": "..." },
  "accepts": [],
  "extensions": { "sign-in-with-x": {
    "info": { "domain": "stablephone.dev", "uri": "https://stablephone.dev/api/call/abc-123",
      "version": "1", "chainId": "eip155:8453", "type": "eip191",
      "nonce": "5217f8e1de2e46cf83ea334c0d7b6359",
      "issuedAt": "2026-10-17T17:31:00.563Z", "expirationTime": "2026-10-17T17:36:00.563Z",
      "statement": "Sign in to verify your wallet identity" },
    "supportedChains": [ { "chainId": "eip155:8453", "type": "eip191" },
                         { "chainId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "type": "ed25519" } ] } }
}
```
The client signs an **EIP-4361 (SIWE)** message with `personal_sign`:
```
stablephone.dev wants you to sign in with your Ethereum account:
0x<PayerAddressChecksummed>

Sign in to verify your wallet identity

URI: https://stablephone.dev/api/call/abc-123
Version: 1
Chain ID: 8453
Nonce: 5217f8e1de2e46cf83ea334c0d7b6359
Issued At: 2026-10-17T17:31:00.563Z
Expiration Time: 2026-10-17T17:36:00.563Z
```
Then it retries the GET with `SIGN-IN-WITH-X: base64(JSON)`, where the JSON is all `info` fields plus `"address"` and `"signature"` (plus optional `"signatureScheme":"eip191"`).

Rules:
- The **address must be the wallet that paid**, i.e. `authorization.from` of the x402 payment. The router compares lowercase addresses.
- The nonce is **single-use** (KV-backed) with a 5-minute window. **Each poll is 2 HTTP requests plus 1 signature.**
- **ERC-1271/6492 is NOT supported for SIWX here (inferred from source).** `@agentcash/router@1.20.0` calls `verifySIWxSignature(payload)` **without** an `evmVerifier`. In `@x402/extensions` that falls back to viem's standalone `verifyMessage` (ECDSA recovery only, no RPC). A smart-account SIWX signature will therefore fail with `siwx_invalid_signature`. If the smart account pays, **nobody can ever read that call's transcript.**
- There is no webhook, callback, or result token alternative. The `call_id` alone is not a bearer token.

**Workaround (recommended):** pay StablePhone from a Ladder-controlled **EOA runner key** (per errand, or a per-account session key), not from the ERC-1271 account. The smart account funds the EOA with exactly `amount` USDC (one on-chain transfer, policy-checked against the fixed payTo and price), then the EOA signs the x402 authorization and all SIWX polls. The smart account never signs arbitrary messages. Alternatives: ask Merit Systems to pass `evmVerifier: publicClient.verifyMessage` (one-line change in the router), or accept that results are unreadable (not viable).

### 1.5 Status response, latency, proof

Docs list these response fields: `status`, `completed` (bool), `to`, `from`, `call_length`, `answered_by` (human / voicemail), `summary`, `transcript` (string), `transcripts` (array of utterances), `recording_url`, `price`, `error_message`, `created_at`.

- Poll every 10 to 15 s until `completed === true`. The total is bounded by `max_duration` (default 5 min) plus a little post-processing for the summary and recording.
- Proof of completion: `transcript` and `transcripts[]`, `summary`, `recording_url` (if `record: true`), `answered_by`, `call_length`. Store a copy, because the recording URL may be a time-limited upstream (Bland) link.

### 1.6 Recommended StablePhone flow
1. Validate the body locally (+1 number, task length 4000 or less). Run Ladder's own DNC / quiet-hours / consent policy.
2. `POST /api/call` unpaid. Assert `accepts[eip155:8453].payTo == 0xD219…6801`, `amount == 540000`, `asset == USDC`.
3. Fund the runner EOA with 0.54 USDC from the smart account (or use an existing balance), then sign EIP-3009 with the EOA and retry with `PAYMENT-SIGNATURE`.
4. On 200, store `call_id`, `PAYMENT-RESPONSE`, and the payer EOA. On 403 (DNC), mark the errand failed, which means no charge.
5. Poll `GET /api/call/{id}` with EOA-signed SIWX until `completed`. Persist the transcript, summary and recording.

---

## 2. Mosbie (human phone call / email / site visit)

Discovery: `https://api.mosbie.com/llms.txt`, `https://api.mosbie.com/.well-known/openapi.json` (identical to `/openapi.json`), `https://api.mosbie.com/.well-known/ai-plugin.json`. No `/.well-known/x402`. Server is Express on Render behind Cloudflare.

### 2.1 Endpoints

| Purpose | Method and path | Price |
|---|---|---|
| Human phone call | `POST /v1/tasks/phone-call` | $15.00 |
| Human sends email, follows up once, reports reply | `POST /v1/tasks/email` | $15.00 |
| In-person visit (Cape Town area only) | `POST /v1/tasks/site-visit` | $30.00 |
| Status / result | **none** (probed `/v1/tasks/{id}`, `/v1/task/{id}`, `/v1/status/{id}`, `/v1/results/{id}`: all 404) | |
| Cancel | **none** | |

### 2.2 Request schemas (openapi, `required` as listed)

`POST /v1/tasks/phone-call`
| Field | Required | Notes |
|---|---|---|
| `target_phone` | yes | international format; **+27, +1, +44, +61, +64 only** |
| `objective` | yes | 5 to 2000 chars: what to ask, say, check |
| `reply_email` | one of | where the result is emailed |
| `agent_callback_url` | one of | **https** URL where the result is POSTed |

`POST /v1/tasks/email`: `recipient_email` (req), `objective` (req, 5 to 2000), `reply_email` or `agent_callback_url`.
`POST /v1/tasks/site-visit`: `address` (req, Cape Town area), `objective` (req), `reply_email` or `agent_callback_url`.

Example:
```json
{
  "target_phone": "+14155550100",
  "objective": "Ask whether they have a table for two at 7pm this Friday under the name Alex, and ask for their cancellation policy. Report exactly what was said.",
  "agent_callback_url": "https://ladder.example.com/hooks/mosbie/err_123?t=<per-errand-secret>"
}
```
Success (200, after payment): `{ "success": true, "task_id": "…", "task_status": "ACCEPTED", "message": "…", "expected_delivery": "…" }`.
`400`: "Invalid request body (you are not charged)". Note that the unpaid probe returns 402 even for `{}` or a +33 number (verified), so validation happens only on the paid retry. Validate locally first.

### 2.3 Payment (verified)

Unpaid POST returns `402`, body `{}`, header `PAYMENT-REQUIRED`:
```json
{ "x402Version": 2, "error": "Payment required",
  "resource": { "url": "https://api.mosbie.com/v1/tasks/phone-call", "description": "Hire a human to make a phone call (...)", "mimeType": "application/json" },
  "accepts": [ { "scheme": "exact", "network": "eip155:8453", "amount": "15000000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0x4603366F72023572b139D19e354e9FA3A50c634B",
    "maxTimeoutSeconds": 300, "extra": { "name": "USD Coin", "version": "2" } } ] }
```
- **payTo is fixed** across all three endpoints and different bodies: phone-call (2 bodies), email, site-visit all gave `0x4603366F72023572b139D19e354e9FA3A50c634B`. Amounts were `15000000`, `15000000`, `30000000`. The price is per endpoint, not per body.
- Retry header: not documented. The v2 challenge shape implies `PAYMENT-SIGNATURE` (standard `@x402/express` v2). **Unverified**: send `PAYMENT-SIGNATURE`, and if you get a fresh 402, the server may want `X-PAYMENT`. The payload shape is the same as §1.3 with Mosbie's payTo and amount.
- Facilitator: not disclosed. Whether ERC-1271 payers are accepted is unknown.
- CORS: `access-control-allow-origin: *`, but `PAYMENT-REQUIRED` is not exposed to browsers. Call it server-side.

### 2.4 Result retrieval
- Only push: `agent_callback_url` (https POST) or `reply_email`. **The callback payload schema, the signing/auth of callbacks, and retry behaviour are undocumented.** Use an unguessable per-errand URL token, accept any JSON, and store it raw.
- The smart account never signs anything for results. This is good for Ladder.
- Proof: a human-written report of "exactly what was said". There is no transcript or recording promised, and the format is unknown.

### 2.5 Latency
"Same-day delivery (South Africa Standard Time, UTC+2). If the target is closed, unreachable or outside sensible hours, the task is completed at the next opportunity and the result says so." Expect hours, possibly the next business day for US targets (a SAST daytime operator calling US business hours is a narrow overlap).

### 2.6 Trust flags
- `https://www.mosbie.com` is a video/marketing agency site ("Shoot • Edit • Post", Portfolio, "Action of Faith") with no mention of this API. The only contact is `contact@mosbie.com`.
- There is no status endpoint, so after paying $15 the only evidence is whatever arrives at the webhook or email.
- **Recommendation:** treat Mosbie as a low-trust, high-cost rail. Cap per-errand spend, require the user to opt in, keep the `PAYMENT-RESPONSE` tx hash as the receipt, and set an SLA timeout (for example 36 h) after which the errand is flagged "no result received".

### 2.7 Recommended Mosbie flow
1. Local validation (+27/+1/+44/+61/+64; objective 5 to 2000 chars). Generate a per-errand callback URL with a secret.
2. Unpaid POST. Assert payTo `0x4603…634B` and amount `15000000` (or `30000000` for site visit).
3. Pay (EOA runner or smart account; both are fine because no SIWX is needed later) and retry with `PAYMENT-SIGNATURE`.
4. Store `task_id`, `expected_delivery`, and the tx hash. Wait for the callback, and time out per SLA.

---

## 3. PostalForm (print-and-mail, Certified Mail)

Discovery: `https://postalform.com/.well-known/x402`, `https://postalform.com/openapi.json` (canonical), `https://postalform.com/agents` (`.md`), `https://postalform.com/developers.md`, `https://postalform.com/x402-physical-mail-api.md`, `https://postalform.com/pricing.md`, MCP at `https://postalform.com/mcp` (streamable HTTP, no auth).

### 3.1 Endpoints (x402 family)

| Purpose | Method and path | Side effect | Auth |
|---|---|---|---|
| Validate and quote | `POST /api/machine/orders/validate` | **none** (no order) | none |
| Create and pay | `POST /api/machine/orders` | unpaid call **creates an unpaid draft** and returns 402; paid retry creates the paid order | x402 |
| Status | `GET /api/machine/orders/{order_id or request_id}` | none | **none** (UUID is the capability) |
| Discovery probe | `GET /api/machine/orders` or `POST` with `{}` | none; returns a fake challenge (`order_id …0402`, payTo `0x3ea31de0…0406`). **Never pay this.** | |
| PDF upload (only if not using `letter` text, a data URL, or a public URL) | MCP tool `postalform.create_pdf_upload`, then multipart upload to returned `upload_url`, then `pdf: {"upload_token":"pfu_…"}` | upload only | none |
| Workflow forms (optional) | `GET /api/machine/forms`, `GET /api/machine/forms/{slug}/schema` | none | none |
| Cancel | **none**. Email support@postalform.com before carrier handoff; refunds go back to the payer wallet as USDC via Stripe | | |

MPP twins exist under `/api/machine/mpp/...` (Tempo, Stripe SPT, card). They are not needed for Base.

### 3.2 Request schema (`MachineOrderRequest`, `additionalProperties: false`)

Always required: `request_id` (UUID, the idempotency key), `buyer_name` (1 to 256), `buyer_email` (**required**; Stripe receipt), `sender_name`.
Single-recipient: `recipient_name` plus **exactly one** content source: `pdf` | `letter` | `form`.
Each party (sender and recipient) uses **exactly one** address strategy:
- Manual: `*_address_type: "Manual"` plus `*_address_manual: { line1, line2?, city, state (req US/CA), zip, countryCode? (default "US") }`
- Loqate: `*_address_type: "Address"` plus `*_address_id` (`US|…`) plus `*_address_text` (IDs come from MCP `postalform.search_addresses`)

**A sender (return) address is required.** Name limits: Lob allows 40 chars for both names, Click2Mail 40 for the recipient name. Overlong names are rejected before payment.

Content options:
- `letter`: a string (at most 20,000 chars, rendered as text) **or** `{ body (req, ≤20000), title? (≤200), format: "text"|"html"|"markdown"|"rtf" (default text), signature?: string | {mode:"typed"|"drawn", text?, dataUrl?, printDataUrl?}, render?: { paper:"letter", font_size 9-14, margin_in 0.5-1.5, font:"times"|"helvetica" } }`. PostalForm renders the PDF server-side. **This is the simplest option for Ladder** (no upload needed).
- `pdf`: `"data:application/pdf;base64,…"` | `"https://public/url.pdf"` | `{upload_token}` | `{download_url, file_id}`. Max 100 MB, 199 pages single-sided (398 duplex on eligible US First-Class).
- `form`: `{ slug, fields, attachments?[] }` from the forms catalog.

Mail options: `double_sided` (default true), `color` (false), `mail_class` `standard`|`priority`|`express` (standard = USPS First-Class), `certified` (false; **requires `mail_class:"standard"`**), `certified_return_receipt` (false), `return_receipt_format` `electronic` (default) | `physical` (green card PS 3811), `restricted_delivery` (requires return receipt), `err_delivery` `manual` (default; retrieve yourself from USPS) | `email` (PostalForm emails the signed ERR PDF), `err_email` (default buyer_email), `signature_required` (ignored for standard), `mailpiece_type` `letter`|`postcard`, `postcard_size`.

Constraints:
- Destinations: US, CA, AT, BE, CH, DE, ES, FR, GB, IN, LU, NL. **Certified Mail with return receipt is US-only (USPS).** A probe with a Canadian recipient and `certified + ERR` returned `422 invalid_mail_options` ("No print-mail provider can service this document with the selected mail options").
- Unpaid-draft creation is throttled to **10 per hour per client IP** (429).
- `409 request_id_mismatch` if the same `request_id` is reused with a different body.

Example: certified letter with electronic return receipt (validated today, quote $14.40):
```json
{
  "request_id": "6b0c3b1e-6a51-4c1f-9a7e-0d6a3f6b2a11",
  "buyer_name": "Ladder Errand Account",
  "buyer_email": "receipts@ladder.example",
  "letter": {
    "format": "markdown",
    "title": "Notice of security deposit demand",
    "body": "Dear Property Manager,\n\nThis letter is a formal request for return of my security deposit...\n\nSincerely,",
    "signature": "Alex Example"
  },
  "file_name": "deposit-demand.pdf",
  "sender_name": "Alex Example",
  "sender_address_type": "Manual",
  "sender_address_manual": { "line1": "1600 Pennsylvania Ave NW", "city": "Washington", "state": "DC", "zip": "20500", "countryCode": "US" },
  "recipient_name": "Acme Property Management",
  "recipient_address_type": "Manual",
  "recipient_address_manual": { "line1": "350 Fifth Avenue", "city": "New York", "state": "NY", "zip": "10118", "countryCode": "US" },
  "double_sided": true,
  "color": false,
  "mail_class": "standard",
  "certified": true,
  "certified_return_receipt": true,
  "return_receipt_format": "electronic",
  "err_delivery": "manual"
}
```

### 3.3 Validate and quote (free; verified)
```bash
curl -sS https://postalform.com/api/machine/orders/validate \
  -H 'content-type: application/json' --data @order.json
```
Response (200):
```json
{ "request_id": "6b0c…2a11", "request_hash": "b2f70759…ef87", "order_id": null,
  "status": "validated_new_order", "postcard_guidelines_url": null,
  "quote": { "price_usd": 14.4, "full_price_usd": 14.4, "currency": "usd",
    "page_count": 1, "billable_page_count": 2, "double_sided": true, "color": false,
    "mail_class": "standard", "certified": true, "certified_return_receipt": true,
    "return_receipt_format": "electronic", "restricted_delivery": false,
    "err_delivery": "manual", "err_email": null, "signature_required": false,
    "mailpiece_type": "letter", "postcard_size": null, "provider": "lob" } }
```
Errors: `422 invalid_request` with `errors[] {path, code, message, hint, fix_examples}`; `422 missing_buyer_email`; `422 invalid_mail_options`; `409 request_id_mismatch`.

**Price depends on the body** (live quotes today; 1-page US to US unless noted):

| Variant | price_usd | provider |
|---|---|---|
| First-Class, B/W | 3.40 | lob |
| Certified only | 11.40 | lob |
| Certified + ERR, `err_delivery: manual` | **14.40** | lob |
| Certified + ERR, `err_delivery: email` | 14.51 | click2mail |
| Certified + ERR (email), color | 15.12 | click2mail |
| Certified + **physical** green card | 17.70 | click2mail |
| Certified + ERR + restricted delivery | 32.05 | click2mail |
| Priority Mail (no certified) | 20.12 | click2mail |
| Certified + ERR (email), 9-page letter | 16.30 | click2mail |

Published matrix: $3.00 base (incl. postage) + $0.20/page B/W or $0.40 color (an address page is added) + Certified $8.00 + ERR $3.00. The route (provider) changes the total, so **always quote with the exact body and pay exactly the challenge amount.**

### 3.4 Payment (verified)

Unpaid `POST /api/machine/orders` with a valid body returns `402`, `x-payment-protocol: x402`, `PAYMENT-REQUIRED` (base64), and this JSON body:
```json
{
  "order_id": "2f0e6c1a-1d6b-4f39-9a51-7c3f0c9b0a01",
  "request_id": "2f0e6c1a-1d6b-4f39-9a51-7c3f0c9b0a01",
  "status": "payment_required",
  "price_usd": 14.4, "currency": "usd", "page_count": 1,
  "checkout_url": "https://postalform.com/machine-checkout/<id>?expires=…&signature=…",
  "status_url": "https://postalform.com/api/machine/orders/<id>",
  "payment_options": [ {"type":"x402"}, {"type":"hosted_checkout","url":"…"} ],
  "next_action": "choose_payment_method",
  "preview_url": "https://postalform.com/order-draft/file?order_id=<id>&expires=…&signature=…",
  "payment": { "protocol": "x402", "x402_version": 2, "retry_header": "PAYMENT-SIGNATURE",
    "payment_required": {
      "x402Version": 2, "error": "Payment required",
      "resource": { "url": "https://postalform.com/api/machine/orders", "description": "PostalForm machine order", "mimeType": "application/json" },
      "accepts": [ { "scheme": "exact", "network": "eip155:8453", "amount": "14400000",
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "payTo": "0x6be30876b241d7e944effcd91ece5cf5149d45c9",
        "maxTimeoutSeconds": 300, "extra": { "name": "USD Coin", "version": "2" } } ] },
    "payment_required_header": "<base64>" },
  "next_step": "After buyer approval, pay payment.payment_required ... retry this identical request body with the PAYMENT-SIGNATURE header..."
}
```

**payTo varies per order (critical; verified):**

| Probe | request_id | amount | payTo |
|---|---|---|---|
| Draft A: certified + ERR, NYC recipient | `…0a01` | 14400000 | `0x6be30876b241d7e944effcd91ece5cf5149d45c9` |
| Draft A re-POSTed (same id and body) | `…0a01` | 14400000 | `0x6be30876b241d7e944effcd91ece5cf5149d45c9` (same) |
| Draft B: First-Class, Chicago recipient | `…0a02` | 3400000 | `0xa131175c61255181f5b594fad805a7f1ccfa0d88` |
| Discovery probe (no order) | n/a | 3400000 | `0x3ea31de08708a6eb65f345719e6b1cdb72df0406` (placeholder) |

Each order gets a Stripe PaymentIntent (`payment_intent_id: "pi_3URbW9…"`, `payment_channel: "x402_machine"`) with its own crypto **deposit address**. Ladder **cannot allowlist a static PostalForm payTo**. Bind instead: order → payTo → amount:
- `GET /api/machine/orders/{order_id}` returns `x402.pay_to` and `machine_payment.recipient` (both equal the challenge payTo), plus `price_usd`. Check that `challenge.payTo == status.x402.pay_to` and `challenge.amount == round(status.price_usd * 1e6) == validate.quote.price_usd * 1e6`, and that the challenge came from `https://postalform.com`, before signing. (This is a same-origin consistency check, not independent attestation. The policy should also cap the amount, for example at $40.)
- The payTo is stable for retries of the same `request_id`, so a crashed signer can retry safely.

Retry: identical body plus `PAYMENT-SIGNATURE: base64(PaymentPayload)` (same shape as §1.3 with PostalForm's per-order payTo and amount). **v1 `X-PAYMENT` is rejected.**
Success: `202` with a `PAYMENT-RESPONSE` header (settlement tx). The body is a `MachineOrder`, possibly `status: "settled_pending_webhook"` while Stripe confirms the Base tx. **Never pay twice; poll.** `200` means already paid.
Payment states that mean "wait, do not pay again": `payment_authorized`, `payment_processing`, `settled_pending_webhook`. `payment_review_required` needs support. `closed` cannot be paid.
Smart-account payer: CDP facilitator. The same reasoning as §1.3 applies (ERC-1271/6492 expected OK, untested). Refunds are sent "back to the payer wallet".

### 3.5 Status, tracking, proof (verified shape on an unpaid draft)

`GET https://postalform.com/api/machine/orders/{id}` (no auth) returns:
```json
{ "order_id": "…", "status": "awaiting_payment", "payment_status": "awaiting_payment", "is_paid": false,
  "current_step": null, "payment_intent_id": "pi_…", "payment_channel": "x402_machine",
  "price_usd": "14.40", "currency": "usd", "mailpiece_type": "letter", "mail_class": "standard",
  "certified": true, "certified_return_receipt": true, "return_receipt_format": "electronic",
  "restricted_delivery": false, "err_delivery": "manual", "err_email": null,
  "err_status": "manual", "err_document_available": false, "err_delivered_at": null,
  "tracking_number": null, "tracking_url": null, "usps_tracking_url": null,
  "machine_payment": { "protocol": "x402", "method": "exact", "network": "eip155:8453",
    "recipient": "0x6be3…45c9", "settlement_reference": null, "settled_at": null, "testnet": null },
  "x402": { "network": "eip155:8453", "pay_to": "0x6be3…45c9", "settlement_tx": null, "settled_at": null },
  "order_complete_url": "Order URL will be returned once payment is settled.",
  "checkout_url": "…", "status_url": "…", "payment_options": [ … ], "next_action": "choose_payment_method" }
```
- `current_step` progression: `payment_received` → `receiver_address_verified` → `sender_address_verified` → `pdf_normalized` → `letter_created` → `email_sent` (terminal alternatives: `canceled`, `refunded`, `abandoned`).
- **Proof of mailing and delivery:** `tracking_number` (for Certified Mail this is the USPS Certified Mail article number), `usps_tracking_url`, `tracking_url`. A tracking number alone does not prove carrier acceptance.
- **Electronic Return Receipt:** `err_status` `manual|pending|sent|failed`, `err_document_available`, `err_delivered_at`. With `err_delivery: "email"`, PostalForm emails the signed USPS PDF to `err_email` / `buyer_email` (**the ERR PDF is delivered by email, not via the API**). With `manual`, you look it up on USPS.
- Richer carrier data (`mailing_status`, `delivery_status`, `signed_by`, `tracking_events[]` up to 50, `estimated_delivery_at`) is exposed by MCP tool `postalform.get_order_status` at `https://postalform.com/mcp` (no auth).
- `order_complete_url` becomes `https://postalform.com/order/complete?order_id=<id>` after settlement.
- No signature from the smart account is needed to read status.

Latency: production and carrier handoff take 1 to 3 business days. First-Class/Certified arrive 4 to 7 business days after the order. Certified delivery or ERR may need redelivery or pickup. Delivery is not guaranteed by a date. Saturdays count as business days.

### 3.6 Unpaid drafts created during research (will not be paid)
- `2f0e6c1a-1d6b-4f39-9a51-7c3f0c9b0a01`: "TEST PROBE - DO NOT MAIL", certified + ERR, $14.40
- `2f0e6c1a-1d6b-4f39-9a51-7c3f0c9b0a02`: "TEST PROBE - DO NOT MAIL", First-Class, $3.40

These were needed because `/validate` does not return payTo. They will expire or go to `abandoned`. Their checkout links expire in 24 h.

### 3.7 Recommended PostalForm flow
1. Build a `letter` (markdown) body with a fresh `request_id` (UUIDv4), the buyer email (Ladder receipts inbox), manual addresses, `certified: true`, `certified_return_receipt: true`, `err_delivery: "email"` (if the user wants the PDF) or `"manual"` (cheapest).
2. `POST /validate`. Show `quote.price_usd` and the provider to the user or policy. Abort on 422.
3. `POST /api/machine/orders` unpaid (creates the draft). Optionally show `preview_url` (signed PDF) for approval.
4. Bind and check: challenge `payTo` == `GET status.x402.pay_to`, and `amount` == `quote.price_usd × 1e6` ≤ cap. Sign EIP-3009 (smart account or EOA; both are fine because reads need no auth).
5. Retry the identical body with `PAYMENT-SIGNATURE`. Expect `202` and `PAYMENT-RESPONSE`.
6. Poll `GET /api/machine/orders/{id}` (for example hourly, then daily) for `is_paid`, `current_step`, `tracking_number`, `err_*`. Mark the errand done at `tracking_number` present plus `letter_created`; mark it "delivered" once tracking shows delivery or ERR is available.

---

## 4. Cross-rail notes for the Ladder policy engine
- **Static payTo allowlist works for StablePhone and Mosbie only.** PostalForm needs order-bound payTo verification (§3.4).
- **Prices:** StablePhone and Mosbie are fixed per endpoint, so they can be hard-coded and asserted. PostalForm must be quoted per body and capped.
- **Unpaid 402 does not validate the body** on StablePhone or Mosbie, so validate locally. PostalForm validates before issuing a challenge.
- **Signing surface:** only StablePhone requires a post-payment signature (SIWX, EOA-only). Use a runner EOA for StablePhone so the ERC-1271 account only ever signs EIP-3009 transfers (or just a plain USDC transfer to fund the runner).
- **Untested assumptions to confirm with a first live payment** (when allowed): ERC-1271 EIP-3009 acceptance by CDP on StablePhone and PostalForm; Mosbie's retry header and facilitator; Mosbie callback payload; StablePhone status JSON exact shape.
