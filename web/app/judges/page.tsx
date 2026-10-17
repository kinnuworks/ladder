import type { Metadata } from "next";
import Link from "next/link";
import type { Address } from "viem";
import { Addr } from "@/components/Addr";
import { readConfig } from "@/lib/config";
import { addressUrl, sourcifyUrl } from "@/lib/format";

export const metadata: Metadata = { title: "For judges" };
export const revalidate = 300;

type Tag = "VERIFIED-LIVE" | "REPRODUCIBLE" | "SHOWN-NOT-SPENT" | "NOT-CLAIMED";
const TAG_CLASS: Record<Tag, string> = {
  "VERIFIED-LIVE": "live",
  REPRODUCIBLE: "repro",
  "SHOWN-NOT-SPENT": "modeled",
  "NOT-CLAIMED": "not",
};

interface Claim {
  claim: string;
  tag: Tag;
  how: string;
  link: { href: string; text: string } | null;
}

async function sourcifyMatch(address: Address | null): Promise<boolean | null> {
  if (!address) return null;
  try {
    const res = await fetch(`https://sourcify.dev/server/v2/contract/8453/${address}`, {
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { match?: string | null };
    return body.match === "exact_match" || body.match === "match";
  } catch {
    return null;
  }
}

export default async function JudgesPage() {
  const cfg = readConfig();
  const repo = cfg.repoUrl;
  const src = (path: string) => (repo ? { href: `${repo}/blob/HEAD/${path}`, text: path } : { href: "", text: path });
  const example = cfg.exampleErrand
    ? `/e/${cfg.exampleErrand}${cfg.examplePlan ? `?plan=${encodeURIComponent(cfg.examplePlan)}` : ""}`
    : null;
  const [factoryVerified, implVerified] = await Promise.all([
    sourcifyMatch(cfg.factory),
    sourcifyMatch(cfg.implementation),
  ]);
  const sourceVerified = factoryVerified === true && implVerified === true;

  const exampleLink = example ? { href: example, text: "Example errand" } : null;
  const claims: Claim[] = [
    {
      claim: "One PayBox approval funds an errand at an address fixed by its terms.",
      tag: example ? "VERIFIED-LIVE" : "REPRODUCIBLE",
      how: example
        ? "The example errand's first row is the funding transfer from the owner. Paste its terms into the verify page to recompute the address."
        : "The interop test deploys the factory on a Base fork, funds an errand before it exists and opens it.",
      link: exampleLink ?? src("plugin/test/interop.test.ts"),
    },
    {
      claim: "The plugin recomputes the errand address and refuses to fund anything else.",
      tag: "REPRODUCIBLE",
      how: "ladder_fund fetches the 402 itself and refuses unless the payee is the errand address and the amount is the budget. The funding-check tests cover PAYEE_MISMATCH, AMOUNT_MISMATCH and a missing 402.",
      link: src("plugin/test/steps.test.ts"),
    },
    {
      claim: "An errand releases money only for a committed step, at most its cap, at most once, before expiry.",
      tag: "REPRODUCIBLE",
      how: "Unit, fuzz and invariant tests on the errand contract, plus fork tests against real Base USDC.",
      link: src("contracts/test/Invariants.t.sol"),
    },
    {
      claim: "Leftover money can only go back to the owner, and after expiry anyone can trigger that.",
      tag: "REPRODUCIBLE",
      how: "Contract tests for refund, refundWithSig and opening an expired errand to refund it.",
      link: src("contracts/test/Errand.t.sol"),
    },
    {
      claim: "A step key pays the service, and the service's transcript is read back by that key.",
      tag: example ? "VERIFIED-LIVE" : "REPRODUCIBLE",
      how: example
        ? "On the example errand, each release is followed by the step key's payment to StablePhone."
        : "The step tests run both calls against a mocked StablePhone and Base: the first releases exactly the cap to the step key, the second pays once, and an empty key never pays twice.",
      link: exampleLink ?? src("plugin/test/steps.test.ts"),
    },
    {
      claim: "When a service refuses a step, that step's money goes straight back to the owner.",
      tag: "REPRODUCIBLE",
      how: "A wrong payee, a price over the cap or a 4xx from the service triggers a sweep of the step key to the owner. A 5xx keeps the money on the key so the step can be retried; ladder_finish returns it otherwise. This is done by the plugin, not forced by the contract.",
      link: src("plugin/test/steps.test.ts"),
    },
    {
      claim: "The certified-letter step shows the quote and the exact PDF before any money moves, then releases only the letter's exact price.",
      tag: "SHOWN-NOT-SPENT",
      how: "The step tests show the preview moves no money and the approved letter releases its quoted price, not the $15 cap. PostalForm's real $14.40 quote comes from unpaid drafts recorded in docs/RAILS.md. No letter has been mailed.",
      link: src("plugin/test/steps.test.ts"),
    },
    {
      claim: "The user approves the letter before it is mailed.",
      tag: "NOT-CLAIMED",
      how: "The agent is told to show the preview and get approval, and the letter's hash makes sure the mailed letter is the one shown. Ladder can't see the user's screen, so this relies on the agent.",
      link: src("plugin/src/rails.ts"),
    },
    {
      claim: "Calls stop when the business asks.",
      tag: "NOT-CLAIMED",
      how: "The call script tells the AI caller to say it is automated and recorded, and to stop when asked. Calling hours, 9am to 6pm in the business's time zone, are enforced in code; the rest is an instruction to the caller.",
      link: src("plugin/src/rails.ts"),
    },
    {
      claim: "The plugin and this site compute errand addresses and signatures with the same code.",
      tag: "REPRODUCIBLE",
      how: "CI fails if web/lib/core.ts differs from plugin/src/core.ts by a single byte.",
      link: src("web/scripts/check-core.mjs"),
    },
    {
      claim: "Contract source is verified against the deployed bytecode.",
      tag: sourceVerified ? "VERIFIED-LIVE" : "NOT-CLAIMED",
      how: sourceVerified
        ? "Basescan shows verified source for both contracts, and Sourcify reports a match."
        : "Not confirmed on Sourcify yet.",
      link: cfg.factory ? { href: sourcifyUrl(cfg.factory), text: "Sourcify" } : null,
    },
    {
      claim: "The chain checks that a step key pays the right service.",
      tag: "NOT-CLAIMED",
      how: "The plugin checks the payee and price before the key signs. A step key can spend at most its own cap.",
      link: src("plugin/src/rails.ts"),
    },
    {
      claim: "The chain decides when to escalate.",
      tag: "NOT-CLAIMED",
      how: "The agent decides and states its reason in each step call.",
      link: null,
    },
    {
      claim: "The contracts are audited.",
      tag: "NOT-CLAIMED",
      how: "They are not. Budgets are capped at $100.",
      link: src("contracts/src/Errand.sol"),
    },
  ];

  return (
    <main className="page app">
      <div className="container">
        <h1>For judges.</h1>
        <p className="lead">
          What Ladder claims, how each claim can be checked, and where the code is. Every claim below carries one of
          four tags.
        </p>
        <div className="card" style={{ marginTop: 24 }}>
          <dl className="kv">
            <dt>
              <span className="claim-tag live">VERIFIED-LIVE</span>
            </dt>
            <dd>Happened on Base mainnet, and the link proves it.</dd>
            <dt>
              <span className="claim-tag repro">REPRODUCIBLE</span>
            </dt>
            <dd>A test in this repository proves it, including fork tests against real Base USDC.</dd>
            <dt>
              <span className="claim-tag modeled">SHOWN-NOT-SPENT</span>
            </dt>
            <dd>Shown with the real service up to the point of payment, and deliberately not paid.</dd>
            <dt>
              <span className="claim-tag not">NOT-CLAIMED</span>
            </dt>
            <dd>Something Ladder does not do.</dd>
          </dl>
        </div>

        <section className="app-section">
          <h2>A five-minute review.</h2>
          <div className="card">
            <ol className="steps">
              <li>
                {example ? (
                  <>
                    Open <Link href={example}>the example errand</Link>. Check the funding row, that each release is at
                    or under its cap, and that the leftover went back to the owner.
                  </>
                ) : (
                  <>Open an errand page from the agent&rsquo;s output. Each row links to Basescan.</>
                )}
              </li>
              <li>
                Copy the terms from that page into <Link href="/verify">verify</Link>. The address it computes should
                match the page you came from and factory.predict() on Base.
              </li>
              <li>
                Read <code>Errand.isValidSignature</code> in{" "}
                {repo ? (
                  <a href={`${repo}/blob/HEAD/contracts/src/Errand.sol`}>contracts/src/Errand.sol</a>
                ) : (
                  <code>contracts/src/Errand.sol</code>
                )}
                . It is short, and it is the only way money leaves the errand other than a refund to the owner.
              </li>
              <li>
                Run the tests: <code>forge test</code> in <code>contracts</code>, <code>pnpm test</code> in{" "}
                <code>plugin</code> and <code>web</code>.
              </li>
              <li>
                Check <a href="/api/health">/api/health</a> to see which factory this site uses and that the relayer
                only holds gas.
              </li>
            </ol>
          </div>
        </section>

        <section className="app-section">
          <h2>Claims.</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Claim</th>
                  <th>Tag</th>
                  <th>How to check</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c, i) => (
                  <tr key={i}>
                    <td>{c.claim}</td>
                    <td>
                      <span className={`claim-tag ${TAG_CLASS[c.tag]}`}>{c.tag}</span>
                    </td>
                    <td>
                      {c.how}
                      {c.link && (
                        <>
                          <br />
                          {c.link.href ? (
                            <a href={c.link.href} className="t-small">
                              {c.link.text}
                            </a>
                          ) : (
                            <code className="t-small">{c.link.text}</code>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="app-section">
          <h2>Tests and CI.</h2>
          <div className="card">
            {repo ? (
              <div className="badges">
                <a href={`${repo}/actions/workflows/ci.yml`}>
                  <img src={`${repo}/actions/workflows/ci.yml/badge.svg`} alt="CI status" />
                </a>
              </div>
            ) : (
              <p className="t-small">The CI badge appears here once REPO_URL is set.</p>
            )}
            <ul>
              <li>Contracts: unit, fuzz and invariant tests, and fork tests against Base USDC (Foundry).</li>
              <li>Plugin: core unit tests, a Base-fork interop test, and the PayBox conformance build.</li>
              <li>
                Site: x402 response shapes, payment header checks, funding, release and finish validation, errand
                timeline shaping, and the core.ts drift check.
              </li>
            </ul>
          </div>
        </section>

        <section className="app-section">
          <h2>Contracts on Base.</h2>
          <div className="card">
            {cfg.factory || cfg.implementation ? (
              <dl className="kv">
                {cfg.factory && (
                  <>
                    <dt>ErrandFactory</dt>
                    <dd>
                      <Addr a={cfg.factory} full />
                      <br />
                      <a className="t-small" href={addressUrl(cfg.factory)}>
                        Basescan
                      </a>{" "}
                      ·{" "}
                      <a className="t-small" href={sourcifyUrl(cfg.factory)}>
                        Sourcify
                      </a>
                      {factoryVerified === true && <span className="t-micro"> (verified)</span>}
                    </dd>
                  </>
                )}
                {cfg.implementation && (
                  <>
                    <dt>Errand implementation</dt>
                    <dd>
                      <Addr a={cfg.implementation} full />
                      <br />
                      <a className="t-small" href={addressUrl(cfg.implementation)}>
                        Basescan
                      </a>{" "}
                      ·{" "}
                      <a className="t-small" href={sourcifyUrl(cfg.implementation)}>
                        Sourcify
                      </a>
                      {implVerified === true && <span className="t-micro"> (verified)</span>}
                    </dd>
                  </>
                )}
                <dt>USDC</dt>
                <dd>
                  <Addr a="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" full />
                </dd>
              </dl>
            ) : (
              <p className="t-small">
                Contract addresses appear here once FACTORY_ADDRESS and IMPLEMENTATION_ADDRESS are set.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
