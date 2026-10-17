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
  { title: "A person calls (optional)", detail: "Mosbie, results by email", cap: "$15.00" },
  { title: "Certified letter", detail: "PostalForm, about $14.40", cap: "$15.00" },
];

const SAFETY =
  "The errand can only send each step's cap to that step's one-time key, once, before the expiry. The plugin checks the service's address and price before that key pays.";

const FAQ = [
  {
    q: "Where does it work?",
    a: "In the US only. StablePhone (and Mosbie, if you add the optional person call) call US phone numbers, and PostalForm mails to US postal addresses.",
  },
  {
    q: "How long does the letter step take?",
    a: "PostalForm prints the letter and sends it by USPS Certified Mail with an electronic return receipt, for about $14.40. The step is capped at $15. Delivery takes a few days, and the tracking number shows up once it is mailed.",
  },
  {
    q: "How do I find out what the business said?",
    a: "Ask your agent. After each AI call it reads back StablePhone's summary, the full transcript and a link to the recording, and tells you what it plans next. If you add the optional $15 person call, Mosbie emails that report to the address you give the agent.",
  },
  {
    q: "Who pays the gas?",
    a: "A relayer run by this site pays Base gas for funding, step releases, sweeps and refunds. It holds ETH for gas and never holds your USDC.",
  },
  {
    q: "What stops the agent from spending on something else?",
    a: `${SAFETY} So the most any step can cost you is its cap, and what a step key does not spend goes back to you.`,
  },
  {
    q: "What happens to money a step key did not spend?",
    a: "If a service refuses a step, Ladder sends that step's money straight back to your wallet. The letter step releases the letter's exact price, so nothing is left on it. Anything else comes back when the agent finishes the errand. Step keys are held by the agent, so this return is done by the plugin, not forced by the contract.",
  },
  {
    q: "What if someone gets hold of the errand key?",
    a: "The errand key holds the errand's private keys, and it lives in your conversation. Whoever has it could spend what the errand still holds, up to the budget you approved and never more. It can't touch your PayBox wallet. Ladder refuses to put it in a call script or a letter, and treats everything a business says as untrusted.",
  },
  {
    q: "What if Ladder's site goes down?",
    a: "Ask your agent to use ladder_refund. Your own wallet calls refund() on the errand, which sends its balance back to you. It needs no errand key and doesn't go through this site. After the expiry, anyone can trigger that refund, and it still only pays you.",
  },
  {
    q: "Is there a limit on the budget?",
    a: "This site refuses budgets over $100 and expiries more than 30 days out.",
  },
  {
    q: "Has the code been audited?",
    a: "No. The contracts are short and covered by unit, fuzz, invariant and fork tests, but nobody has audited them. Start with small budgets.",
  },
  {
    q: "What if the money arrives but the errand never opens?",
    a: "This site refuses to fund an errand unless Ladder's factory is deployed, and the relayer opens the errand in the same request that moves the money. If USDC ever reaches an errand address that was not opened, anyone with its terms can open it and refund it to you. The daily cleanup only finds errands that were opened.",
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
            Your AI makes the call. You approve <em className="t-serif">once</em>.
          </h1>
          <p className="lead">
            Tell your AI what you need from a business and the most it may spend. It calls them, calls again if it has
            to, and mails a certified letter if they insist on writing. What it doesn't spend comes back to you.
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
            <span>Unspent money back to you</span>
          </div>

          <div className="hero__visual bleed">
            <div className="stage" aria-hidden="true">
              <span className="chip example-chip">Real errand · Oct 17</span>
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
                    <div className="msg you">
                      Ask 24 Hour Fitness in San Diego if a membership can be cancelled by phone or only in writing. Up
                      to $1.08.
                    </div>
                    <div className="msg ai">
                      <span className="who">Assistant</span>
                      Here is the plan. I start with the cheapest step and stop as soon as it is done.
                      <ol>
                        <li>AI call to the Balboa club, up to $0.54</li>
                        <li>Follow-up AI call, up to $0.54</li>
                      </ol>
                      That is at most $1.08. Anything a step does not use comes back to your wallet.
                    </div>
                    <div className="msg ai">
                      <span className="who">Assistant</span>
                      The club says you can cancel in person or online, and mailed cancellations aren&rsquo;t
                      accepted. The call cost $0.54, and the other $0.54 is back in your wallet.
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
                      <span className="t-micro">Payment request</span>
                      <span className="chip chip--soft">x402</span>
                    </div>
                    <div className="approval__amount">$1.08</div>
                    <div className="t-micro">USDC on Base</div>
                    <ul>
                      <li>
                        <span>Pay to</span>
                        <span>0xd72f…b362</span>
                      </li>
                      <li>
                        <span>Endpoint</span>
                        <span>ladder-errands.vercel.app/api/fund</span>
                      </li>
                    </ul>
                    <span className="btn btn-candy">Approve</span>
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
                  <span>Club: in person or online, not by mail</span>
                </div>
              </div>
              <div className="float" style={{ right: "3%", bottom: "14%" }}>
                <div className="inner">
                  <span className="dot" />
                  <span>
                    <b>$0.54</b> back to you
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section after-bleed" id="real-call">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">
              <span className="dot" />
              The real call · October 17
            </span>
            <h2>What the gym said.</h2>
            <p className="lead">
              One approval of $1.08 in PayBox. Ladder&rsquo;s AI caller rang 24 Hour Fitness in San Diego, a staff
              member picked up, and the call cost $0.54. The unused $0.54 went back on its own.
            </p>
          </div>
          <div className="card transcript reveal">
            {(
              [
                ["Caller", "Hi, I'm calling on behalf of Dhiraj Kavuri. Please note this call is recorded."],
                ["Club", "Please wait while I transfer your call."],
                ["Caller", "I'm calling to ask how to cancel a 24 Hour Fitness membership. Does it need to be done in writing, and if so, what address should I use?"],
                ["Club", "In order for you to cancel a membership, you either need to go and visit a club or do it online. Those are the only two ways of canceling."],
                ["Caller", "Is there a postal address where I can send written notice instead?"],
                ["Club", "Unfortunately, now you have to come in to a club to cancel."],
                ["Caller", "So to confirm, written cancellation by mail is not an option. I must either visit a club in person or cancel online. Is that correct?"],
                ["Club", "Correct."],
              ] as const
            ).map(([who, line], i) => (
              <p key={i} className={who === "Club" ? "line club" : "line"}>
                <span className="who">{who === "Club" ? "Club staff" : "AI caller"}</span>
                {line}
              </p>
            ))}
            <p className="t-micro" style={{ marginTop: 14 }}>
              Excerpt from StablePhone&rsquo;s transcript, lightly trimmed.{" "}
              {example && (
                <Link className="link" href={example}>
                  See every payment on the errand page
                </Link>
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="section section--alt" id="how">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">
              <span className="dot" />
              Why Ladder
            </span>
            <h2>Some errands need a call, a second call and a letter.</h2>
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
                You approve one payment for the whole plan. The agent works up the steps you agreed to, and each step
                can spend at most its own cap, once. If the first call settles it, the rest comes back to you.
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
                The first rung is a $0.54 AI phone call, then a follow-up call. The top rung is a USPS Certified Mail
                letter with electronic return receipt, about $14.40 and capped at $15. A person who calls for $15 is
                optional. Every rung and its cap is fixed when you approve.
              </p>
              <div className="chips">
                <span className="chip">Each rung pays once</span>
                <span className="chip">Caps fixed at approval</span>
                <span className="chip">You set the expiry</span>
              </div>
            </div>
            <div className="stage stage--soft reveal">
              <div className="card">
                <Ladder
                  title="The rungs of a Ladder errand and their caps; the person call is optional"
                  rungs={RUNGS}
                />
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
              <p className="t-small">The agent decides what to say and when to move up a rung. {SAFETY}</p>
            </div>
            <div className="stage stage--soft reveal">
              <div className="guarantees">
                {(
                  [
                    ["Send each step's cap only to that step's one-time key", "chain"],
                    ["Each step at most once, before the expiry", "chain"],
                    ["The errand's balance refunds only to your wallet", "chain"],
                    ["The service's address and price before a step key pays", "plugin"],
                    ["Money a refused step didn't spend goes back to you", "plugin"],
                    ["What to say on the call", "agent"],
                    ["When to move up a rung", "agent"],
                  ] as const
                ).map(([text, who]) => (
                  <div className="row" key={text}>
                    <span>{text}</span>
                    <span className={`who-tag${who === "chain" ? " chain" : ""}`}>
                      {who === "chain" ? "Base enforces" : who === "plugin" ? "Plugin checks" : "Agent decides"}
                    </span>
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
              <span className="chip example-chip">Example</span>
              <div className="window">
                <div className="window__bar">
                  <div className="lights">
                    <i />
                    <i />
                    <i />
                  </div>
                  <span className="window__title">Errand timeline (example)</span>
                </div>
                <div className="mini-timeline">
                  {[
                    ["Funded by owner", "Errand", "$16.08"],
                    ["Released to step 1 key", "AI call", "$0.54"],
                    ["Step 1 key paid StablePhone", "StablePhone call", "$0.54"],
                    ["Released to step 2 key", "Follow-up AI call", "$0.54"],
                    ["Step 2 key paid StablePhone", "StablePhone call", "$0.54"],
                    ["Released to step 3 key", "Certified letter", "$15.00"],
                    ["Step 3 key paid PostalForm", "PostalForm order deposit", "$14.40"],
                    ["Step 3 key returned the rest", "Owner", "$0.60"],
                    ["Refund of the errand balance", "Owner", "$0.00"],
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
            <p className="lead">
              Pick an errand, a spending limit and the steps. The preview shows what you would approve.
            </p>
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
              [
                <IconDatabaseOff key="i" />,
                "No database",
                "Pages read Base when they load. The site keeps no record of you or your errands.",
              ],
              [
                <IconUndo key="i" />,
                "Refunds go only to you",
                "After expiry anyone can trigger the refund, and it can only reach the wallet that funded the errand.",
              ],
              [
                <IconMapPin key="i" />,
                "US numbers and addresses",
                "The calling and mail services reach US phone numbers and US postal addresses only.",
              ],
              [
                <IconLock key="i" />,
                "Address fixed by the terms",
                "The errand address is computed from its terms, so anyone can check what it may pay before it holds money.",
              ],
              [
                <IconCode key="i" />,
                "Open source",
                "The contracts, the PayBox plugin and this site live in one repository, each with its own tests.",
              ],
              [
                <IconCheckCircle key="i" />,
                "Checked on every push",
                "CI runs contract fuzz and invariant tests, fork tests against Base USDC and the plugin conformance build.",
              ],
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
            Ladder is a PayBox plugin. Add it, then ask your agent to get something done and tell it the most it may
            spend.
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
