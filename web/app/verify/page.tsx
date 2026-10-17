import type { Metadata } from "next";
import Link from "next/link";
import { Addr } from "@/components/Addr";
import { type VerifyResult, parseTermsInput, verifyTerms } from "@/lib/verify";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify an errand" };

const EXAMPLE = `{
  "owner": "0x…",
  "sessionSigner": "0x…",
  "expiry": 1792345678,
  "rungsRoot": "0x…"
}`;

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <li className={ok ? "" : "is-bad"}>{children}</li>;
}

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ terms?: string | string[] }> }) {
  const sp = await searchParams;
  const input = typeof sp.terms === "string" ? sp.terms : "";
  const parsed = input ? parseTermsInput(input) : null;
  let result: VerifyResult | null = null;
  let readError = false;
  if (parsed?.ok) {
    try {
      result = await verifyTerms(parsed.terms);
    } catch {
      readError = true;
    }
  }

  return (
    <main className="page app">
      <div className="container" style={{ maxWidth: 820 }}>
      <h1>Verify an errand.</h1>
      <p className="lead">
        Paste an errand&rsquo;s terms. This page recomputes the errand address, checks whether a contract is deployed
        there, and compares the terms it stores with the ones you pasted.
      </p>
      <p className="t-small" style={{ marginTop: 12 }}>
        Terms are public: owner, session signer, expiry and rungs root. Never paste an errand key (it starts with{" "}
        <code>ldr1_</code>); it holds the keys that can spend from the errand.
      </p>

      <form className="card app-section" method="get" action="/verify" style={{ display: "grid", gap: 10 }}>
        <label htmlFor="terms" className="t-small">
          Terms as JSON. factory and implementation are optional; this site&rsquo;s deployment is used when they are left
          out.
        </label>
        <textarea className="input" id="terms" name="terms" defaultValue={input} placeholder={EXAMPLE} spellCheck={false} />
        <div>
          <button className="btn btn-ink" type="submit">
            Check these terms
          </button>
        </div>
      </form>

      {parsed && !parsed.ok && <p className="notice is-danger">{parsed.message}</p>}
      {readError && <p className="notice is-danger">The chain could not be read just now. Try again in a moment.</p>}

      {parsed?.ok && result && (
        <>
          <section className="app-section">
          <h2>Result.</h2>
          <div className="card" style={{ display: "grid", gap: 16 }}>
          <dl className="kv">
            <dt>Predicted errand address</dt>
            <dd>
              <Addr a={result.predicted} full />
              <br />
              <Link href={`/e/${result.predicted}`} className="t-small">
                Open its errand page
              </Link>
            </dd>
          </dl>
          <ul className="checks">
            {result.factoryIsLadder !== null && (
              <Check ok={result.factoryIsLadder}>
                {result.factoryIsLadder ? "The factory is the Ladder factory this site uses." : "The factory is not the Ladder factory this site uses."}
              </Check>
            )}
            {result.factoryPredict ? (
              <Check ok={result.factoryPredict === result.predicted}>
                {result.factoryPredict === result.predicted
                  ? "factory.predict() on Base returns the same address."
                  : `factory.predict() on Base returns ${result.factoryPredict}.`}
              </Check>
            ) : (
              <Check ok={false}>The factory could not be called on Base.</Check>
            )}
            <Check ok={result.deployed}>{result.deployed ? "A contract is deployed at that address." : "No contract is deployed there yet."}</Check>
            {result.cloneOfImplementation !== null && (
              <Check ok={result.cloneOfImplementation}>
                {result.cloneOfImplementation
                  ? "Its code is a minimal proxy to the errand implementation."
                  : "Its code is not a minimal proxy to the errand implementation."}
              </Check>
            )}
          </ul>
          {parsed.filled.length > 0 && (
            <p className="t-micro">Filled in from this site&rsquo;s deployment: {parsed.filled.join(", ")}.</p>
          )}
          {result.stored.length > 0 && (
            <>
              <h3 className="t-title">Stored terms</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Pasted</th>
                      <th>On chain</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.stored.map((s) => (
                      <tr key={s.field} className={s.match ? "" : "is-flagged"}>
                        <td>{s.field}</td>
                        <td className="mono">{s.expected}</td>
                        <td className="mono">{s.onChain}</td>
                        <td>{s.match ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          </div>
          </section>
        </>
      )}
      </div>
    </main>
  );
}
