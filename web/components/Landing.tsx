import Link from "next/link";
import { Logo } from "./Logo";
import { FoundingSlots } from "./FoundingSlots";
import { hasWagerBook, wagerBookAddress } from "../lib/contracts";

/// The public front door. Someone arriving from a friend's text has no idea what
/// this is, and the honest pitch is short: it is the bet you already make,
/// except the money actually moves.

const STEPS = [
  {
    label: "Challenge",
    body: "Say it the way you'd say it out loud. “$25 each that Texas beats Ohio State.” We turn that into terms you can check before anyone commits.",
  },
  {
    label: "Accept",
    body: "Your friends get a link, pick a side, and put their money where their mouth is. Once both sides are funded, the terms lock and nobody can move the goalposts.",
  },
  {
    label: "Resolve",
    body: "Most bets settle themselves — the loser concedes, or everyone agrees who won. For anything with a scoreboard, we can read the result directly.",
  },
  {
    label: "Settle",
    body: "The winner gets paid the moment it's resolved. No chasing anyone for a Venmo they'll get to on Tuesday.",
  },
];

export function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Logo size={24} />
        <Link href="/signin" className="landing-nav-cta">
          Sign in
        </Link>
      </header>

      <section className="landing-hero">
        <h1>
          Private wagers between friends.
          <span>A handshake that holds.</span>
        </h1>
        <p className="landing-lede">
          &ldquo;I&rsquo;ll bet you.&rdquo; You already say it. The problem is everything after
          &mdash; the terms get fuzzy, somebody forgets, and collecting is awkward. This holds
          the money and settles it for you.
        </p>
        <div className="landing-actions">
          <Link href="/signin">
            <button>Start a challenge</button>
          </Link>
          <span className="landing-note">No app to install. No seed phrase. Free to create.</span>
        </div>
      </section>

      <section className="landing-section">
        <h2 className="landing-h2">How a bet works</h2>
        <ol className="landing-steps">
          {STEPS.map((step, i) => (
            <li key={step.label}>
              <span className="landing-step-num">{i + 1}</span>
              <div>
                <h3>{step.label}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section">
        <h2 className="landing-h2">Why be the one who starts it</h2>
        <p className="landing-body">
          Normally the person who proposes the bet ends up running it. You collect from
          everyone, you&rsquo;re the one who remembers what was actually agreed, and when it&rsquo;s
          close you have to be the one who calls it. That&rsquo;s why good bets die in the group
          chat &mdash; nobody wants the job.
        </p>
        <p className="landing-body">Here the job doesn&rsquo;t exist.</p>
        <div className="landing-grid">
          <div className="landing-card">
            <h3>You write the terms</h3>
            <p>
              The claim, the stake, the deadline, how it gets settled. Everyone reads it before a
              dollar moves, so there&rsquo;s nothing to argue about later.
            </p>
          </div>
          <div className="landing-card">
            <h3>You pick who&rsquo;s in</h3>
            <p>
              Send it to one person or the whole group. They take a side from the link &mdash; no
              account to set up first.
            </p>
          </div>
          <div className="landing-card">
            <h3>You collect from nobody</h3>
            <p>
              Everyone funds their own side up front. The winner gets paid the moment it&rsquo;s
              resolved, and you never send a single reminder.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-section landing-bond">
        <h2 className="landing-h2">The part that makes it work</h2>
        <p className="landing-body">
          Every bet carries a small refundable bond &mdash; a dollar on a twenty-five dollar
          wager. Say who won within the window and you get it straight back. Go quiet and leave
          everyone hanging, and it goes to the people who did show up.
        </p>
        <p className="landing-body">
          The house never touches it. That&rsquo;s deliberate: we have nothing to gain from your
          bet turning into an argument, so the incentive to settle honestly sits with you and
          your friends, where it belongs.
        </p>
        <p className="landing-body">
          It isn&rsquo;t a promise, either. The money sits in a contract on{" "}
          <b>Base, the blockchain built by Coinbase</b> &mdash; not in an account we control and
          not on a balance sheet you have to take our word for. We could not spend it if we
          wanted to, and you can check that yourself.
        </p>
      </section>

      <section className="landing-section">
        <h2 className="landing-h2">What this isn&rsquo;t</h2>
        <div className="landing-grid">
          <div className="landing-card">
            <h3>Not a prediction market</h3>
            <p>
              No order book, no strangers taking the other side, no odds. You bet with people
              you already know, in groups you make.
            </p>
          </div>
          <div className="landing-card">
            <h3>Not a crypto product</h3>
            <p>
              Base is doing the escrow underneath, and you will never once have to think
              about it. No wallet to set up, no seed phrase, no gas to buy.
            </p>
          </div>
          <div className="landing-card">
            <h3>Not trying to max you out</h3>
            <p>
              Capped at $100 a person per bet and $500 a pot, on purpose. This is for arguing
              with your friends about football, not for getting anyone in trouble.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-section landing-founding">
        <h2 className="landing-h2">The first hundred get a head start</h2>
        <p className="landing-body">
          We&rsquo;re running on play money while this is invite-only, and the earliest
          people in get more of it. The <b>first 10</b> to join get ten times the
          founding stake of the <b>next 90</b>. After that it&rsquo;s the ordinary daily top-up.
        </p>
        <p className="landing-body">
          It&rsquo;s counted on-chain, so your number is whatever it says it is &mdash; you&rsquo;ll
          see it before you claim.
        </p>
        <FoundingSlots />
      </section>

      <section className="landing-section landing-close">
        <h2 className="landing-h2">Settle it.</h2>
        <p className="landing-body">
          Free to start a challenge. We take 1% when a bet settles, and nothing at all if it
          doesn&rsquo;t.
        </p>
        <Link href="/signin">
          <button>Start a challenge</button>
        </Link>
      </section>

      <footer className="landing-footer">
        <Logo size={18} />
        <span className="landing-note">Currently running on play money with invited groups.</span>
        {/* The address, not a badge. Anyone can read what is holding the money,
            which is the only version of "trust us" worth printing. */}
        {hasWagerBook && (
          <a
            className="landing-note landing-contract"
            href={`https://basescan.org/address/${wagerBookAddress}`}
            target="_blank"
            rel="noreferrer"
          >
            Escrow on Base · {wagerBookAddress.slice(0, 6)}…{wagerBookAddress.slice(-4)}
          </a>
        )}
      </footer>
    </div>
  );
}
