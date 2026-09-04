# Multi-market live validation

Status date: 2026-09-04

This record covers the read-only Issue #22 discovery path. It does not claim a
wallet transaction, fill, or settlement.

## Result

`npm run check:live` was executed without an asset or cadence filter using the
configured public DreamDEX operator and venue. After one transient indexer
connection timeout, the bounded retry succeeded and returned four live binary
Event Contracts:

| Asset | Cadence | On-chain status | YES book | NO book |
|---|---:|---:|---:|---:|
| BTC | 4 hours | Trading | bids and asks | bids and asks |
| ETH | 4 hours | Trading | bids and asks | bids and asks |
| ETH | 1 day | Trading | bids and asks | bids and asks |
| BTC | 1 day | Trading | bids and asks | bids and asks |

For every candidate, the indexed pool, market contract, collateral, YES/NO
token IDs, and collateral decimals agreed with the market module and contract
reads. The configured operator and venue matched, no candidate or book read was
rejected, and the bounded result was not truncated.

## Product finding

The former BTC/900-second filter would not have discovered any of the four
available markets. Multi-market discovery therefore fixes a real availability
failure rather than merely adding a selector. The application still fails
closed when the indexer, chain evidence, or all order books are unavailable; it
does not generate fallback markets or prices.

## Remaining owner-operated checks

- Select more than one market in the deployed preview at desktop and mobile
  widths.
- Review a small call and confirm that the wallet request names the selected
  market's real pool and collateral.
- Complete one actual fill from the React application and rebuild it in the
  public profile.
