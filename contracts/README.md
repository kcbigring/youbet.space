# Contracts

Solidity escrow for youbet.space. Hardhat + ethers v6, solc 0.8.24, targeting Base.

```bash
npm ci
npm run compile
npm test          # 20 lifecycle tests
npm run deploy:base
```

## The contracts

| Contract           | Responsibility                                                     |
| ------------------ | ------------------------------------------------------------------- |
| `Wager`            | One wager: escrow, deadlines, resolution, settlement, withdrawals.  |
| `WagerFactory`     | Deploys wagers; enforces stake, pot and fee limits; indexes them.   |
| `GroupRegistry`    | On-chain membership and per-group limits for private groups.        |
| `ResolverRegistry` | Allowlist of oracle resolvers permitted to report outcomes.         |
| `Treasury`         | Collects the 1% protocol fee. Never receives stakes or bonds.       |

## Wager lifecycle

`Open → Locked → Settled | Refunded`, or `Open → Cancelled` if a second side
never shows up.

- `join(side)` escrows `stake + bond`. Locks when both sides are represented and
  the participant cap is reached.
- `concede()` — a loser pays out early. If everyone on a side concedes, it
  settles immediately and **all** bonds return: nobody disputed anything, so
  nobody owed an attestation.
- `attest(side)` after the event deadline. Settles when a side passes the
  threshold.
- `resolveByOracle(side)` — approved resolvers only, oracle wagers only. All
  bonds return; there was no attestation duty.
- `expire()` after the resolution deadline with no threshold: stakes are
  refunded and non-attesters' bonds go to those who did attest.

### Two details worth knowing

**The threshold is "strictly more than".** `attestationThresholdBps = 5000` means
*more than* half, so a simple majority of two participants is two, not one. A
single participant can never settle a wager unilaterally.

**Payouts are pull, not push.** Settlement credits balances and each participant
calls `withdraw()`. A single recipient that reverts on receive cannot block
settlement for everyone else.

## Fees and bonds

The fee is taken from the pot only on settlement, split between the treasury and
optionally the wager creator (`ownerSplitBps`). Bonds are never touched by the
fee logic and never reach the treasury — forfeited bonds are redistributed to
participants who met their resolution duty, which keeps the house economically
neutral on whether a wager becomes disputed.

## One contract per wager

Every wager is its own deployed `Wager` contract. That buys real isolation — a
bug in one wager cannot touch another's escrow — and it costs more than it
first appears. Measured, not estimated:

| | per-contract (today) | single contract | |
| --- | --- | --- | --- |
| `createWager` | 2,009,893 gas | 125,501 gas | **16× cheaper** |

`Wager`'s runtime bytecode is 9,074 bytes. At 200 gas per byte, **1,814,800 of
those 2 million gas — 90% — is paying to store another identical copy of the
same code.** Every wager redeploys the same logic.

### The gas is not the real problem

On Base the difference is pennies at normal gas prices, and only starts to
matter under load:

| gas price | per-contract | single contract |
| --- | --- | --- |
| 0.01 gwei | $0.06 | $0.004 |
| 0.5 gwei | $3.02 | $0.19 |
| 2 gwei | $12.06 | $0.75 |

Worth having, but not on its own a reason to change anything.

### Gas sponsorship is the real problem

Paymasters decide whether to pay for a UserOperation, and the standard policy
primitive — CDP's included — is an **allowlist of contract addresses**, because
sponsoring arbitrary calls means anyone can drain your gas budget.

The factory has one fixed address, so `createWager` allowlists fine. But every
wager gets a **fresh address**, so `join`, `attest`, `concede` and `withdraw`
can never be allowlisted ahead of time. Sponsorship covers creating a wager and
then stops.

That gap lands in the worst possible place. The person who needs sponsorship
most is the friend who just tapped a link, has no wallet, no ETH, and no reason
to care about any of this — and joining is exactly the call that cannot be
sponsored. Creating a wager, which the already-committed user does, is the one
thing that works.

Workarounds exist and all leak:

- Watch `WagerCreated` and push each new address into the policy via API. It
  races the user's next transaction, grows the policy without bound, and adds a
  background service whose failure silently breaks funding.
- Use a provider with programmatic or webhook-based sponsorship instead of
  address allowlists. Workable, but you are now running that decision service.

### The alternative

A single `WagerBook` contract holding wagers by id: `join(wagerId, side)`
instead of `wager.join(side)`. One address to allowlist, sponsorship works
everywhere, 16× less gas per wager, one place to read state from.

What it gives up is isolation. Today each `Wager` holds only its own stakes, so
an accounting bug is bounded by that one wager. In a shared contract every
wager's funds sit in one place and a storage bug reaches all of them. That is a
genuine trade, and the reason this has not simply been changed.

The pull-payment accounting already in `Wager` carries over unchanged, which is
the part that most needs to be right.

### When to decide

Right now there are zero wagers on-chain, so switching is a pure code change.

Later is harder but not catastrophic: deployed wagers are immutable and cannot
be migrated, so the API and web would carry both shapes until every open wager
settles. Since the resolution window is 72 hours by default, that is about a
week of dual-path code plus a freeze, not an indefinite migration.

The cost of waiting is real but bounded. The cost of launching a paymaster that
silently fails to sponsor the invite path is the one to avoid.
