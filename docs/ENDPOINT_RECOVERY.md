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
3. the absolute difference between the HTTP head and the indexer's processed
   block to be no more than 3,000 blocks;
4. indexed candidates to pass the existing on-chain identity, status, expiry,
   pool, collateral, decimals, and outcome-token checks through that route's
   WebSocket client;
5. at least one verified market to have a readable real order book.

At Shannon's SDK-declared approximate 100 ms block time, the 3,000-block bound
is approximately five minutes. It is a safety ceiling, not a freshness claim;
the UI reports the observed block skew.

Each bundle receives an eight-second deadline. If a read attempt fails or times
out, the runtime tries the other complete bundle once. The total remains inside
the UI's separate 20-second discovery deadline. It does not mix the failed
bundle's indexer result, contract result, or book with the replacement. If both
fail, the last bounded error is shown and no market is fabricated.

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
