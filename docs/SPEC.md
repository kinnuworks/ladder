# Ladder: build spec

Ladder is a PayBox plugin. You tell your AI "get this done, whatever it takes, up to $30". One passkey approval funds an errand account on Base. The account can pay only the steps you approved (an AI phone call, a human caller, certified mail), each at most once and at most its cap, before an expiry. Whatever is left goes back to you.

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Contracts | `contracts/` | `ErrandFactory` deploys `Errand` clones at CREATE2 addresses fixed by the terms. `Errand.isValidSignature` approves only USDC `transferWithAuthorization` payments that match a committed rung. Refunds go only to the owner. |
| Core | `plugin/src/core.ts` | Rung tree, errand address, rung signatures, refund signature, errand key encoding. Shared by plugin and web. |
| Plugin | `plugin/` | MCP tools the agent calls. Holds no state; the agent keeps the errand key. |
| Web + API | `web/` | Next.js app on Vercel: the funding endpoint (x402), the relayer, public errand pages, judges page. |

## Terms and addresses

- Chain: Base mainnet (8453). USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (FiatTokenV2_2, domain name "USD Coin", version "2").
- Terms: `owner` (the user's PayBox wallet; the only refund destination), `sessionSigner` (a fresh key made by the plugin per errand), `expiry` (unix seconds), `rungsRoot`.
- Errand address = `factory.predict(owner, sessionSigner, expiry, rungsRoot)` = `predictErrand(terms)` in core.ts.
- Rung leaf = `keccak256(keccak256(abi.encode(bytes32 nonce, address to, uint256 max, bytes32 salt)))`. Salts are secret; they stop anyone who sees a leaf from forging a rung.
- Env: `FACTORY_ADDRESS`, `IMPLEMENTATION_ADDRESS`, `DEPLOY_BLOCK`, `RELAYER_PRIVATE_KEY`, `BASE_RPC_URL`, `PUBLIC_URL`.

## Funding flow (one approval)

1. Plugin `ladder_plan` makes the session key, nonces and salts, builds the root, predicts the errand address, and returns the decoded mandate plus the errand key.
2. Plugin `ladder_fund` returns a PayBox x402 proposal: `POST {PUBLIC_URL}/api/fund` with body `{ terms, budget, plan }` and `maxAmount = budget`. Before returning, it fetches the 402 itself and refuses unless `payTo` equals the errand address it computed and the amount equals the budget.
3. `POST /api/fund`:
   - Without a payment header: respond `402` with x402 payment requirements. `payTo` is the errand address computed from the body's terms (pure function of the request, so the probe and the paid retry agree). Amount = budget. Scheme `exact`, network Base, asset USDC, `extra: { name: "USD Coin", version: "2" }`, `maxTimeoutSeconds: 300`. Send both the x402 v2 `PAYMENT-REQUIRED` header (base64 JSON, `x402Version: 2`, `accepts` with `network: "eip155:8453"`, `amount`) and a v1-compatible JSON body (`x402Version: 1`, `accepts` with `network: "base"`, `maxAmountRequired`, `resource`, `description`, `mimeType`, `payTo`, `asset`, `maxTimeoutSeconds`, `extra`).
   - With `PAYMENT-SIGNATURE` (v2) or `X-PAYMENT` (v1): decode base64 JSON; check `authorization.to == errand`, `value == budget`, `from == terms.owner`, time window valid; verify the payer's EIP-712 signature (viem `verifyTypedData`; if `from` has code, use `publicClient.verifyTypedData` which handles ERC-1271/6492); simulate then send `USDC.transferWithAuthorization` from the relayer (65-byte signature → v,r,s overload; otherwise bytes overload); then `factory.open(terms)` from the relayer. Respond 200 with `{ errand, fundTx, openTx, page: PUBLIC_URL/e/<errand> }` and a `PAYMENT-RESPONSE` header (base64 JSON `{ success, transaction, network, payer }`).
   - Reject terms with expiry in the past or more than 30 days out, budgets over 100 USDC, or a rung `to` not in the rail registry.
4. `POST /api/refund` `{ errand, sessionSig }` relays `refundWithSig`. Money can only go to the owner, so this endpoint needs no auth.

## Public pages (no database; everything is read from chain)

- `/` landing: what Ladder does in one sentence, the three rungs, "one approval, chain-enforced caps, leftover comes back", links to judges page and a live example errand.
- `/e/[address]`: the errand's live timeline: terms read from the contract (owner, expiry, root, closed), funded amount and tx, each USDC payment out of the errand labelled by rail (StablePhone, Mosbie, PostalForm; unknown payees would be a bug and are flagged red), refunds, current balance, time to expiry. Optional `?plan=<base64url JSON>` shows the human labels of the rungs (business name, goal) and is checked against the chain where possible (rung `to` and `max` must match payments seen). Every row links to Basescan.
- `/verify`: paste terms → shows the predicted address, whether the code is deployed, and that its stored terms match.
- `/judges`: five-minute review path, the claims ledger (each claim tagged VERIFIED-LIVE / REPRODUCIBLE / MODELED / NOT-CLAIMED with a link), test and CI badges, contract addresses on Sourcify/Basescan.

## Rail registry

| Rail | payTo (Base) | Price |
|---|---|---|
| StablePhone AI call | `0xD219dB8179Bb9C1899eF87f39eebA9D1070c6801` | $0.54 |
| Mosbie human call/email | `0x4603366F72023572b139D19e354e9FA3A50c634B` | $15 |
| PostalForm certified mail | `0x3ea31de08708a6eb65f345719e6b1cdb72df0406` (probe; confirm) | $11.40 to $14.40 |

## Writing rules

Plain, specific English everywhere. No mention of the AI coding tools used to build this. No hype words. Sentence-case headings.
