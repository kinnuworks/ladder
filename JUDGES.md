# For judges

Five minutes, in this order.

1. **Watch the demo** (2 min): _link added after recording_.
2. **Open the live errand page**: _link added after the first mainnet errand_. Every row links to Basescan: the funding, each step's release, each step's payment to the service, and the refund.
3. **Read the guarantee table** in the [README](README.md#what-the-chain-enforces-and-what-it-doesnt). It says what the contract enforces and what it leaves to the agent.
4. **Run the tests** (needs Foundry and Node 24 with pnpm 11):
   ```bash
   cd contracts && BASE_RPC_URL=https://mainnet.base.org forge test   # unit, fuzz, invariant, Base fork
   cd plugin && pnpm install --frozen-lockfile && pnpm run unit && pnpm test   # unit + PayBox conformance
   cd plugin && pnpm run interop   # deploys on a local Base fork and pays a step through real USDC
   cd web && pnpm install --frozen-lockfile && pnpm test
   ```
5. **Check the addresses**: [ErrandFactory](https://basescan.org/address/0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c) and [Errand implementation](https://basescan.org/address/0xc580544b22560C97f360d3e40Fb48464D85E7c06), deployed in [this transaction](https://basescan.org/tx/0x89881e6862dd1ff3da3acf651fac11c17b64c57d5a5f2633230e2874c093f699) (block 52739302) and verified as an exact match on Sourcify ([factory](https://repo.sourcify.dev/8453/0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c), [implementation](https://repo.sourcify.dev/8453/0xc580544b22560C97f360d3e40Fb48464D85E7c06)). Relayer: [0x1959…182B](https://basescan.org/address/0x19591DDf7D49C8b41Ff1FcC0d0d83c8718eD182B).

## Claims ledger

Each claim is tagged with how you can check it.

- **VERIFIED-LIVE**: happened on Base mainnet; the link proves it.
- **REPRODUCIBLE**: a test in this repository proves it; the command is given.
- **SHOWN-NOT-SPENT**: demonstrated with real services up to the point of payment, and deliberately not paid.
- **NOT-CLAIMED**: something we say Ladder does not do.

| Claim | Status | Evidence |
|---|---|---|
| One PayBox approval funds an errand at an address fixed by its terms | VERIFIED-LIVE after the first errand; REPRODUCIBLE now | `plugin/test/interop.test.ts`; funding tx on the errand page |
| The factory and errand code on Base match this repository | VERIFIED-LIVE | Sourcify exact match for both contracts; the plugin was built with these addresses before the deploy, and the deploy script refuses to run if they would differ |
| The plugin recomputes the errand address and refuses to fund anything else | REPRODUCIBLE | `plugin/src/plugin.ts` (`ladder_fund`), `plugin/test/core.test.ts` |
| An errand releases money only for a committed step, at most its cap, at most once, before expiry | REPRODUCIBLE | `contracts/test/Errand.t.sol`, `contracts/test/Invariants.t.sol` (8,192 random calls per run), `contracts/test/Fork.t.sol` against real Base USDC |
| Real Base USDC accepts the errand's ERC-1271 signature and rejects a forged payee or a replay | REPRODUCIBLE | `forge test --match-contract ForkTest` with `BASE_RPC_URL` set |
| Leftover money can only go back to the owner, and after expiry anyone can trigger that | REPRODUCIBLE | `test_anyoneRefundsAfterExpiryToOwnerOnly`, `test_expiredErrandCanStillBeOpenedAndRefunded` |
| A step key pays the service, and the service's transcript is read back by that key | VERIFIED-LIVE after the first errand | StablePhone payment and call id on the errand page |
| The certified-letter step shows the real quote and the exact PDF before any money moves | SHOWN-NOT-SPENT | PostalForm quote and preview in the demo; nothing mailed |
| Calls say they are automated and recorded, run 9am to 6pm in the business's time zone, and stop when asked | REPRODUCIBLE | `plugin/test/rails.test.ts` (`guards`) |
| Keys can't leave in a letter or call script; service text reaches the agent labelled untrusted | REPRODUCIBLE | `assertNoSecrets`, `untrusted_service_output` in `plugin/src/plugin.ts` |
| Each plugin call stays inside PayBox's 10-second limit, and a timeout never pays twice | REPRODUCIBLE in design; VERIFIED-LIVE after the first errand | Two-call steps in `plugin/src/rails.ts`; one deadline per call |
| The chain checks that a step key pays the right service | **NOT-CLAIMED** | The plugin checks the payee and price before the key signs. A step key can spend at most its own cap. |
| The chain decides when to escalate | **NOT-CLAIMED** | The agent decides and states its reason in each step call. |
| The contracts are audited | **NOT-CLAIMED** | Budgets are capped at $100. |

## Why it's built this way

- **Why one-time step keys, not paying services straight from the errand?** StablePhone only shows a call's transcript to the wallet that paid, and its sign-in check accepts ordinary keys only. PostalForm gives every order its own payment address. A one-time key per step keeps both working, and the errand still caps each step on-chain.
- **Why x402 for funding?** It's one gasless approval in PayBox. The plugin checks the funding endpoint's payee before proposing, and the address is a pure function of the terms.
- **Why a relayer?** Steps and refunds happen without the user being present, and plugins can't hold state or keys. The relayer only ever submits transactions the errand contract or a step key already authorised.

## What the plugin signs

PayBox's guide says plugins propose and PayBox signs. Ladder keeps to that for the user's wallet: the only payment from the user's PayBox wallet is the funding, and PayBox signs it after the user approves. After that, the plugin signs with keys it made for this errand only: the session key releases a step's cap from the errand, and each step key pays one service. Those keys can only ever move money the user already put into the errand, within the caps committed on-chain, and never touch the PayBox wallet.

The letter preview and its hash go to the agent, which must show them to the user. Ladder can't see the user's screen, so that step relies on the agent; the hash makes sure the letter that gets mailed is the one that was shown.

## Compliance notes

- **No custody.** Ladder never holds user funds. The relayer can only move money to committed step keys or to the owner.
- **Calls.** Calls disclose that the caller is automated and that the call is recorded. They run only during the business's daytime hours, never ask for card or ID numbers, and end if the business asks to stop.
- **Personal details.** The funding request carries only the business name and the steps. Personal details stay in the user's conversation and go only to the service that needs them, for example the letter's addresses to PostalForm.

## Build log

Research and unpaid rail probes ran on the morning of October 17 (dated in docs/RAILS.md). All code was written and committed on the afternoon of October 17 EDT, inside the October 16 08:00 to October 17 20:00 window. The commit history is the log.
