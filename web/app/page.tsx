import Link from "next/link";
import { AppIcon } from "@/components/AppIcon";
import {
  IconCheckCircle,
  IconCode,
  IconDatabaseOff,
  IconLadder,
  IconList,
  IconLock,
  IconMapPin,
  IconShield,
  IconUndo,
} from "@/components/Icons";
import { Ladder } from "@/components/Ladder";
import { Motion } from "@/components/Motion";
import { TryIt } from "@/components/TryIt";
import { installUrl, readConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const RUNGS = [
  { title: "AI call", detail: "StablePhone calls the business", cap: "$0.54" },
  { title: "Follow-up AI call", detail: "StablePhone calls again", cap: "$0.54" },
  { title: "A person calls", detail: "Mosbie, results by email", cap: "$15.00" },
  { title: "Certified letter", detail: "PostalForm, USPS with return receipt", cap: "$20.00" },
];

const FAQ = [
  {
    q: "Where does it work?",
    a: "In the US only. StablePhone and Mosbie call US phone numbers, and PostalForm mails to US postal addresses.",
  },
  {
    q: "How long does the letter step take?",
    a: "PostalForm prints the letter and sends it by USPS Certified Mail with a return receipt. Delivery takes a few days, and the tracking number shows up once it is mailed.",
  },
  {
    q: "How do I hear what the person said on the call?",
    a: "Mosbie emails the result to the address you give the agent when it plans the errand.",
  },
  {
    q: "Who pays the gas?",
    a: "A relayer run by this site pays Base gas for funding, step releases, sweeps and refunds. It holds ETH for gas and never holds your USDC.",
  },
  {
    q: "What stops the agent from spending on something else?",
    a: "The errand contract approves a payment only when it matches a committed step, stays within that step's cap, is that step's first payment and lands before expiry. USDC asks the contract before every transfer, so any other payment fails.",
  },
  {
    q: "What happens to money a step key did not spend?",
    a: "The agent sends it back to your wallet when it finishes. A step key is held by the agent, so the contract cannot force that return, which is why each release is capped at the step's price.",
  },
  {
    q: "Is there a limit on the budget?",
    a: "This site refuses budgets over $100 and expiries more than 30 days out.",
  },
  {
    q: "Has the code been audited?",
    a: "No. The contracts are short and covered by unit, fuzz, invariant and fork tests, but nobody has audited them. Start with small budgets.",
  },
];

export default function Home() {
  const cfg = readConfig();
  const example = cfg.exampleErrand
    ? `/e/${cfg.exampleErrand}${cfg.examplePlan ? `?plan=${encodeURIComponent(cfg.examplePlan)}` : ""}`
    : null;
  const add = installUrl(cfg);

  return (
    <main>
      <Motion />
      <section className="hero">
        <div className="container">
          <span className="badge">
            <span className="badge__tag">New</span>
            Built for PayBox
          </span>
          <h1>
            Get a real errand <em className="t-serif">done</em> with one approval.
          </h1>
          <p className="lead">
            Tell your AI what you need and how much it may spend. It calls the business, brings in a person if that fails,
            then sends a certified letter. Money it does not use comes back to you.
          </p>
          <div className="cta-row">
            <a className="btn btn-candy btn-lg" href={add}>
              Add to PayBox
            </a>
            <Link className="btn btn-outline btn-lg" href={example ?? "/#every-dollar"}>
              {example ? "See a live errand" : "See an errand page"}
            </Link>
          </div>
          <div className="trust">
            <span>One approval</span>
            <span>Caps enforced on Base</span>
            <span>Leftover refunded to you</span>
          </div>

          <div className="hero__visual bleed">
            <div className="stage" aria-hidden="true">
              <span className="chip example-chip">Example</span>
              <div className="hero-stage">
                <div className="window window--dark">
                  <div className="window__bar">
                    <div className="lights">
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="window__title">Assistant</span>
                  </div>
                  <div className="chat">
                    <div className="msg you">Cancel my Northside Gym membership. Whatever it takes, up to $30.</div>
                    <div className="msg ai">
                      <span className="who">Assistant</span>
                      Here is the plan. I start with the cheapest step and stop as soon as it is done.
                      <ol>
                        <li>AI call to Northside Gym, up to $0.54</li>
                        <li>Follow-up AI call, up to $0.54</li>
                        <li>A person calls for you, up to $15</li>
                        <li>Certified letter with return receipt, up to $20</li>
                      </ol>
                      Anything left goes back to your wallet. Approve $30 in PayBox to start.
                    </div>
                    <div className="msg ai">
                      <span className="who">Assistant</span>
                      The gym needs written notice, so I sent the certified letter. You got $14.52 back.
                    </div>
                  </div>
                </div>

                <div className="window">
                  <div className="window__bar">
                    <div className="lights">
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="window__title">PayBox</span>
                  </div>
                  <div className="approval">
                    <div className="approval__head">
                      <span className="t-micro">One payment on Base</span>
                      <span className="chip chip--soft">USDC</span>
                    </div>
                    <div className="approval__amount">$30.00</div>
                    <div className="t-micro">
                      To errand <span className="t-mono">0x7a3f…c41e</span>, which can only pay:
                    </div>
                    <ul>
                      <li>
                        <span>AI call</span>
                        <span>$0.54, once</span>
                      </li>
                      <li>
                        <span>Follow-up AI call</span>
                        <span>$0.54, once</span>
                      </li>
                      <li>
                        <span>A person calls</span>
                        <span>$15.00, once</span>
                      </li>
                      <li>
                        <span>Certified letter</span>
                        <span>$20.00, once</span>
                      </li>
                    </ul>
                    <div className="t-micro">The rest returns to you. Expires in 72 hours.</div>
                    <span className="btn btn-candy">Approve with passkey</span>
                  </div>
                </div>
              </div>
              <div className="float" style={{ left: "3%", top: "9%" }}>
                <div className="inner">
                  <span className="dot" />
                  <span>
                    <b>Step 1</b> · AI call · $0.54 paid
                  </span>
                </div>
              </div>
              <div className="float" style={{ left: "38%", bottom: "6%" }}>
                <div className="inner">
                  <span>Gym says: needs written notice</span>
                </div>
              </div>
              <div className="float" style={{ right: "3%", bottom: "14%" }}>
                <div className="inner">
                  <span className="dot" />
                  <span>
                    <b>Refunded $14.52</b> to you
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt after-bleed" id="how">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">
              <span className="dot" />
              Why Ladder
            </span>
            <h2>Some errands need a call, a person and a letter.</h2>
            <p className="lead">
              Cancelling a membership or chasing a refund often means escalating. Ladder lets an agent escalate for you
              inside limits you set once.
            </p>
          </div>
          <div className="grid grid-2">
            <div className="card card--flat reveal">
              <h3 className="t-title">Doing it yourself</h3>
              <p className="t-small" style={{ marginTop: 8 }}>
                You wait on hold, get told to put it in writing, then print, sign and mail a certified letter. An agent
                with a wallet would ask you to approve each of those payments as it went.
              </p>
            </div>
            <div className="card card--flat card--chosen reveal" style={{ ["--i" as string]: 1 }}>
              <h3 className="t-title">With Ladder</h3>
              <p className="t-small" style={{ marginTop: 8 }}>
                You approve one payment. The agent works up the steps you agreed to, and the errand contract on Base
                refuses any payment outside that plan.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container stack">
          <div className="split">
            <div>
              <span className="eyebrow">
                <IconLadder />
                The ladder
              </span>
              <h3>The agent starts with the cheapest step.</h3>
              <p className="t-small">
                The first rung is a $0.54 AI phone call. If the business wants more, a person calls for $15, and the top
                rung is a USPS Certified Mail letter. Every rung and its cap is fixed when you approve.
              </p>
              <div className="chips">
                <span className="chip">Each rung pays once</span>
                <span className="chip">Caps fixed at approval</span>
                <span className="chip">You set the expiry</span>
              </div>
            </div>
            <div className="stage stage--soft reveal">
              <div className="card">
                <Ladder title="The four rungs of a Ladder errand and their caps" rungs={RUNGS} />
              </div>
            </div>
          </div>

          <div className="split split--flip">
            <div>
              <span className="eyebrow">
                <IconShield />
                What the chain enforces
              </span>
              <h3>The contract holds the agent to the plan.</h3>
              <p className="t-small">
                The agent decides what to say and when to move up a rung. The errand contract on Base decides where the
                money can go, and USDC checks with it before every transfer.
              </p>
            </div>
            <div className="stage stage--soft reveal">
              <div className="guarantees">
                {[
                  ["Pay only the steps you approved", true],
                  ["Each step at most once, up to its cap", true],
                  ["Nothing after the expiry", true],
                  ["Refunds only to your wallet", true],
                  ["What to say on the call", false],
                  ["When to move up a rung", false],
                ].map(([text, chain]) => (
                  <div className="row" key={String(text)}>
                    <span>{text}</span>
                    <span className={`who-tag${chain ? " chain" : ""}`}>{chain ? "Base enforces" : "Agent decides"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="split" id="every-dollar">
            <div>
              <span className="eyebrow">
                <IconList />
                Every dollar is on the page
              </span>
              <h3>
                Every payment is <span className="hl">on a public page</span>.
              </h3>
              <p className="t-small">
                Each errand has a page built from Base logs. It shows the funding payment, each release to a step key,
                what that key paid and the refund, and every row links to Basescan.
              </p>
              {example && (
                <p className="t-small">
                  <Link className="link" href={example}>
                    Open a live errand page
                  </Link>
                </p>
              )}
            </div>
            <div className="stage stage--soft reveal" aria-hidden="true">
              <div className="window">
                <div className="window__bar">
                  <div className="lights">
                    <i />
                    <i />
                    <i />
                  </div>
                  <span className="window__title">Errand timeline</span>
                </div>
                <div className="mini-timeline">
                  {[
                    ["Funded by owner", "Errand", "$30.00"],
                    ["Released to step 1 key", "AI call", "$0.54"],
                    ["Step 1 key paid StablePhone", "StablePhone call", "$0.54"],
                    ["Released to step 2 key", "Follow-up AI call", "$0.54"],
                    ["Step 4 key paid PostalForm", "PostalForm order deposit", "$14.40"],
                    ["Refund to owner", "Owner", "$14.52"],
                  ].map(([what, to, amt]) => (
                    <div className="row" key={what}>
                      <span>
                        {what}
                        <span className="sub">{to}</span>
                      </span>
                      <span className="amt">{amt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt" id="try">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">
              <span className="dot" />
              Try it here
            </span>
            <h2>Build a mandate and see what it allows.</h2>
            <p className="lead">Pick an errand, a budget and the steps. The preview shows what you would approve.</p>
          </div>
          <TryIt />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>The rest of the details.</h2>
          </div>
          <div className="grid grid-3">
            {[
              [<IconDatabaseOff key="i" />, "No database", "Pages read Base when they load. The site keeps no record of you or your errands."],
              [<IconUndo key="i" />, "Refunds go only to you", "After expiry anyone can trigger the refund, and it can only reach the wallet that funded the errand."],
              [<IconMapPin key="i" />, "US numbers and addresses", "The calling and mail services reach US phone numbers and US postal addresses only."],
              [<IconLock key="i" />, "Address fixed by the terms", "The errand address is computed from its terms, so anyone can check what it may pay before it holds money."],
              [<IconCode key="i" />, "Open source", "The contracts, the PayBox plugin and this site live in one repository, each with its own tests."],
              [<IconCheckCircle key="i" />, "Checked on every push", "CI runs contract fuzz and invariant tests, fork tests against Base USDC and the plugin conformance build."],
            ].map(([icon, title, text], i) => (
              <div className="tile reveal" key={String(title)} style={{ ["--i" as string]: i % 3 }}>
                <span className="icon-tile">{icon}</span>
                <div>
                  <h3 className="t-title">{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <div className="section-head">
            <h2>Questions.</h2>
          </div>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section final-cta" id="add">
        <div className="container">
          <AppIcon size={88} />
          <h2>
            Hand off the errand. <span className="t-muted">Keep the change.</span>
          </h2>
          <p className="lead" style={{ margin: "18px auto 0" }}>
            Ladder is a PayBox plugin. Add it, then ask your agent to get something done and tell it the most it may spend.
          </p>
          <div className="cta-row">
            <a className="btn btn-candy btn-lg" href={add}>
              Add to PayBox
            </a>
            <Link className="btn btn-outline btn-lg" href="/judges">
              For judges
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
