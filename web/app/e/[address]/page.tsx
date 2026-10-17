import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { Addr, Tx } from "@/components/Addr";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Ladder } from "@/components/Ladder";
import { type ErrandView, loadErrandView } from "@/lib/errand";
import { duration, short } from "@/lib/format";
import { decodePlanParam } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }>; searchParams: Promise<{ plan?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: `Errand ${short(address)}`, robots: { index: false } };
}

const STATUS_TEXT: Record<ErrandView["status"], string> = {
  "not-opened": "Not opened",
  open: "Open",
  expired: "Expired",
  closed: "Closed",
};

export default async function ErrandPage({ params, searchParams }: Props) {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) notFound();
  const sp = await searchParams;
  const { plan, error } = decodePlanParam(typeof sp.plan === "string" ? sp.plan : undefined);

  let v: ErrandView;
  try {
    v = await loadErrandView(getAddress(address), plan, error);
  } catch {
    return (
      <main className="page app">
        <div className="container">
          <h1>Errand.</h1>
          <p className="mono" style={{ marginTop: 12 }}>
            {getAddress(address)}
          </p>
          <p className="notice is-danger">Base could not be read just now. Reload in a moment.</p>
        </div>
      </main>
    );
  }

  const statusClass = v.status === "open" ? "is-open" : v.status === "closed" ? "is-closed" : "";
  return (
    <main className="page app">
      <AutoRefresh seconds={20} />
      <div className="container">
        <div className="meta-row">
          <span className="chip">
            <span className={`status-dot ${statusClass}`}>{STATUS_TEXT[v.status]}</span>
          </span>
          <span className="t-micro">Errand on Base</span>
        </div>
        <h1>{v.plan?.business ? `Errand with ${v.plan.business}.` : "Errand."}</h1>
        <p className="mono" style={{ marginTop: 12 }}>
          <Addr a={v.address} full />
        </p>

        <div className="stats">
          <div className="card stat">
            <span className="t-micro">Funded</span>
            <span className="value">{v.fundedUsd}</span>
          </div>
          <div className="card stat">
            <span className="t-micro">Balance now</span>
            <span className="value">{v.balanceUsd}</span>
          </div>
          <div className="card stat">
            <span className="t-micro">{v.expiresIn !== null && v.expiresIn <= 0 ? "Expired" : "Expires in"}</span>
            <span className="value">
              {v.expiresIn === null
                ? "Not set"
                : v.expiresIn > 0
                  ? duration(v.expiresIn)
                  : `${duration(v.expiresIn)} ago`}
            </span>
          </div>
        </div>

        {v.flags.map((f, i) => (
          <p key={`f${i}`} className="notice is-danger">
            {f}
          </p>
        ))}
        {v.planIssues.map((f, i) => (
          <p key={`p${i}`} className="notice">
            {f}
          </p>
        ))}
        {!v.deployed && (
          <p className="notice">
            No errand contract is deployed at this address yet. It opens when its funding payment settles.
            {v.funded !== "0" && " USDC is already here and can only be used under the committed terms."}
          </p>
        )}

        {v.rungs.length > 0 && (
          <section className="app-section">
            <h2>The ladder.</h2>
            <div className="grid grid-2" style={{ alignItems: "start" }}>
              <div className="card">
                <Ladder
                  title="Rungs of this errand"
                  rungs={v.rungs.map((r) => ({ title: r.label, detail: r.railName, cap: r.maxUsd, state: r.state }))}
                />
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Step key</th>
                      <th className="num">Cap</th>
                      <th>On chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.rungs.map((r) => (
                      <tr key={r.index}>
                        <td>
                          {r.index + 1}. {r.label}
                          <br />
                          <span className="t-micro">{r.railName}</span>
                        </td>
                        <td>
                          <Addr a={r.runner} />
                        </td>
                        <td className="num">{r.maxUsd}</td>
                        <td>
                          {r.checks.length === 0 ? (
                            <span className="t-micro">Not used</span>
                          ) : (
                            <ul className="checks">
                              {r.checks.map((c, i) => (
                                <li key={i} className={c.ok ? "" : "is-bad"}>
                                  {c.text}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        <section className="app-section">
          <h2>Timeline.</h2>
          {!v.runnersKnown && (
            <p className="t-small" style={{ marginBottom: 12 }}>
              This link has no plan, so the page lists payments into and out of the errand account only. The agent can
              share a link with the plan that labels each step key and what it paid.
            </p>
          )}
          {v.timeline.length === 0 ? (
            <p className="notice">No USDC has moved through this errand yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>When (UTC)</th>
                    <th>What</th>
                    <th>To</th>
                    <th className="num">Amount</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {v.timeline.map((r, i) => (
                    <tr key={`${r.tx}-${i}`} className={r.flagged ? "is-flagged" : ""}>
                      <td className="t-micro" style={{ whiteSpace: "nowrap" }}>
                        {r.timeIso}
                      </td>
                      <td>
                        {r.label}
                        {r.note && (
                          <>
                            <br />
                            <span className="t-micro">{r.note}</span>
                          </>
                        )}
                      </td>
                      <td>
                        {r.toLabel}
                        <br />
                        <Addr a={r.to} />
                      </td>
                      <td className="num">{r.amountUsd}</td>
                      <td>
                        <Tx h={r.tx} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="app-section">
          <h2>Terms on chain.</h2>
          {v.terms ? (
            <div className="card">
              <dl className="kv">
                <dt>Owner, the only refund destination</dt>
                <dd>
                  <Addr a={v.terms.owner} full />
                </dd>
                <dt>Session signer</dt>
                <dd>
                  <Addr a={v.terms.sessionSigner} full />
                </dd>
                <dt>Expiry</dt>
                <dd>
                  {v.terms.expiryIso} UTC <span className="t-micro">({v.terms.expiry})</span>
                </dd>
                <dt>Rungs root</dt>
                <dd className="mono">{v.terms.rungsRoot}</dd>
                <dt>Closed</dt>
                <dd>{v.terms.closed ? "Yes, refunded to the owner" : "No"}</dd>
                {v.openTx && (
                  <>
                    <dt>Opened in</dt>
                    <dd>
                      <Tx h={v.openTx} />
                    </dd>
                  </>
                )}
              </dl>
            </div>
          ) : (
            <p className="notice">Terms appear here once the errand contract is deployed.</p>
          )}
          <p className="t-micro" style={{ marginTop: 20 }}>
            Read from Base at {new Date(v.updatedAt * 1000).toISOString().slice(11, 19)} UTC and refreshed every 20
            seconds. Times come from block numbers at two seconds per block.
          </p>
        </section>
      </div>
    </main>
  );
}
