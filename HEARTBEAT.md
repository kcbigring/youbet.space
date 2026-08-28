# Heartbeat

Time: 2026-08-23T16:30:00Z

Last commit: (local changes present)

Files changed: contracts/contracts/Wager.sol, contracts/contracts/WagerFactory.sol, api/src/index.ts, api/src/twilio.ts, web/pages/index.tsx, api/prisma/schema.prisma, .github/workflows/heartbeat.yml

Current status: Blocked locally — `npm install` for `contracts/` fails with 403 on `@nomicfoundation/hardhat-toolbox`. Recent implemented work: owner/house split and bond redistribution in `Wager.sol`; `createWager(..., ownerSplitBps)` in `WagerFactory.sol`; `/invite` and `/verify` endpoints and Twilio helper; Invite UI added; Base configured as primary deployment target.

Next steps:
- Push branch to GitHub so the scheduled heartbeat workflow can start updating this file every 5 minutes.
- Fix npm registry / CI to allow `npm install` in `contracts/` (CI run recommended).
- Re-run `npx hardhat test` in CI and address any contract-level issues.
