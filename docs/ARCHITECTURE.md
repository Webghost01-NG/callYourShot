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

Issue #6 extends this boundary with database-free profile reconciliation. The
adapter pages indexed account fills, filters binary markets to the configured
operator and venue, and requires on-chain market state plus the permanent
settlement record before a result can score. The pure profile reducer applies
`CYS-EDGE-v1`, streak,
accuracy, fee-aware return, and drawdown rules. See
[PROFILE_RECONCILIATION.md](PROFILE_RECONCILIATION.md).

Issue #7 adds Supabase outside the scoring boundary. It stores public league
enrollment, optional names, and noncustodial challenge coordination. Scores and
challenge results are never authoritative database fields; the browser rebuilds
them from DreamDEX after a server-timestamped enrollment boundary. See
[SOCIAL_COMPETITION.md](SOCIAL_COMPETITION.md).

Issue #22 broadens discovery without broadening trust. The adapter performs a
bounded, paginated live-binary sweep for the configured operator and venue,
verifies every candidate against its market contract with expiry headroom, and
limits concurrent contract and book reads. The UI receives only verified
markets, preserves selection by `marketId`, and refreshes that exact ID before
building an order. It never silently switches a reviewed call to another event.

The core does not select or depend on:

- a frontend or backend framework;
- a wallet connection library;
- a database or physical schema for trading or scoring truth;
- custody, relaying, session keys, or smart contracts.

## Trust boundaries

- The indexer discovers candidates; the market contract gates writes.
- A configured operator ID plus venue ID identifies the intended market origin.
- Pool addresses are runtime bindings and never durable market identities.
- Transaction inclusion is not a fill; decoded fill events are mandatory.
- The permanent settlement record and outcome balances determine claimability.
- Indexed fills discover profile candidates; on-chain finalization and the
  permanent settlement record determine scored outcomes.
- Wallets sign outside the core. No private key crosses this boundary.
- Supabase Web3 Auth proves social-write ownership; database RPCs derive the
  address from the server-side identity rather than browser input.
- Supabase social rows are public coordination data. DreamDEX evidence remains
  authoritative for every displayed score and result.

## Verification

`npm test` covers pure rules without network access. Test values are explicit
unit fixtures and are never presented as current market data.

`npm run check:live` is an opt-in read-only Shannon check. It requires
`DREAMDEX_OPERATOR_ID` and `DREAMDEX_VENUE_ID`, then discovers the bounded live
binary-market set, checks on-chain status/headroom, reads pool parameters, and
reads each four-sided book. Optional validation asset/cadence variables can
narrow the check. Missing or failed upstream data produces an error, never a
fabricated empty success.
