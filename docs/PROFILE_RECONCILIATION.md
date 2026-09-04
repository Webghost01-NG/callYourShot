# Verified profile reconciliation

Status: approved by the product owner for GitHub Issue #6 on 2026-09-04.

## Database-free boundary

Issue #6 stores no profile database and introduces no persistence schema. A
connected wallet's profile is rebuilt from DreamDEX on each load:

1. page the wallet's complete indexed fill history at a fixed time boundary;
2. keep only binary BTC 15-minute markets from the configured operator and
   venue;
3. attribute each fill to the wallet as maker or taker;
4. retain directional buys and lock the earliest order for each `marketId`;
5. aggregate partial fills from that same order;
6. verify market state against the chain and, once finalized, require the
   permanent DreamDEX settlement record;
7. calculate the formula-versioned profile from those immutable inputs.

Indexer data discovers and labels evidence. It cannot finalize a market or
select a winner. The on-chain market plus permanent settlement record are the
authority for those facts. Any later cache or database remains disposable and
must reproduce this result.

## Metrics

- **Accuracy:** wins divided by settled, non-void calls.
- **Current streak:** consecutive settled wins at the end of the record.
- **Best streak:** the largest run of consecutive settled wins.
- **Actual return:** the permanent settlement payout minus the entry cost of
  the locked order. It uses DreamDEX's fee-scaled payout vector and exact raw
  units; it is displayed separately from skill.
- **Maximum drawdown:** the largest peak-to-trough decline in chronological
  cumulative actual return.
- **Skill score:** `CYS-EDGE-v1`; stake-neutral and equally weighted by round.
- **Profile state:** provisional below ten settled, non-void calls and verified
  at ten or more. A profile with no settled calls is empty.

Voids remain visible but do not affect any statistic or break a streak.
Pending calls remain visible but unscored. Sells, hedges, later orders,
duplicates, unfilled orders, and unsupported markets do not alter the locked
call.

## Evidence and failure behavior

Every displayed call links its indexed fill transaction. A finalized result
also links the indexed `Finalized` status transaction and oracle-answer
transaction when the indexer exposes them.

Missing transaction-link metadata does not overrule a chain-verified permanent
settlement; the interface explicitly labels that link unavailable. By contrast,
missing or contradictory fill attribution, market state, or settlement truth
excludes the affected market and marks the profile incomplete. A paging safety
limit fails the whole rebuild instead of silently publishing partial history.

No profile values in tests are presented as live data. Test fixtures exist only
to prove deterministic calculation and failure behavior.
