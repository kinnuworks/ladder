# Ladder: how it works

Ladder is a PayBox plugin. You tell your AI "get this done, up to $16". One passkey approval funds an errand account on Base. The account can release money only for the steps you approved, each at most its cap, each once, before an expiry. Each step's money goes to a one-time key that pays the service. Whatever is left goes back to you.

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Contracts | `contracts/` | `ErrandFactory` deploys `Errand` clones at CREATE2 addresses fixed by the terms. `Errand.isValidSignature` approves only a USDC `transferWithAuthorization` that matches a committed step. Every refund path pays only the owner. |
| Core | `plugin/src/core.ts` (copied to `web/lib/core.ts`, checked in CI) | Step tree, errand address, step signatures, refund signature, errand key encoding. |
| Plugin | `plugin/` | Six MCP tools. Holds no state; the agent keeps the errand key. |
| Web and API | `web/` | Funding endpoint (x402), relayer, public errand pages, verify page, judges page. |

## Terms

- Chain: Base mainnet (8453). USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Terms: `owner` (the user's PayBox wallet, the only refund destination), `sessionSigner` (a fresh key per errand), `expiry`, `rungsRoot`.
- Errand address = `factory.predict(owner, sessionSigner, expiry, rungsRoot)` = `predictErrand(terms)`.
- Step leaf = `keccak256(keccak256(abi.encode(bytes32 nonce, address to, uint256 max, bytes32 salt)))`, where `to` is the step's one-time key. Sorted-pair Merkle tree, verified with OpenZeppelin `MerkleProof`.
- Step caps: AI call $0.54, follow-up AI call $0.54, a person calls $15 (off by default), certified letter $15. The default budget is the sum of the chosen caps.

## Flow

1. **Plan** (`ladder_plan`, free). Makes the session key, one key per step, nonces and salts; builds the root; predicts the errand address; returns the mandate and the errand key. Phone steps need the business's time zone.
2. **Fund** (`ladder_fund`, the one PayBox approval). The plugin fetches the funding endpoint's 402 itself and refuses unless `payTo` is the errand address it computed and the amount is the budget, then returns an x402 proposal. `POST /api/fund` answers the probe with a 402 whose `payTo` is a pure function of the terms in the body. On the paid retry it checks the authorization (to the errand, the exact budget, from the owner, in its time window), settles it from the relayer, and opens the errand. The body carries only the business name and the steps; no personal details.
3. **Step** (`ladder_step`). Steps run in order unless the agent gives `skip_reason`.
   - Phone: call 1 releases the cap to the step key through `POST /api/move` (USDC `transferWithAuthorization` signed by the errand via ERC-1271). Call 2 has the step key pay StablePhone over x402, after checking StablePhone's fixed payee and price. Calls go out only between 9am and 6pm in the business's time zone, disclose that the caller is automated and the call is recorded, and stop if asked.
   - Letter: call 1 quotes the letter and creates PostalForm's unpaid draft, returning the PDF preview and `letter_sha256`; no money moves. Only after the user approves that exact text: call 2 releases the cap, call 3 has the step key pay PostalForm, after checking the order's payee against the order's public status.
   - `reason` and `letter` are refused if they contain anything that looks like a key.
4. **Check** (`ladder_check`). The step key signs in (x402 sign-in-with-x) to read StablePhone's transcript; PostalForm's status is public. Anything the business or service said is returned under `untrusted_service_output`.
5. **Finish** (`ladder_finish`). Signs returns of any money left on step keys plus the errand's refund, and `POST /api/finish` relays them together. After the expiry anyone can refund; money still only goes to the owner.

## API (web)

| Route | Does |
|---|---|
| `POST /api/fund` | x402 v1 and v2 challenge; settles and opens. Budget 1 to 100 USDC, expiry 10 minutes to 30 days, step caps per rail. |
| `POST /api/move` | Relays a step release from a Ladder errand (checks the clone and factory, value above zero). |
| `POST /api/finish` | Relays step-key returns (only to the owner, only from keys the errand paid) and the errand refund. |
| `GET /api/errand/[address]` | Everything the errand page shows, read from Base. |
| `GET /api/cron/sweep-expired` | Refunds expired, funded errands; needs `CRON_SECRET`. |

## Not enforced by the chain

- Escalating only when the previous step failed: the agent decides and says why.
- That a step key pays the intended service: the plugin checks the payee and price before the key signs; a step key can spend at most its own cap.
