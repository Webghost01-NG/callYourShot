# Verified endpoint recovery

Issue #46 uses only endpoints present in the installed official Somnia Markets
SDK `0.29.0` Shannon chain definition and testnet setup:

| Route | HTTP RPC | WebSocket RPC | DreamDEX indexer |
|---|---|---|---|
| Somnia infrastructure | `https://api.infra.testnet.somnia.network` | `wss://api.infra.testnet.somnia.network/ws` | `https://dev.smk.somnia.host/v1/graphql` |
| Dream RPC | `https://dream-rpc.somnia.network/` | `wss://dream-rpc.somnia.network/ws` | `https://dev.smk.somnia.host/v1/graphql` |

The two RPC names are alternate public Shannon routes. The SDK documents only
one DreamDEX testnet indexer, so this design does not claim indexer redundancy.

## Health and selection

Before a route can return a live board, the runtime requires:

1. the HTTP RPC to report Shannon chain ID `50312`;
2. the DreamDEX indexer to return Shannon sync metadata;
3. an indexer more than 3,000 blocks ahead of the HTTP head to be rejected as an
   incoherent route; a lagging indexer remains a bounded discovery source and
   its measured lag is shown explicitly;
4. indexed candidates to pass the existing on-chain identity, status, expiry,
   pool, collateral, decimals, and outcome-token checks through that route's
   WebSocket client;
5. at least one verified market to have a readable real order book.

At Shannon's SDK-declared approximate 100 ms block time, the 3,000-block
ahead-of-RPC bound is approximately five minutes. A behind-RPC indexer cannot
authorize a market: each returned candidate must still pass current on-chain
identity, status, expiry, pool, token, constraint, and readable-book checks.
Old candidates are rejected by those checks, and a stale indexer that has not
seen any current candidate reaches the honest no-live-market state. This keeps
indexer lag an availability signal instead of turning it into authority over
current chain state.

Each bundle receives a 35-second deadline. This covers the observed cold-path
latency of a fully verified Shannon snapshot while keeping a stalled route
bounded. If a read attempt fails or times out, the runtime tries the other
complete bundle once. The UI deadline is derived from the number of configured
bundles: one complete per-route budget for each bundle plus five seconds of UI
scheduling grace. It does not mix the failed bundle's indexer result, contract
result, or book with the replacement. A late result from a retired attempt is
ignored. If both fail, the last route-specific bounded error is shown and no
market is fabricated.

## Write boundary

Endpoint failover is a read-recovery feature. Once the application prepares a
call, the selected runtime route stays fixed. Automatic market refresh is
already blocked during review, approval, submission, and fill verification.
The application never automatically retries a wallet transaction because a
submitted transaction may have reached the chain even when its response was
lost.

## Configuration

No secret is used. The optional public HTTP and WebSocket variables may only
select one of the two verified bundles and must identify the same bundle. An
unknown or mismatched override fails application configuration. The optional
indexer variable must equal the one official Shannon DreamDEX indexer.

The visible diagnostic contains only the route label, observed block skew, and
whether a prior route failed. It does not expose wallet data, credentials, or a
claim that the application or providers are audited.
