# Deploying

**Primary network: Base.** Base Sepolia (chain 84532) for the alpha, Base
mainnet (8453) when the legal structure is settled. Everything is EVM-portable.

## 1. Contracts

```bash
cd contracts
npm ci
npm run compile
npm test

# .env at the repo root
#   DEPLOYER_PRIVATE_KEY=0x...
#   BASE_SEPOLIA_RPC=https://sepolia.base.org
#   PROTOCOL_OWNER=0x...        # optional, defaults to the deployer
#   ORACLE_RESOLVER=0x...       # optional, approved on deploy
#   DEPLOY_ETH_USD=3000         # rate used to convert the dollar limits
npm run deploy:base
```

Deploys `Treasury`, `GroupRegistry`, `ResolverRegistry` and `WagerFactory`, then
writes `deployments/base_sepolia.json` with every address and the configured
limits. `deployments/` is gitignored — it holds live addresses.

Verify on Basescan with `npx hardhat verify --network base_sepolia <address> <args>`
(set `BASESCAN_API_KEY`).

## 2. API

Copy the deployed addresses into the API environment:

```
FACTORY_ADDRESS=0x...
GROUP_REGISTRY_ADDRESS=0x...
RESOLVER_REGISTRY_ADDRESS=0x...
TREASURY_ADDRESS=0x...
CHAIN_ID=84532
```

Then:

```bash
cd api
npm ci
npx prisma migrate deploy
npm run build
npm start
```

Required secrets — see `api/.env.example` for the full list:

| Variable                | Why it matters                                              |
| ----------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`          | Postgres.                                                    |
| `DEPLOYER_PRIVATE_KEY`  | Relayer. Deploys wagers and sponsors user gas — keep it funded. |
| `WALLET_ENCRYPTION_KEY` | Encrypts user signing keys at rest. **Losing it locks every user out of their wallet.** Put it in a KMS. |
| `API_KEY`               | Guards `/admin/*`.                                           |
| `TWILIO_*`              | SMS invites. Without it, codes are only logged.               |

Generate the two keys with `openssl rand -hex 32`.

## 3. Web

Link `web/` to the Vercel project on `youbet.space` and set
`NEXT_PUBLIC_API_URL` to the API's public URL.

```bash
cd web
vercel link
vercel env add NEXT_PUBLIC_API_URL production
vercel --prod
```

## Before real money

The alpha runs on testnet with test funds. Moving to mainnet is gated on the
legal workstream in §19 of the plan, not on engineering readiness. Note in
particular that the API holds user signing keys — see [SMART_WALLET.md](SMART_WALLET.md).
