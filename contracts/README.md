# Friendly Wager Contracts

Minimal Hardhat project containing `Wager` and `WagerFactory` Solidity contracts for the MVP. Run tests with:

```bash
cd contracts
npm install
npx hardhat test
```

This is a lightweight scaffold for local development and initial testnet deploys.

### Deploying (primary: Base testnet, secondary: Robinhood testnet)

1. Install dependencies and compile:

```bash
cd contracts
npm install
npx hardhat compile
```

2. Preferred: deploy to Base testnet (set `BASE_RPC` and `DEPLOYER_PRIVATE_KEY`):

```bash
npm run deploy:base
```

3. Optional: deploy to Robinhood testnet (set `ROBINHOOD_RPC` and `DEPLOYER_PRIVATE_KEY`):

```bash
npm run deploy:robinhood
```

