Deployment notes

Primary network: Base (EVM-compatible)
Secondary: Robinhood Chain

Requirements:
- Set env vars in CI or deployment:
  - BASE_RPC, ROBINHOOD_RPC
  - DEPLOYER_PRIVATE_KEY
  - TREASURY_ADDRESS (optional)
  - DATABASE_URL (for API persistence)

Contracts:
- Use `npx hardhat run scripts/deploy.js --network base_testnet` to deploy factory and example wagers.

CI:
- GitHub Actions run `contracts` tests and will attempt to install dependencies. If `npm ci` fails due to missing lockfile, CI falls back to `npm install --legacy-peer-deps`.

Notes:
- If a package (eg @nomicfoundation/hardhat-toolbox) is blocked by registry policies, pin to an accessible version or mirror packages in a private registry.
