# For judges

Five minutes, in this order.

1. **Watch the demo** (2 min): _link added after recording_.
2. **Open the live errand page**: [errand 0xd72f…b362](https://ladder-errands.vercel.app/e/0xd72f6F79c1dC2e8de3E5efea311C6B005BfBb362). On October 17 it called 24 Hour Fitness in San Diego to ask how a membership can be cancelled; a staff member answered (in person or online, not by mail). Every row links to Basescan: the $1.08 funding, the $0.54 release to step 1's key, that key's $0.54 payment to StablePhone, and the $0.54 refund.
3. **Read the guarantee table** in the [README](README.md#what-the-chain-enforces-and-what-it-doesnt). It says what the contract enforces and what it leaves to the agent.
4. **Run the tests** (needs Foundry and Node 24 with pnpm 11):
   ```bash
   cd contracts && BASE_RPC_URL=https://mainnet.base.org forge test   # unit, fuzz, invariant, Base fork
   cd plugin && pnpm install --frozen-lockfile && pnpm run unit && pnpm test   # unit + PayBox conformance
   cd plugin && pnpm run interop   # deploys on a local Base fork and pays a step through real USDC
   cd web && pnpm install --frozen-lockfile && pnpm test
   ```
5. **Check the addresses**: [ErrandFactory](https://basescan.org/address/0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c) and [Errand implementation](https://basescan.org/address/0xc580544b22560C97f360d3e40Fb48464D85E7c06), deployed in [this transaction](https://basescan.org/tx/0x89881e6862dd1ff3da3acf651fac11c17b64c57d5a5f2633230e2874c093f699) (block 52739302) and verified on Basescan and on Sourcify (runtime bytecode match; the build disables the metadata hash, so Sourcify reports "match" rather than a full match) ([factory](https://repo.sourcify.dev/8453/0x8FF52968512024B5bfDe1e1eCCb3EE1f10A4A01c), [implementation](https://repo.sourcify.dev/8453/0xc580544b22560C97f360d3e40Fb48464D85E7c06)). Relayer: [0x1959…182B](https://basescan.org/address/0x19591DDf7D49C8b41Ff1FcC0d0d83c8718eD182B).

## Claims ledger

Each claim is tagged with how you can check it.

- **VERIFIED-LIVE**: happened on Base mainnet; the link proves it.
- **REPRODUCIBLE**: a test in this repository proves it; the command is given.
- **SHOWN-NOT-SPENT**: demonstrated with real services up to the point of payment, and deliberately not paid.
- **NOT-CLAIMED**: something we say Ladder does not do, or does only by instructing the agent.
- **BY DESIGN**: follows from how the code is built; there is no separate test.

| Claim | Status | Evidence |
|---|---|---|
| One PayBox approval funds an errand at an address fixed by its terms | VERIFIED-LIVE | [Funding tx](https://basescan.org/tx/0x4258949ef2347b775f918cd29b7ecfa46135ebc2db77704cc8ded3bcc75adfc8), [open tx](https://basescan.org/tx/0xb3d1808a23d7dee4cb70b25961f216c50e896fafc858cac8ff713b6dcd01a263); `plugin/test/interop.test.ts` |
| The factory and errand code on Base match this repository | VERIFIED-LIVE | Verified source on Basescan and Sourcify for both contracts; the plugin was built with these addresses before the deploy, and the deploy script refuses to run if they would differ |
| The plugin recomputes the errand address and refuses to fund anything else | VERIFIED-LIVE in the portal; REPRODUCIBLE | `fundingProblem` in `plugin/src/rails.ts`, tested in `plugin/test/steps.test.ts` (`PAYEE_MISMATCH`, `AMOUNT_MISMATCH`, no 402). PayBox's hosted test returned a proposal whose challenge pays exactly the computed errand address |
| An errand releases money only for a committed step, at most its cap, at most once, before expiry | REPRODUCIBLE | `contracts/test/Errand.t.sol`, `contracts/test/Invariants.t.sol` (each invariant runs 128 random sequences of 64 calls), `contracts/test/Fork.t.sol` against real Base USDC |
| Real Base USDC accepts the errand's ERC-1271 signature and rejects a forged payee or a replay | REPRODUCIBLE | `forge test --match-contract ForkTest` with `BASE_RPC_URL` set |
| Leftover money can only go back to the owner, and after expiry anyone can trigger that | VERIFIED-LIVE ([refund](https://basescan.org/tx/0x0a4893f728dcdc8c4eb94318038868e1894e71a8ed60109dbd9caf8cd9435e9e)); REPRODUCIBLE | `test_anyoneRefundsAfterExpiryToOwnerOnly`, `test_expiredErrandCanStillBeOpenedAndRefunded` |
| A step key pays the service once, and the service's transcript is read back by that key | VERIFIED-LIVE; REPRODUCIBLE | [Release to step key](https://basescan.org/tx/0x1d0fde1f29fa35c63cf058a3b3d5d1e155957f884befdbd445a844b3e5199b6d), [step key pays StablePhone](https://basescan.org/tx/0x5607a7d50c3966b0301a0af5b14b484490ff10829c2465c5596e48471533c240); the transcript was read back with `ladder_check`. `plugin/test/steps.test.ts` covers both calls |
| When a service refuses a step, its money goes straight back to the owner | REPRODUCIBLE | `plugin/test/steps.test.ts`: a wrong payee, a price over the cap or a 4xx sweeps the step key to the owner through `/api/sweep`; a 5xx keeps it for a retry. Done by the plugin, not forced by the contract |
| The certified-letter step shows the quote and the exact PDF before any money moves, then releases only the letter's exact price | SHOWN-NOT-SPENT | `plugin/test/steps.test.ts`; PostalForm's real $14.40 quote is from unpaid drafts in `docs/RAILS.md`. No letter has been mailed |
| The user approves the letter before it is mailed | **NOT-CLAIMED** | The agent is told to show the preview and ask; the hash makes sure the mailed letter is the one shown. Ladder can't see the user's screen |
| Calls run only 9am to 6pm in the business's time zone | REPRODUCIBLE | `plugin/test/rails.test.ts` (`guards`), `plugin/test/steps.test.ts` |
| Calls say they are automated and recorded, and stop when asked | **NOT-CLAIMED** as enforced | The opening line is fixed in code; stopping when asked is an instruction to the AI caller |
| Keys can't leave in a letter or call script; service text reaches the agent labelled untrusted | REPRODUCIBLE | `assertNoSecrets`, `untrusted_service_output` in `plugin/src/plugin.ts` |
| A step never pays twice | REPRODUCIBLE | USDC's one-time nonces on-chain, and `plugin/test/steps.test.ts` ("an empty step key never pays twice") |
| Each plugin call stays inside PayBox's 10-second limit | BY DESIGN; VERIFIED-LIVE | Two-call steps in `plugin/src/rails.ts`; one 8.8 s deadline per call. If a payment settles but the reply is cut off, the call id can be lost; the payment still shows on the errand page |
| The owner can get the errand's balance back without Ladder's server | REPRODUCIBLE | `ladder_refund` proposes `refund()` from the owner's wallet; `test_ownerRefundsAnytimeAndClosesErrand` in `contracts/test/Errand.t.sol` |
| The chain checks that a step key pays the right service | **NOT-CLAIMED** | The plugin checks the payee and price before the key signs. A step key can spend at most its own cap. |
| The chain decides when to escalate | **NOT-CLAIMED** | The agent decides and states its reason in each step call. |
| The contracts are audited | **NOT-CLAIMED** | Budgets are capped at $100. |

## Why it's built this way

- **Why one-time step keys, not paying services straight from the errand?** StablePhone only shows a call's transcript to the wallet that paid, and its sign-in check accepts ordinary keys only. PostalForm gives every order its own payment address. A one-time key per step keeps both working, and the errand still caps each step on-chain.
- **Why x402 for funding?** It's one gasless approval in PayBox. The plugin checks the funding endpoint's payee before proposing, and the address is a pure function of the terms.
- **Why a relayer?** Steps and refunds happen without the user being present, and plugins can't hold state or keys. The relayer only ever submits transactions the errand contract or a step key already authorised.

## If the errand key leaks

The errand key holds the errand's private keys and lives in the conversation. Whoever has it can spend what the errand still holds, up to the budget the user approved and never more, and never from the PayBox wallet. Ladder refuses to put it in a call script or a letter, labels everything a business says as untrusted, and caps budgets at $100. The owner can always call `refund()` (`ladder_refund`), which needs no key.

## What the plugin signs

PayBox's guide says plugins propose and PayBox signs. Ladder keeps to that for the user's wallet: the only payment from the user's PayBox wallet is the funding, and PayBox signs it after the user approves. After that, the plugin signs with keys it made for this errand only: the session key releases a step's cap from the errand, and each step key pays one service. Those keys can only ever move money the user already put into the errand, within the caps committed on-chain, and never touch the PayBox wallet.

The letter preview and its hash go to the agent, which must show them to the user. Ladder can't see the user's screen, so that step relies on the agent; the hash makes sure the letter that gets mailed is the one that was shown.

## Compliance notes

- **One approval is the whole mandate.** The user approves the total in PayBox after the agent shows each step and cap in the chat. The steps that follow spend without another PayBox approval, but only within what that approval funded: each step at most its cap, once, before the expiry, enforced on Base.
- **On someone's behalf only with their say-so.** Ladder acts for the account holder. The call states who it calls for and that it is automated.

- **No custody.** Ladder never holds user funds. The relayer can only move money to committed step keys or to the owner.
- **Calls.** Calls disclose that the caller is automated and that the call is recorded. They run only during the business's daytime hours, never ask for card or ID numbers, and end if the business asks to stop.
- **Personal details.** The funding request carries only the business name and the steps. Personal details stay in the user's conversation and go only to the service that needs them, for example the letter's addresses to PostalForm.

## Build log

Research and unpaid rail probes ran on the morning of October 17 (dated in docs/RAILS.md). The code was built on the afternoon of October 17 EDT in a local tree and committed in logical batches, inside the October 16 08:00 to October 17 20:00 window. Commit times are commit times, not edit times.
