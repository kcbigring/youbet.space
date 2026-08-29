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
bug in one wager cannot touch another's escrow — but it costs more than it
first appears, and both costs land at the same time.

**Gas.** `createWager` runs about **2,000,000 gas**, because it deploys a full
contract rather than writing a row. A mapping-based design would be closer to
150–200k. On Base that is fractions of a cent today; it is not free at scale,
and it is the single most expensive thing a user does.

**Gas sponsorship.** This is the sharper problem. Paymasters sponsor calls to
*allowlisted contract addresses*. The factory has one fixed address and
allowlists fine, but every wager gets a brand-new address, so `join`, `attest`,
`concede` and `withdraw` can never be allowlisted in advance. Sponsorship covers
wager creation and then silently stops — which is the opposite of what you want,
since creating is the cheap part and joining is where users show up.

You can bolt on a workaround: watch `WagerCreated` and push each new address
into the paymaster policy through the CDP API. It races the user's next
transaction and it means the paymaster policy grows without bound.

**The alternative** is a single `WagerBook` contract holding wagers by id:
`join(wagerId, side)` instead of `wager.join(side)`. One fixed address to
allowlist, an order of magnitude less gas per wager, and one place to read
state from.

What it gives up is isolation: a storage bug drains everything instead of one
wager. That is a real tradeoff and it deserves a decision rather than a default.
The pull-payment accounting already in `Wager` transfers over unchanged, which
is the part that most needs to be right.

This has not been changed — the current design is per-wager contracts. Decide
before mainnet, because migrating live wagers is much harder than choosing now.
