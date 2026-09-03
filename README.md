# youbet.space

Private, on-chain wagers between friends. Challenge → Accept → Fund → Resolve → Settle.

Not a prediction market: no public order book, no anonymous counterparties, no
secondary trading, no leverage. A private challenge network for people who
already know each other. See `spec/friendly_wager_execution_plan.pdf`.

## Layout

| Directory    | What it is                                                            |
| ------------ | --------------------------------------------------------------------- |
| `contracts/` | Solidity escrow — `WagerBook`, `GroupRegistry`, `ResolverRegistry`, `Treasury`. Hardhat, deployed to Base. |
| `api/`       | Express + Prisma + Postgres. Identity, groups, social data, reputation, and the relayer. |
| `web/`       | Next.js mobile-first PWA.                                             |
| `spec/`      | The execution plan this is built against.                             |

The chain is the source of truth for stakes, attestations and settlement.
Postgres holds everything social and mirrors on-chain state so the app can
query and rank without RPC calls. The two are tied together by `Wager.termsHash`.

## How a wager works

1. **Create.** Natural language in ("$25 each that Texas beats Ohio State"),
   structured terms out. The user reviews and confirms before anything is sent.
2. **Fund.** Each participant escrows `stake + bond`. Once both sides are
   funded the wager locks and the terms become immutable.
3. **Resolve**, in three levels:
   - **Oracle** — an approved resolver reports objective outcomes.
   - **Concede** — if everyone on a side concedes, it settles immediately.
   - **Attestation** — participants attest; passing the threshold settles it.
4. **Settle.** Winners split the pot minus a 1% fee. Bonds return to everyone
   who met their resolution duty; forfeited bonds go to *them*, never to the
   house. If attestation deadlocks, stakes are refunded — the house never
   confiscates the pot.

## Quick start

```bash
# Contracts
cd contracts && npm ci && npm run compile && npm test

# API — needs Postgres
cd ../api && npm ci
cp .env.example .env        # fill in DATABASE_URL and the keys you have
npx prisma migrate deploy
npm run dev

# Web
cd ../web && npm ci
cp .env.example .env.local  # point NEXT_PUBLIC_API_URL at the API
npm run dev
```

The API runs without a chain or Twilio configured: wagers stay drafts and SMS
codes are printed to the console, so the whole social flow is testable locally.

## Risk controls

From §9 of the plan, enforced both on-chain and in the API:

- $100 max per person per wager, $500 max pot, $1,000 per user per month.
- Private groups only; group owners can set tighter limits than the protocol.
- No secondary trading, leverage, credit, or anonymous participants.

## Docs

- [GOING_LIVE.md](GOING_LIVE.md) — fund, deploy, and turn it on. Start here.
- [PAYMASTER.md](PAYMASTER.md) — gas sponsorship: what must be true, what it costs.
- [DEPLOY.md](DEPLOY.md) — deploying contracts and services to Base.
- [SMART_WALLET.md](SMART_WALLET.md) — embedded wallets and the custody question.
- [MONITORING.md](MONITORING.md) — health, readiness, metrics.
- [api/README.md](api/README.md) — endpoint reference.
- [contracts/README.md](contracts/README.md) — contract reference.
