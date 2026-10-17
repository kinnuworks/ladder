# Ladder

Tell your AI: "Get my gym membership cancelled, up to $17." You approve once in PayBox. Your AI calls the gym. If the gym won't do it by phone, it calls again. If they insist on writing, it drafts a certified letter for you to approve and mails it with a return receipt. Whatever it doesn't spend comes back to you.

The one approval funds an errand account on Base. The account can send each step's cap only to that step's one-time key, once, before an expiry; the plugin checks the service's address and price before that key pays. Everything else the account holds can only go back to your wallet. The contract enforces the caps, the one-time rule, the expiry and the refund; the agent decides when to climb.

**Proof:** _filled in after the first live errand: the errand page, the funding transaction, each step's payment, and the refund._

[Live errand page](#) · [For judges](#) · [Contracts on Basescan](#) · [CI](../../actions) · [Demo video](#)

## Why it exists

Chat assistants can't finish errands that end in the real world. They can't place a phone call, hire someone to make one, or mail a legal letter, and when they can pay for something, they pay one thing at a time with an approval each time. PayBox's plugin rules make that explicit: a plugin proposes one payment, the user approves it, and the plugin is gone.

Cancelling a subscription, chasing a refund, or getting a deposit back often takes several attempts through different channels. Ladder lets you approve the whole plan once: the agent shows every step and its cap in the chat, PayBox shows the total you are approving, and the chain holds the agent to the caps.

## How it works

1. **Plan.** `ladder_plan` turns the request into steps. Each step gets its own one-time key and a cap: an AI phone call ($0.54), a follow-up call ($0.54), and a certified letter with return receipt ($15 cap; about $14.40). A step where a person makes the call ($15) is optional and off by default. The steps are committed as a Merkle root. The errand's address is fixed by its owner, its session key, its expiry and that root, so it can be checked before it exists.
2. **Fund, once.** `ladder_fund` proposes one x402 payment in PayBox. Before proposing, the plugin fetches the payment request itself and refuses unless the payee is exactly the errand address it computed and the amount is exactly the budget. When you approve, Ladder's relayer settles the transfer and opens the errand.
3. **Climb.** `ladder_step` runs one step. The errand releases at most that step's cap to the step's key; USDC checks the errand's signature through ERC-1271, and the errand only approves a transfer that matches a committed step that hasn't been used. The step's key then pays the service directly over x402.
4. **Check.** `ladder_check` reads the result: the call's transcript and recording, the person's report, or the letter's USPS Certified Mail number.
5. **Finish.** `ladder_finish` returns anything left on the step keys and closes the errand. Ladder pays the gas. After the expiry, anyone can trigger the refund, and it can still only go to you.

```
you ──one approval──▶ errand account (Base)
                         │  can only pay committed steps, each once, each ≤ cap, before expiry
                         ├─▶ step 1 key ──▶ StablePhone   AI call            ≤ $0.54
                         ├─▶ step 2 key ──▶ StablePhone   follow-up call     ≤ $0.54
                         ├─▶ step 3 key ──▶ PostalForm    certified letter   ≤ $15
                         └─▶ (optional)     Mosbie        a person calls     ≤ $15
                         ▲
                         └── leftover ──▶ back to you only
```

## What the chain enforces, and what it doesn't

| Guarantee | Enforced by |
|---|---|
| Money leaves only for a committed step, at most its cap, at most once | `Errand.isValidSignature` plus USDC's one-time authorization nonces |
| Nothing can be spent after the expiry | `Errand.isValidSignature` (and every authorization must expire before the errand does) |
| Leftover money can only go to the owner | `Errand.refund`, `refundWithSig`, `sweep` |
| The errand's address matches its terms | CREATE2 in `ErrandFactory`; the plugin recomputes it before funding |
| Escalate only when the previous step failed | **Not the chain.** The agent decides, and says why in each step call. The chain caps what a wrong decision can cost. |
| A step's key pays the intended service | **Not the chain.** The plugin checks the service's payee and price before the key signs. A step key can spend at most its own cap. |

## Rails

| Step | Service | Price | Result |
|---|---|---|---|
| AI phone call | [StablePhone](https://stablephone.dev) | $0.54 | transcript, summary, recording |
| Certified letter, return receipt | [PostalForm](https://postalform.com) | about $14.40 (cap $15) | USPS Certified Mail number, electronic return receipt |
| A person calls (optional) | [Mosbie](https://api.mosbie.com) | $15 | written report by email; no status API, so it is off by default |

US phone numbers and US addresses only, because that is what these services cover. Anyone can run an errand from anywhere.

## Built for the PayBox hackathon

PayBox Hackathon, Chapter 1 (MoonPay), October 16 to 17, 2026. The contract and testing setup follows the author's earlier project [Stepwell](https://github.com/kinnuworks/stepwell); no code was copied from it. Research and rail probes happened on October 17 (see the dated notes in [docs/RAILS.md](docs/RAILS.md)), and the code was built that afternoon in a local tree and committed in logical batches, inside the hackathon window. Commit times are commit times, not edit times.

## Install

Ladder is a PayBox plugin. While it awaits PayBox's review it is installable only from its author's account; once approved it appears in the PayBox plugin marketplace.

To run your own copy: build `plugin/` (below), upload `plugin/dist/plugin.mjs` in the [PayBox developer portal](https://developer.paybox.sh), and allow these network hosts: `ladder-errands.vercel.app`, `stablephone.dev`, `api.mosbie.com`, `postalform.com`, `mainnet.base.org`. Then enable it under Plugins in the PayBox app and ask your agent to plan an errand.

Contracts on Base: ErrandFactory [`0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c`](https://basescan.org/address/0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c), Errand implementation [`0xc580544b22560C97f360d3e40Fb48464D85E7c06`](https://basescan.org/address/0xc580544b22560C97f360d3e40Fb48464D85E7c06), both with verified source on Basescan and [Sourcify](https://repo.sourcify.dev/8453/0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c).

## Run it

```bash
# contracts: unit, fuzz, invariant, and fork tests against real Base USDC
cd contracts && BASE_RPC_URL=https://mainnet.base.org forge test

# plugin: unit tests, then PayBox conformance (typecheck, two byte-identical builds, protocol checks)
cd plugin && pnpm install --frozen-lockfile && pnpm run unit && pnpm test

# plugin against a local fork of Base: deploys the factory and pays a step through real USDC
cd plugin && pnpm run interop
```

## Known limits

- The phone and letter rails reach US businesses only.
- Mosbie reports by email and has no status API, so its step can't be checked from chat.
- A certified letter takes days to arrive. The demo shows the order, its payment and its tracking number, not the delivery.
- Ladder's relayer pays gas for funding, steps and refunds. If it is down, the owner can still call `refund()` directly, and after the expiry anyone can.
- The contracts are not audited. The plugin caps a budget at $100.
- The errand key in the conversation holds the errand's private keys. Anyone who gets it can spend the remaining step caps (never more), so Ladder refuses to put it in letters or call scripts and labels everything a business says as untrusted.

## Licence

MIT.
