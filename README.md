# youbet.space — Friendly Wager MVP

Scaffold for the Friendly Wager MVP. Subprojects:
- `contracts/` — Solidity contracts and Hardhat tests
- `web/` — Next.js frontend (PWA)
- `api/` — Node backend + Postgres

Follow the `contracts/README.md` to run local contract tests.

## Quick Start (local)

Run the three subprojects locally for a full development loop:

```bash
# Contracts
cd contracts
npm ci
npx hardhat compile
npx hardhat test

# API
cd ../api
npm ci
npx prisma generate
npm run dev

# Web (in another terminal)
cd ../web
npm ci
npm run dev
```

## Deploying and Vercel

We recommend linking the `web` folder to your Vercel project (domain `youbet.space`). Set the following environment variables in Vercel Project Settings:

- `NEXT_PUBLIC_API_URL` — production API URL (e.g. `https://api.yourdomain.com`)
- `ROBINHOOD_RPC` — Robinhood chain RPC (testnet/mainnet)
- `DEPLOYER_PRIVATE_KEY` — deployer private key (secret)
- `API_KEY` — API key for protected API endpoints (secret)
- `DATABASE_URL` — production database connection string (secret)

Vercel CLI quick link and deploy (from `web`):

```bash
npm i -g vercel
vercel login
cd web
vercel link
vercel env add NEXT_PUBLIC_API_URL production
vercel env add ROBINHOOD_RPC production
vercel env add DEPLOYER_PRIVATE_KEY production
vercel --prod
```

See `api/README.md`, `api/README_DEPLOY.md`, and `contracts/README.md` for more detailed instructions.

