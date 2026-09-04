# DreamDEX SDK and documentation feedback

This report is based on building and testing Call Your Shot against DreamDEX
Event Contracts on Somnia Shannon with `@somnia-chain/markets-sdk@0.29.0`.
It distinguishes observed behavior from product suggestions. Transaction hashes
and the longer reproduction record are in [DREAMDEX_VALIDATION.md](DREAMDEX_VALIDATION.md).

## What worked well

- The SDK exposed binary-market discovery, on-chain market reads, order-book
  reads, wallet-bound trading, and testnet faucet access through one package.
- `marketId`, outcome-token IDs, origin fields, pool addresses, oracle question
  IDs, and trading windows were sufficient to cross-check indexed rows against
  chain state.
- Pool parameters made it possible to quantize price and quantity using exact
  bigint arithmetic instead of assuming decimals or increments.
- The writer path supported a user-controlled browser wallet. Call Your Shot
  never needed a private key or custodial signer.
- Final market state and the permanent settlement record provided enough data
  to reconstruct results and redeem a winning position after a market pool had
  been recycled.

## Friction encountered

### Active discovery is not a safe write gate

An indexed market can change state before a transaction is prepared. We had to
read `getMarketOnchain(marketId)` immediately before approval and again before
order submission, then reject anything outside `Trading` or too close to
expiry. Making this pattern prominent in the first trading example would help
prevent stale-market approvals and reverted orders.

### Binary prices use one YES frame

The binary pool accepts protocol prices in the YES frame even for a NO order.
The user-facing NO price is the complement. A complete SDK recipe showing all
four binary actions and both their protocol and displayed prices would prevent
incorrect `BUY_NO` limits.

### Transaction inclusion is not execution

A successful order receipt does not prove that an IOC received a fill. We had
to decode the pool's `OrderFilled` logs, attribute the taker order, aggregate
partial fills, and treat an unfilled receipt as a separate result. A structured
fill summary or official receipt-decoding helper would make safe consumer UX
much easier.

### Finalized history needs a clearer path

The active exchange view is useful for trading, but profile and redemption
flows also need finalized binary markets and the permanent settlement record.
A dedicated end-to-end recipe—discover finalized market, derive settlement
key, inspect payout vector, inspect outcome balance, redeem—would reduce the
amount of contract-level investigation required.

### Exact-unit helpers would reduce integration mistakes

Applications must respect collateral decimals, tick size, lot size, minimum
quantity, and worst-case collateral rounding. Exported, documented helpers for
price ticks, quantity lots, complementary binary prices, and maximum spend
would remove repeated arithmetic from each integrator.

### Origin filtering should be emphasized

Shannon contained binary markets from multiple operator and venue origins.
Selecting the newest BTC market alone could choose an unintended test series.
Discovery examples should require an explicit trusted origin and explain that
pool addresses are recycled while `marketId` is the durable identity.

## Suggested documentation recipe

The most useful addition would be one browser-wallet example that performs the
complete safe lifecycle:

1. discover a binary market for a configured operator and venue;
2. verify its origin and current on-chain `Trading` state;
3. read pool parameters and complete book depth;
4. quantize a bounded UP or DOWN IOC order;
5. approve only the required collateral;
6. submit and decode actual fills separately from receipt success;
7. rediscover the same `marketId` after finalization;
8. verify the permanent settlement and oracle evidence;
9. redeem only the payable outcome balance.

## Overall assessment

The SDK was capable of supporting a real, noncustodial Event Contract product.
The largest integration cost was not missing protocol capability; it was
assembling the safety-critical lifecycle across indexed discovery, immediate
on-chain checks, exact order arithmetic, receipt interpretation, and permanent
settlement. A canonical lifecycle recipe and small exact-unit/fill helpers would
substantially shorten that path for future builders.
