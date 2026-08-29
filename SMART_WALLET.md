# Wallets

Users never see a seed phrase, and the platform never holds a key it could spend
from. Both of those are true at once because wallets are **ERC-4337 smart
accounts owned by a passkey**.

## How it works

On first use the browser creates a passkey — Face ID, Touch ID, or a security
key. That passkey is the owner of a smart contract account on Base. The private
key lives in the device keychain (and syncs through iCloud Keychain or Google
Password Manager); it never touches our servers.

Transactions go out as EIP-5792 batches through the Coinbase Smart Wallet
connector. A paymaster sponsors gas, so users never hold the native token. A
batch also means several actions can settle behind a single Face ID prompt.

`api/src/routes/wagers.ts` returns *call descriptors* — `to`, `data`, `value` —
rather than sending anything. The client signs and submits; the API then
re-reads the chain. The server has no signing key for any user.

## Why not a custodial key

The first cut of this stored an encrypted private key per user, on the theory
that the platform had to sign because `attest()` and `concede()` check
`msg.sender`. That was true but the wrong conclusion: a smart account is just
another `msg.sender`, so the contracts never needed to change.

That design would have meant:

- losing one encryption key locks every user out of their funds, permanently;
- anyone with the database *and* that key can move user money;
- custody of a signing key, which is a live legal question (execution plan §19).

The migration argument also ran backwards. Identity is keyed on phone number, so
swapping *identity* providers is cheap — but swapping *wallets* means moving
every user's funds or making them re-onboard. With zero users, removing custody
cost an afternoon. With five hundred it would have been a project.

## What the chain decides

Because the server cannot sign, it also cannot be trusted about who did what.
`syncFromChain` reads `getParticipants()` and each participant's side,
resolution and credits directly from the escrow and reconciles the database
against it. A client claiming "I joined" proves nothing; the escrow holding
their stake does.

Users are matched to on-chain activity through `User.walletAddress`, recorded
when they connect. It is an identifier, not a credential.

## Recovery

A passkey that syncs through the platform keychain survives a lost device. One
that does not is gone, and so is the account.

Coinbase Smart Wallet accounts support multiple owners, which is the path to
real recovery: add a second passkey on another device, or a trusted friend's
account as a co-owner. Worth doing before real money — it is a contract-level
feature, so it needs no changes here.

## Configuration

| Variable                     | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_CHAIN_ID`       | 84532 for Base Sepolia, 8453 for Base mainnet.        |
| `NEXT_PUBLIC_PAYMASTER_URL`  | Sponsors gas. Without it users pay their own.         |
| `NEXT_PUBLIC_FACTORY_ADDRESS`| The deployed `WagerFactory`.                          |

The relayer key (`DEPLOYER_PRIVATE_KEY`) still exists, but only to deploy the
platform's own contracts. It never signs for a user.
