# Testing

Three layers, and they catch different things. The middle one is the one that
was missing, and its absence is why the first week of real use turned up a bug
per screen.

| Layer | Command | Catches |
| --- | --- | --- |
| Contracts | `cd contracts && npm test` | Settlement maths, thresholds, bond forfeiture |
| API units | `cd api && npm test` | Pure logic — parsing, standing, feed grouping, redaction |
| End to end | `node e2e/harness.mjs` | Everything between them |

## Why the harness exists

Nearly every bug that reached production lived in a seam:

- a client posting a payload shape the API rejected
- a chain list whose *order* decided which network reads went to
- an env var read under a different name than it was written
- a component unmounted by the very event it was supposed to report
- a read that raced transaction inclusion and found nothing

None of that is visible to a type checker, and none of it is reachable by a
unit test, because in each case both halves were correct on their own. All of
it is obvious within seconds of the thing actually running.

## What it does

```
node e2e/harness.mjs            run it
node e2e/harness.mjs --headed   watch the browser
node e2e/harness.mjs --keep     leave the stack up to poke at
```

Seven steps, each waiting on the previous to actually answer rather than
sleeping and hoping:

1. **Postgres** in Docker on 5433, `tmpfs`-backed so it starts clean and leaves
   nothing behind. Not 5432, so it cannot collide with a database anyone cares about.
2. **A Hardhat node** on 8545. viem calls this chain `foundry` and defaults it
   to the same id and port, so the browser needs no configuration to reach it.
3. **The real contracts**, deployed by the real deploy script. Addresses are
   deterministic, and the harness reads them from `deployments/localhost.json`
   rather than hardcoding them.
4. **The schema**, pushed with `prisma db push --force-reset`.
5. **The API**, from source, pointed at that chain and that database.
6. **The web app**, pointed at that API, with the test wallet enabled.
7. **Playwright**, driving two browser contexts through the whole loop.

Teardown kills everything and drops the volume unless `--keep`.

## The wallet

Coinbase's onboarding demands a verified email before it will mint a passkey.
That is where browser automation has always had to stop, and it is why
everything past sign-in went untested for so long.

wagmi's `mock` connector stands in. It is not a stub: it answers
`wallet_sendCalls` by forwarding each call to the node as `eth_sendTransaction`,
and `wallet_getCallsStatus` with the real receipts. Hardhat signs, because it
holds the keys for its own accounts. So the EIP-5792 batching, the wait for
inclusion, the receipt parsing and the reconciliation all run exactly as they do
in production — only the custody differs.

It is enabled by `NEXT_PUBLIC_E2E_ACCOUNT`, and `web/lib/wagmi.ts` **throws at
module load** if that is ever set on anything but the local node. A test wallet
that nobody owns must never appear in front of real money.

Each browser context overrides the account through `localStorage`, which is what
makes two players possible from one build — and two players is the whole point,
since a wager needs someone on the other side.

## What it covers

The happy path, and then the ways it goes wrong — which is where the money is.

**A bet between two people**

1. Each wallet is recorded against the person who connected it — asserted
   against the API, not the screen, because an address we never stored is one we
   cannot reconcile to anybody.
2. Play money arrives, with the founding bonus on top.
3. A challenge is created, and `"before 6am tomorrow"` produces a 6am deadline.
4. The creator funds their side — an approve and a join in one batch across two
   contracts, the only flow that spans both.
5. The invite link brings the second player in and the wager locks.
6. The loser concedes; the pot pays out at $20.80 and $1.00 — stakes, the 1%
   fee, and both bonds returned — and both players collect.

**When it goes wrong**

7. Both players claim they won. Neither reaches the threshold and nothing
   settles, which is the correct answer to two people lying at each other.
8. The window shuts and `expire` returns every stake. Both bonds come back,
   because both of them did turn up.
9. One player answers and the other never does. The silent one's bond goes to
   the one who turned up — $12 against $10. This is the only thing making
   anyone answer at all, and it had never once run.
10. Three people, where the threshold stops meaning "both of you". Two of three
    agree and it settles without waiting on the third: $16.35 each, being a $30
    pot less the fee, split between the winners, plus the absent player's
    forfeited bond.

Assertions are against the chain wherever the chain is the authority. The app
reloads itself when money lands, which takes any confirmation banner with it;
the token balance does not lie and does not disappear.

## Time

Deadlines are the mechanism — when voting opens, when it shuts, when a bond is
forfeit — and waiting six hours to watch one pass is not a test anyone runs. The
harness moves the chain with `evm_increaseTime` and the browser with
Playwright's `clock.setFixedTime`, which leaves real timers running so
transaction waits still work.

New wagers take their deadlines from the *chain's* clock rather than the wall
clock, because earlier scenarios have already pushed it forward and a wager
whose funding deadline is already past cannot be joined at all.
