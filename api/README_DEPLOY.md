# Deploy notes

Steps to use the `/deploy` endpoint locally:

1. Compile contracts in `contracts/`:

```bash
cd contracts
npm install
npx hardhat compile
```

2. Set environment variables (local `.env`). Prefer `BASE_RPC` for primary deployment; `ROBINHOOD_RPC` is supported as a secondary option:

```
BASE_RPC=https://rpc.base-testnet.example
ROBINHOOD_RPC=https://rpc.robinhood-chain.testnet
DEPLOYER_PRIVATE_KEY=0x...
TREASURY_ADDRESS=0x...
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
```

3. Generate Prisma client and run API:

```bash
cd api
npm install
npx prisma generate
npm run dev
```

4. Call the deploy endpoint:

```bash
curl -X POST http://localhost:4000/deploy -H 'Content-Type: application/json' -d '{"stake":"0.01","bond":"0.001"}'
```
