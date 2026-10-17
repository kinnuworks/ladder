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
  return <li className={ok ? "" : "bad"}>{children}</li>;
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
    <main className="wrap">
      <h1>Verify an errand</h1>
      <p className="lede">
        Paste an errand&rsquo;s terms. This page recomputes the errand address, checks whether a contract is deployed
        there, and compares the terms it stores with the ones you pasted.
      </p>
      <p className="muted small">
        Terms are public: owner, session signer, expiry and rungs root. Never paste an errand key (it starts with{" "}
        <code>ldr1_</code>); it holds the keys that can spend from the errand.
      </p>

      <form className="verify" method="get" action="/verify">
        <label htmlFor="terms" className="small muted">
          Terms as JSON. factory and implementation are optional; this site&rsquo;s deployment is used when they are left
          out.
        </label>
        <textarea id="terms" name="terms" defaultValue={input} placeholder={EXAMPLE} spellCheck={false} />
        <button type="submit">Check these terms</button>
      </form>

      {parsed && !parsed.ok && <p className="notice danger">{parsed.message}</p>}
      {readError && <p className="notice danger">The chain could not be read just now. Try again in a moment.</p>}

      {parsed?.ok && result && (
        <>
          <h2>Result</h2>
          <dl className="terms">
            <dt>Predicted errand address</dt>
            <dd>
              <Addr a={result.predicted} full />
              <br />
              <Link href={`/e/${result.predicted}`} className="small">
                Open its errand page
              </Link>
            </dd>
          </dl>
          <ul className="check">
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
            <p className="muted small">Filled in from this site&rsquo;s deployment: {parsed.filled.join(", ")}.</p>
          )}
          {result.stored.length > 0 && (
            <>
              <h3>Stored terms</h3>
              <div className="table-scroll">
                <table>
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
                      <tr key={s.field} className={s.match ? "" : "flagged"}>
                        <td>{s.field}</td>
                        <td className="mono small">{s.expected}</td>
                        <td className="mono small">{s.onChain}</td>
                        <td>{s.match ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
