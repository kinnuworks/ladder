import type { Metadata } from "next";
import Link from "next/link";
import type { Address } from "viem";
import { Addr } from "@/components/Addr";
import { readConfig } from "@/lib/config";
import { addressUrl, sourcifyUrl } from "@/lib/format";

export const metadata: Metadata = { title: "For judges" };
export const revalidate = 300;

type Tag = "VERIFIED-LIVE" | "REPRODUCIBLE" | "MODELED" | "NOT-CLAIMED";
const TAG_CLASS: Record<Tag, string> = {
  "VERIFIED-LIVE": "live",
  REPRODUCIBLE: "repro",
  MODELED: "modeled",
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
  const live = (fallback: Tag) => (example ? "VERIFIED-LIVE" : fallback);
  const [factoryVerified, implVerified] = await Promise.all([
    sourcifyMatch(cfg.factory),
    sourcifyMatch(cfg.implementation),
  ]);
  const sourceVerified = factoryVerified === true && implVerified === true;

  const claims: Claim[] = [
    {
      claim:
        "An errand's address is fixed by its terms before the errand exists, so it can be funded first and checked by anyone.",
      tag: live("REPRODUCIBLE"),
      how: example
        ? "Open the example errand, copy its terms into the verify page, and compare with factory.predict() on Base."
        : "The interop test deploys the factory on a Base fork and compares its predict() with core.ts.",
      link: example ? { href: example, text: "Example errand" } : src("plugin/test/interop.test.ts"),
    },
    {
      claim: "The errand pays only committed rungs: each at most once, at most its cap, and only before expiry.",
      tag: "REPRODUCIBLE",
      how: "Unit, fuzz and invariant tests on Errand.isValidSignature, plus a fork test against real Base USDC.",
      link: src("contracts/test/Invariants.t.sol"),
    },
    {
      claim: "Refunds can only go to the owner. The owner can refund at any time and anyone can after expiry.",
      tag: "REPRODUCIBLE",
      how: "Contract tests for refund, refundWithSig and sweep.",
      link: src("contracts/test/Errand.t.sol"),
    },
    {
      claim: "Funding is one approval: a single x402 USDC payment straight to the errand address.",
      tag: live("REPRODUCIBLE"),
      how: example
        ? "The example errand's first row is the funding transfer from the owner."
        : "Web tests check the 402 response and reject payments with the wrong payee, amount, payer or time window.",
      link: example ? { href: example, text: "Example errand" } : src("web/test/x402.test.ts"),
    },
    {
      claim:
        "Each step uses a one-time key that receives at most its cap from the errand and pays the service directly.",
      tag: live("MODELED"),
      how: example
        ? "On the example errand, each release is followed by the step key's payment to the service."
        : "The plugin implements this flow; it has not yet run on mainnet.",
      link: example ? { href: example, text: "Example errand" } : src("plugin/src/rails.ts"),
    },
    {
      claim:
        "Prices: StablePhone $0.54 per call, Mosbie $15 per task, PostalForm $11.40 to $14.40 per certified letter.",
      tag: "MODELED",
      how: "Taken from each service's payment request when the rails were built. Prices can change; rung caps bound what is paid.",
      link: src("docs/RAILS.md"),
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
        ? "Sourcify reports a match for the factory and the implementation."
        : "Not yet confirmed on Sourcify.",
      link: cfg.factory ? { href: sourcifyUrl(cfg.factory), text: "Sourcify" } : null,
    },
    {
      claim: "The errand achieves its goal, such as a cancellation or a refund from the business.",
      tag: "NOT-CLAIMED",
      how: "Ladder limits what an agent can spend and where the money goes. Whether the business agrees is outside it.",
      link: null,
    },
    {
      claim: "The contracts have been audited.",
      tag: "NOT-CLAIMED",
      how: "They have not. They are small and covered by tests; read them before trusting them with more than a test amount.",
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
            <dd>Visible on Base mainnet now, linked.</dd>
            <dt>
              <span className="claim-tag repro">REPRODUCIBLE</span>
            </dt>
            <dd>Shown by a test you can run, including fork tests against real Base USDC.</dd>
            <dt>
              <span className="claim-tag modeled">MODELED</span>
            </dt>
            <dd>Built and reasoned about, but not yet observed on mainnet.</dd>
            <dt>
              <span className="claim-tag not">NOT-CLAIMED</span>
            </dt>
            <dd>Something Ladder does not claim.</dd>
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
