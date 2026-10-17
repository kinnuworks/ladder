"use client";
import { useState } from "react";

const TYPES = [
  {
    id: "cancel",
    label: "Cancel a subscription",
    goal: "Cancel the membership and get the cancellation in writing.",
    who: "Northside Gym",
  },
  {
    id: "refund",
    label: "Get a refund",
    goal: "Refund the charge for a class that was cancelled.",
    who: "Brightline Studio",
  },
  {
    id: "dispute",
    label: "Dispute a charge",
    goal: "Reverse a renewal charge that was never authorized.",
    who: "Metro Cable",
  },
  {
    id: "deposit",
    label: "Get a deposit back",
    goal: "Return the security deposit owed since move-out.",
    who: "Oak Street Rentals",
  },
] as const;

const STEPS = [
  { id: "call", label: "AI call", detail: "StablePhone", note: "$0.54", cap: 0.54 },
  { id: "followup", label: "Follow-up AI call", detail: "StablePhone", note: "$0.54", cap: 0.54 },
  { id: "person", label: "A person calls (optional)", detail: "Mosbie", note: "$15", cap: 15 },
  { id: "letter", label: "Certified letter", detail: "PostalForm", note: "about $14.40", cap: 15 },
] as const;

const money = (n: number) => `$${n.toFixed(2)}`;

export function TryIt() {
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("cancel");
  const [budget, setBudget] = useState(30);
  const [on, setOn] = useState<Record<string, boolean>>({ call: true, followup: true, person: false, letter: true });
  const t = TYPES.find((x) => x.id === type)!;
  const chosen = STEPS.filter((s) => on[s.id]);
  const runnable = chosen.filter((s) => s.cap <= budget);
  const capsTotal = runnable.reduce((a, s) => a + s.cap, 0);
  // The errand is funded with the caps it could need, never more than the limit you set.
  const funded = Math.min(budget, Math.round(capsTotal * 100) / 100);
  const first = runnable[0];

  return (
    <div className="try">
      <div className="card">
        <div className="control">
          <span className="label" id="try-type">
            Errand
          </span>
          <div className="chips" role="group" aria-labelledby="try-type">
            {TYPES.map((x) => (
              <button
                key={x.id}
                type="button"
                className="chip"
                aria-pressed={x.id === type}
                onClick={() => setType(x.id)}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="control">
          <label htmlFor="try-budget">
            Spending limit <span className="t-mono">{money(budget)}</span>
          </label>
          <input
            id="try-budget"
            className="range"
            type="range"
            min={5}
            max={100}
            step={1}
            value={budget}
            style={{ ["--val" as string]: `${((budget - 5) / 95) * 100}%` }}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
        </div>
        <div className="control">
          <span className="label">Steps the agent may take</span>
          {STEPS.map((s) => (
            <label key={s.id} className="switch-row">
              <span>
                {s.label}
                <small>
                  {s.detail}, {s.note}, cap {money(s.cap)}
                </small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={!!on[s.id]}
                onChange={(e) => setOn({ ...on, [s.id]: e.target.checked })}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="stage stage--soft preview" aria-live="polite">
        <div className="window">
          <div className="window__bar">
            <div className="lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span className="window__title">Mandate preview</span>
          </div>
          <div className="preview__body">
            <div>
              <div className="t-micro">{t.who}</div>
              <div className="t-title">{t.goal}</div>
            </div>
            {chosen.length === 0 ? (
              <p className="t-small">Turn on at least one step. An errand needs one rung to exist.</p>
            ) : (
              <ol className="preview__steps">
                {chosen.map((s, i) => (
                  <li key={s.id} className={s.cap > budget ? "is-off" : ""}>
                    <span>
                      {i + 1}. {s.label} via {s.detail}
                      {s.cap > budget && <span className="t-micro"> (cap is above the limit)</span>}
                    </span>
                    <span className="mono">at most {money(s.cap)}, once</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="preview__sum">
              <span>You approve one payment of</span>
              <span className="mono">{money(funded)}</span>
              {first && (
                <>
                  <span>Comes back if step 1 settles it</span>
                  <span className="mono">{money(funded - first.cap)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <p className="t-micro" style={{ textAlign: "center" }}>
          A preview with example businesses. Nothing is planned or paid on this page.
        </p>
      </div>
    </div>
  );
}
