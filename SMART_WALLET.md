Embedded smart wallet / relayer — design notes

Goal: allow users to create and participate in wagers without managing keys.

Approach (MVP):
- Use session-based ephemeral wallets (randomly generated keypairs) stored encrypted in the server per session and recovered with OTP verification.
- Relayer holds gas funds and submits transactions on behalf of ephemeral wallets, with nonce/accountability.
- For security, limit wallet balance, apply rate limits, and require bonded attestations for higher-value operations.

Next steps:
- Prototype a server-side relayer that accepts signed intents from ephemeral wallets and forwards txs to the network.
- Consider social recovery via attesters or account abstraction (ERC-4337) for later.
