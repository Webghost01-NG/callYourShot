# Core architecture

The product owner approved this boundary for GitHub Issue #4 on 2026-09-03.

## Shape

`src/core` contains deterministic, framework-independent rules:

- exact bigint quantization and cost calculations;
- live-market and expiry-headroom guards;
- mined transaction versus actual fill verification;
- finalized settlement validation and claimable-position calculation.

`src/dreamdex` adapts the official DreamDEX SDK to those rules. It requires a
trusted operator/venue origin from caller configuration and keys markets by
`marketId`. It rechecks on-chain status before preparing a write and accepts a
wallet-bound SDK writer only through dependency injection.

The core does not select or depend on:

- a frontend or backend framework;
- a wallet connection library;
- a database or physical schema;
- custody, relaying, session keys, or smart contracts.

## Trust boundaries

- The indexer discovers candidates; the market contract gates writes.
- A configured operator ID plus venue ID identifies the intended market origin.
- Pool addresses are runtime bindings and never durable market identities.
- Transaction inclusion is not a fill; decoded fill events are mandatory.
- The permanent settlement record and outcome balances determine claimability.
- Wallets sign outside the core. No private key crosses this boundary.

## Verification

`npm test` covers pure rules without network access. Test values are explicit
unit fixtures and are never presented as current market data.

`npm run check:live` is an opt-in read-only Shannon check. It requires
`DREAMDEX_OPERATOR_ID` and `DREAMDEX_VENUE_ID`, then discovers a live market,
checks on-chain status/headroom, reads pool parameters, and reads the four-sided
book. Missing or failed upstream data produces an error, never a fabricated
empty success.
