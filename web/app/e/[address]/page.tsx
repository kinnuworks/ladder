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
  return { title: `Errand ${short(address)}` };
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
      <main className="wrap wide">
        <h1>Errand</h1>
        <p className="mono">{getAddress(address)}</p>
        <p className="notice danger">The chain could not be read just now. Reload in a moment.</p>
      </main>
    );
  }

  return (
    <main className="wrap wide">
      <AutoRefresh seconds={20} />
      <p className="muted small">
        Errand <span className={`status ${v.status === "open" ? "open" : ""}`}>{STATUS_TEXT[v.status]}</span>
      </p>
      <h1>{v.plan?.goal ?? "Errand"}</h1>
      {v.plan?.business && <p className="lede">With {v.plan.business}</p>}
      <p>
        <Addr a={v.address} full />
      </p>

      <div className="stats">
        <div>
          <span className="label">Funded</span>
          <span className="value">{v.fundedUsd}</span>
        </div>
        <div>
          <span className="label">Balance now</span>
          <span className="value">{v.balanceUsd}</span>
        </div>
        <div>
          <span className="label">{v.expiresIn !== null && v.expiresIn <= 0 ? "Expired" : "Expires in"}</span>
          <span className="value">
            {v.expiresIn === null ? "Not set" : v.expiresIn > 0 ? duration(v.expiresIn) : `${duration(v.expiresIn)} ago`}
          </span>
        </div>
      </div>

      {v.flags.map((f, i) => (
        <p key={i} className="notice danger">
          {f}
        </p>
      ))}
      {v.planIssues.map((f, i) => (
        <p key={i} className="notice">
          {f}
        </p>
      ))}

      {!v.deployed && (
        <p className="notice">
          No errand contract is deployed at this address yet. It opens when its funding payment settles.
          {v.funded !== "0" && " USDC is already waiting here and can only be used under the committed terms."}
        </p>
      )}

      {v.rungs.length > 0 && (
        <>
          <h2>The ladder</h2>
          <figure className="ladder-figure">
            <Ladder
              title="Rungs of this errand"
              rungs={v.rungs.map((r) => ({ title: r.label, detail: r.railName, cap: r.maxUsd, state: r.state }))}
            />
          </figure>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Service</th>
                  <th>Step key</th>
                  <th className="num">Cap</th>
                  <th>What the chain shows</th>
                </tr>
              </thead>
              <tbody>
                {v.rungs.map((r) => (
                  <tr key={r.index}>
                    <td>
                      {r.index + 1}. {r.label}
                    </td>
                    <td>
                      {r.railName}
                      <br />
                      <span className="muted small">{r.service}</span>
                    </td>
                    <td>
                      <Addr a={r.runner} />
                    </td>
                    <td className="num">{r.maxUsd}</td>
                    <td>
                      {r.checks.length === 0 ? (
                        <span className="muted">Not used</span>
                      ) : (
                        <ul className="check">
                          {r.checks.map((c, i) => (
                            <li key={i} className={c.ok ? "" : "bad"}>
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
        </>
      )}

      <h2>Timeline</h2>
      {!v.runnersKnown && (
        <p className="muted small">
          This link has no plan, so only payments into and out of the errand account are shown. Open the link from the
          agent to see each step key and what it paid.
        </p>
      )}
      {v.timeline.length === 0 ? (
        <p className="muted">No USDC has moved through this errand yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
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
                <tr key={`${r.tx}-${i}`} className={r.flagged ? "flagged" : ""}>
                  <td className="small">{r.timeIso}</td>
                  <td>
                    {r.label}
                    {r.note && (
                      <>
                        <br />
                        <span className="muted small">{r.note}</span>
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

      <h2>Terms on chain</h2>
      {v.terms ? (
        <dl className="terms">
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
            {v.terms.expiryIso} UTC <span className="muted small">({v.terms.expiry})</span>
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
      ) : (
        <p className="muted">Terms appear here once the errand contract is deployed.</p>
      )}
      <p className="muted small" style={{ marginTop: 32 }}>
        Read from Base at {new Date(v.updatedAt * 1000).toISOString().slice(11, 19)} UTC and refreshed every 20 seconds.
        Times come from block numbers at two seconds per block.
      </p>
    </main>
  );
}
