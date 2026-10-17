import Link from "next/link";
import { Ladder } from "@/components/Ladder";
import { readConfig } from "@/lib/config";
import { usd } from "@/lib/format";
import { RAILS } from "@/lib/rails";

export const dynamic = "force-dynamic";

export default function Home() {
  const cfg = readConfig();
  const example = cfg.exampleErrand
    ? `/e/${cfg.exampleErrand}${cfg.examplePlan ? `?plan=${encodeURIComponent(cfg.examplePlan)}` : ""}`
    : null;
  return (
    <main className="wrap">
      <h1>Get it done, up to a set amount.</h1>
      <p className="lede">
        Ladder lets your agent work through an errand one step at a time, from an AI phone call to a human caller to a
        certified letter, paying from a Base account that can pay only the steps you approved, each once and up to its
        cap, and that returns whatever is left to you.
      </p>

      <figure className="ladder-figure">
        <Ladder
          title="The three rungs of a Ladder errand"
          rungs={RAILS.map((r) => ({ title: r.service, detail: `${r.name}, ${r.price}`, cap: usd(r.cap) }))}
        />
        <figcaption>Each errand climbs only as far as it has to. A rung that is never needed is never paid.</figcaption>
      </figure>

      <div className="facts">
        <div>
          <strong>One approval</strong>
          <span>You approve one USDC payment in PayBox. It funds the errand account and nothing else.</span>
        </div>
        <div>
          <strong>Caps enforced on chain</strong>
          <span>The account pays only the committed steps, each at most once and at most its cap, before the expiry.</span>
        </div>
        <div>
          <strong>Leftover comes back</strong>
          <span>Refunds can only go to the wallet that funded the errand. Anyone can trigger one after the expiry.</span>
        </div>
      </div>

      <h2>How an errand runs</h2>
      <ol className="steps">
        <li>
          You tell your agent what you need and how much it may spend, for example &ldquo;cancel this gym membership, up to
          $30&rdquo;.
        </li>
        <li>
          The agent plans the rungs and shows you the mandate: who each step pays, the most each may cost, and when the
          errand expires.
        </li>
        <li>
          You approve one payment. It lands in an errand account whose address is fixed by those terms, and the account
          opens on Base.
        </li>
        <li>
          Each step gets a one-time key. The errand releases at most that step&rsquo;s cap to the key, and the key pays the
          service directly.
        </li>
        <li>When the errand is done or expires, everything left, including anything a step key did not spend, returns to you.</li>
      </ol>

      <h2>See it for yourself</h2>
      <p>
        {example ? (
          <>
            <Link href={example}>A live errand on Base</Link> shows each payment as it happened, with links to Basescan.{" "}
          </>
        ) : (
          <>A live example errand will be linked here once one has run. </>
        )}
        The <Link href="/judges">judges page</Link> lists every claim with how to check it, and{" "}
        <Link href="/verify">verify</Link> recomputes an errand address from its terms.
      </p>
    </main>
  );
}
