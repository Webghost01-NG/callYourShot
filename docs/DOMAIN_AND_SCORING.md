# Domain model and skill score proposal

Status: approved by the product owner under GitHub Issue #3 on 2026-09-03.

## Thirty-second explanation

Your first real UP or DOWN trade locks your call for that round. A correct call
earns more when the market thought it was unlikely; a wrong call loses more when
the market thought it was likely. We average those results, and betting more
money never improves your score. Profiles remain provisional until ten settled
rounds.

## Scoring policy

For each eligible prediction:

- `confidence` is the filled price of the selected outcome, from `0` to `1`;
- `result` is `1` when the selected outcome wins and `0` when it loses;
- `roundPoints = 100 × (result − confidence)`;
- `skillScore = 50 + average(roundPoints) ÷ 2`.

The skill score is bounded from `0` to `100`. A score of `50` represents zero
average edge over the entry prices. Stake and wallet balance do not enter the
formula.

Examples:

| Filled call | Final result | Round points |
|---|---:|---:|
| UP at `0.40` | UP wins | `+60` |
| UP at `0.80` | DOWN wins | `-80` |
| DOWN at `0.30` | DOWN wins | `+70` |

For a transaction filled at multiple prices, `confidence` is the exact
quantity-weighted average price. Integer collateral and outcome units remain
exact until the final display calculation.

### Exact calculation

Implementations must not use binary floating point for scoring. For fills
`(priceRaw, quantityRaw)` at collateral scale `S`:

- `filledQuantity = Σ quantityRaw`;
- `weightedPrice = Σ (priceRaw × quantityRaw)`;
- `roundPoints = 100 × ((result × S × filledQuantity) − weightedPrice)
  ÷ (S × filledQuantity)`.

Career score is calculated as one exact rational across the eligible round
points. Rank comparisons use the exact value, not the displayed value. The UI
rounds only for display to two decimal places using half-up rounding.

Deterministic test vectors:

| Inputs | Expected result |
|---|---:|
| One fill at `0.40`, correct | round `+60`; one-round score `80.00` |
| One fill at `0.80`, wrong | round `-80`; one-round score `10.00` |
| `1` contract at `0.40` and `3` at `0.60`, correct | VWAP `0.55`; round `+45`; score `72.50` |
| Two rounds worth `+60` and `-80` | average `-10`; score `45.00` |
| Finalized void | no round points; sample count unchanged |

## Ranking policy

- `0–9` settled predictions: show the score with a **Provisional** label and do
  not include it in the main leaderboard.
- `10+` settled predictions: eligible for the main leaderboard.
- Rank by skill score descending, then settled-round count descending, then the
  deterministic normalized wallet address ascending.
- Voided, unfilled, rejected, and reverted predictions do not enter either the
  numerator or sample count.
- The MVP score is lifetime for its supported competition season. A future
  season must be a new explicit scoring scope, never a silent reset.

## Core identities

| Concept | Durable identity | Role |
|---|---|---|
| Player | chain ID + normalized wallet | Owns predictions and score |
| Market | chain ID + DreamDEX `marketId` | One immutable prediction round |
| Fill | chain ID + transaction hash + log index | Deduplicated execution evidence |
| Prediction | player + market | The player's one scored call for a round |
| Settlement | market + finalized settlement key | Outcome and payout evidence |
| Challenge | generated challenge ID | Social grouping, never custody |
| Score snapshot | player + season + source block | Reproducible derived ranking |

A pool address is not a market identity because DreamDEX recycles pools across
rolling windows.

## Prediction lifecycle

```text
Prepared → Submitted → Filled → Locked → Finalized → Scored
              └──────────────→ Rejected
                         └────→ Unfilled
                                  Finalized → Void
```

- **Prepared**: local review only; no on-chain claim is made.
- **Submitted**: a transaction hash exists, but no fill is claimed.
- **Filled**: at least one qualifying fill is verified from its receipt/log.
- **Locked**: the market no longer accepts trades; the call cannot change.
- **Finalized**: settlement is verified against the market and settlement
  singleton.
- **Scored**: the deterministic formula has been applied once to the finalized
  evidence.
- **Rejected/Unfilled**: no score impact and never displayed as a prediction.
- **Void**: retained in history with no score or sample-count impact.

## Eligibility and edge cases

### First fill locks the call

The first qualifying directional buy fill for a player and market locks YES or
NO as that prediction's side. Later fills cannot reverse, erase, or exclude the
call. This prevents a player from buying the opposite side late merely to hide
a likely loss.

### Partial and multiple fills

All fills belonging to the initial submitted order are aggregated. A partial
IOC fill is valid and its unfilled remainder contributes nothing. Duplicate
indexer delivery is ignored using transaction hash plus log index.

### Exits and hedges

Selling the position or acquiring the opposite side does not rewrite the
locked prediction. Trading activity and prediction identity are separate: the
score measures the original call, not later portfolio management.

### Timing

A fill qualifies only when the deployed market accepted it in Trading status
before its expiry. A transaction submission without a mined qualifying fill is
not a prediction. Indexed timestamps may aid display but do not override chain
state and receipt evidence.

### Settlement

Only finalized Resolved markets score. A Void remains visible but neutral.
Settlement is keyed by `marketId`/outcome identity, never the currently bound
pool.

## Anti-gaming model

| Attack | Policy response | Residual risk |
|---|---|---|
| Bet more to dominate rank | Quantity is excluded from score | None in scoring |
| Split one order into many fills | One player-market prediction; fills aggregate | None if deduplication is correct |
| Submit many transactions in one round | First qualifying fill locks one call | Extra trading remains possible but cannot add samples |
| Hedge to erase a bad call | Opposite-side activity does not cancel the call | Economic hedge is allowed, score remains exposed |
| Count a reverted/unfilled order | Receipt and fill log are mandatory | Indexer lag delays display |
| Replay the same fill | Transaction hash + log index is unique | Chain reorg requires reconciliation |
| Cherry-pick only historical winners | Leaderboard enrollment defines a start block and all subsequent supported fills are reconciled | A player can use fresh wallets |
| Sybil wallets | Show wallet identity and sample size; do not claim personhood | Strong identity is deferred beyond MVP |
| Exploit voids | Voids are neutral and do not count as attempts | Repeated oracle failure can reduce usable sample size |

## Persistence boundary proposal

The chain remains authoritative for markets, fills, ownership, and settlement.
Application storage may hold:

- leaderboard enrollment and its immutable start block;
- challenges and participant relationships;
- cached evidence references and derived score snapshots;
- display preferences added under a later identity policy.

Every score must be rebuildable from chain evidence. Stored derived values must
include their source block and formula version. Application storage must never
turn a submitted transaction into a fill, overwrite a settlement outcome, or
silently discard an eligible loss.

The approved persistence boundary does not select a storage technology or
physical schema. Those remain unselected until explicitly approved. This
document defines domain invariants, not an architecture choice.

## Formula version

The proposal is `CYS-EDGE-v1`. Once a season starts, its formula is immutable.
Any future formula creates a new version and recomputes or separates rankings
explicitly rather than altering historical scores in place.
