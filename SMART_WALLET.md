# Embedded wallets

Users should never see a seed phrase (§13 of the plan). What ships today, and
what it costs.

## What is implemented

Every user gets an EVM keypair on first use. The private key is encrypted with
AES-256-GCM under `WALLET_ENCRYPTION_KEY` and stored in the `EmbeddedWallet`
table. It is decrypted in memory only to sign a transaction and is never
returned to a client. `api/src/lib/wallet.ts` is the only module that touches it.

Gas is sponsored: before a user transaction, the relayer tops that wallet up by
exactly the shortfall, capped by `MAX_GAS_TOPUP_ETH`. Users hold no native token
and never fund gas themselves.

## Why the platform signs at all

On-chain attestation must come from the participant's own address — `attest()`
and `concede()` check `msg.sender`. A relayer calling on someone's behalf would
revert. So either the user holds a key, or the platform holds one for them. The
plan says no seed phrases, so the platform holds it.

## What that means

**This is custody of a signing key.** It is the single most sensitive thing in
the system and it needs to be named plainly for the legal workstream in §19:

- `WALLET_ENCRYPTION_KEY` belongs in a KMS or secret manager, never in the repo
  or an env file on disk. Losing it locks every user out of their funds.
- Whoever can read the database *and* the key can move user funds. Those two
  should not share a blast radius.
- Stakes do not sit in these wallets. They go straight into the wager escrow and
  pay out to participants. The exposure is the balance between a top-up and a
  transaction, which is gas-sized.

## Where this should go

ERC-4337 account abstraction with a passkey signer removes the custody question
entirely: the user's device holds the key, a paymaster covers gas, and the
platform keeps the same "no seed phrase" experience without holding anything.
Base has good 4337 infrastructure. That is the right target before real money,
and the contracts need no changes for it — a smart account is just another
`msg.sender`.

Interim hardening, in order of value:

1. Move `WALLET_ENCRYPTION_KEY` to a KMS with per-user data keys, so a database
   dump alone is inert.
2. Cap what a single wallet can sign for in a window, independent of the
   per-wager limits.
3. Add social recovery so a user can rotate to a self-held key.
