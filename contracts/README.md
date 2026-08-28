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
