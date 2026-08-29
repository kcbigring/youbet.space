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

## Why one contract holds every wager

`WagerBook` stores every wager in a single contract, keyed by id, rather than
deploying a `Wager` contract per wager. That was a deliberate reversal — the
earlier design is in git history — and it was driven by gas sponsorship, not gas.

**Sponsorship.** Paymasters pay for user transactions by allowlisting contract
addresses, because sponsoring arbitrary calls means anyone can drain the budget.
A per-wager contract gets a fresh address every time, so `join` could never be
allowlisted in advance. That put the unsponsored call on the one person who
needs sponsorship most: the friend who just tapped an invite link, has no wallet
and no ETH. Creating a wager — done by the already-committed user — was the only
thing that would have worked. One fixed address makes every call sponsorable.

**Gas**, measured on the real contracts:

| | per-contract | WagerBook | |
| --- | --- | --- | --- |
| create a wager | 2,009,893 gas | 164,190 gas | **12× cheaper** |

`Wager`'s bytecode was 9,074 bytes, and at 200 gas per byte, 1.8M of those 2M
gas was re-storing an identical copy of the same code for every wager.

**A smaller win:** `credits` are global rather than per-wager, so one
`withdraw()` collects winnings, refunds and bonds across every wager a user has
— one passkey prompt instead of one per wager.

### What this gives up

Isolation. Each `Wager` previously held only its own stakes, so an accounting
bug was bounded to that wager. Now every wager's funds sit in one contract and a
storage bug could reach all of them.

That risk is narrower than it sounds — the logic was identical across every
deployed copy, so a payout bug was always in all of them. What is genuinely lost
is protection against *cross-wager* corruption, which is a specific and testable
class. `test/wagerbook.test.js` covers it directly: settling one wager must not
touch another's state, participants or credits.

The pull-payment accounting carried over unchanged, which is the part that most
needs to be right.

### Cost of the change

Deployment is ~4.8M gas for all four contracts, against 5.2M before. `WagerBook`
compiles to 13,923 bytes, comfortably under the 24,576-byte contract limit, with
room for the resolution logic to grow.

The contracts compile with `viaIR: true`: holding every wager's state means
several functions carry more locals than the legacy pipeline can keep on the
stack.
