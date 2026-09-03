# DreamDEX integration validation

This report records evidence gathered for GitHub Issue #2. Values under
"observed snapshot" are time-bound observations, not application constants.
The application must rediscover them at runtime.

## Validation status

| Capability | Status | Evidence |
|---|---|---|
| Shannon RPC and chain identity | Verified | RPC returned chain ID `50312` |
| Published SDK package | Verified | npm registry returned `@somnia-chain/markets-sdk@0.29.0` |
| Testnet indexer | Verified | Binary-market query returned live and finalized rows |
| Rolling venue separation | Verified | Rolling markets and price-feed test markets have distinct origins |
| Module record versus indexer | Verified | Addresses, collateral, origin, token IDs, and window matched |
| Live on-chain lifecycle | Verified | Selected market contract returned `Trading` during its window |
| Pool order parameters | Verified | Parameters read directly from the selected binary pool |
| Order-book snapshot | Verified | Both book sides returned resting levels from chain |
| Finalized outcome | Verified | Market contract returned terminal state and payout vector |
| Settlement extraction | Verified | Settlement singleton returned the matching finalized record |
| WebSocket connection | Verified | A live pool log arrived through `eth_subscribe` |
| Collateral faucet | Verified | Published SDK faucet transaction minted 10,000 tUSDC |
| Token approval and order write | Verified | Exact approval and IOC order both mined successfully |
| Fill ownership and refund destination | Verified | One YES reached the wallet; price improvement returned as wallet tUSDC |
| Redemption write | Verified | A guaranteed winning YES was burned for exactly 1 tUSDC |

## Environment evidence

Observed at `2026-09-03T17:11:32Z`, near Shannon block `478823998`:

- Network: Somnia Shannon testnet
- Chain ID: `50312`
- HTTP RPC: `https://dream-rpc.somnia.network/`
- SDK testnet indexer: `https://dev.smk.somnia.host/v1/graphql`
- SDK testnet WebSocket RPC: `wss://api.infra.testnet.somnia.network/ws`
- Native gas currency: STT, 18 decimals
- Binary collateral symbol: tUSDC, 6 decimals

The npm registry reported `0.29.0` as the current package version. The inspected
tarball was obtained using `npm pack` in a temporary directory; it was not added
to this repository or selected as a production dependency.

## Venue scoping

The testnet indexer contains multiple binary origins. Selecting the newest
binary row without origin filtering is unsafe.

The observed rolling BTC and ETH questions used:

- operator ID `2`;
- venue ID
  `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c`;
- questions of the form "BTC closes at or above its opening price".

Separate short-lived price-feed test questions used operator ID `4` and a
different venue ID. Call Your Shot must discover and validate the intended
origin instead of selecting markets by asset and recency alone. The origin
values above are evidence for this run, not values to hardcode into the app.

## Live-market cross-check

One rolling BTC market was selected from the indexer and immediately checked
against `BinaryMarketsModule.markets(marketId)` and its market contract.

The following fields agreed between indexer and chain:

- market address;
- binary pool address;
- tUSDC collateral address;
- operator and venue origin;
- YES and NO outcome IDs;
- trading start and expiry;
- oracle question ID;
- pool nonce.

The market returned on-chain status `1` (`Trading`) during the check. This is a
time-bound result: the same market subsequently locks and settles. A production
write must repeat the status read immediately before authorization.

## Pool parameters and book

The selected pool returned these raw order-book parameters:

- tick size: `1000` raw tUSDC units (`0.001` tUSDC);
- minimum quantity: `1000` raw outcome units (`0.001` contract);
- lot size: `1000` raw outcome units (`0.001` contract).

Both bid and ask calls returned resting levels. Prices were expressed in the
single YES frame and scaled by the collateral's six decimals. The parameters
must be read from each active pool because venue configuration can change.

## Finalized-market and settlement evidence

A finalized rolling BTC market with recorded trades was selected through a
binary-specific finalized-market query. Its market contract returned:

- status `4` (`Resolved`);
- `isResolved = true`;
- `isVoided = false`;
- payout numerators `[10000000, 0]`.

The market contract's backing was zero after finalization. This is expected in
the current settlement-extraction design: backing moves to the permanent
`BinarySettlement` singleton. Deriving the settlement key from the YES outcome
ID and reading the singleton returned a matching record with:

- finalized `true`;
- voided `false`;
- the same pool and nonce;
- the same payout vector;
- zero settlement fee.

Applications must not conclude that a finalized market has no backing merely
because the recycled market contract reports zero.

## Wallet readiness

The dedicated public testnet address is:

`0x6CeD8D6Bad8Dfd2e60BCEA116fE74548f959f1F2`

Immediately after funding, it held:

- `1` STT;
- `10,000,000,000` raw tUSDC (`10,000` tUSDC at 6 decimals).

The balances were read directly from Shannon after the wallet owner completed
the two faucet transactions. Funding is therefore verified; signing remains an
independent safety gate.

The address is safe to publish, but its private key or seed phrase must never be
placed in chat, source control, GitHub metadata, logs, or shared configuration.

## Write-validation procedure

With faucet STT and tUSDC available, an owner-controlled signer can authorize
the write checks. Before an order is authorized, validation must rediscover an
active rolling BTC market and then:

1. read the live market status;
2. require sufficient expiry headroom;
3. read the current pool parameters and book;
4. confirm tUSDC balance and approve the active pool only as required;
5. calculate an exact minimum-size order using bigint units;
6. submit an explicit IOC or deliberately resting order;
7. distinguish transaction inclusion, order acceptance, and actual fill;
8. reconcile any surplus or cancellation refund against wallet and pool vault;
9. wait for the same `marketId` to finalize;
10. verify the settlement record and redeem the owned outcome position.

No write step should be presented as verified until its transaction and state
transition are observed on Shannon.

## Signed write evidence

The wallet owner approved and submitted a one-contract `BUY_YES` IOC order for
the rolling BTC market whose ID ended in `127a9`. The market, pool, book, price,
and token IDs were discovered at runtime by the validation harness.

- exact tUSDC approval transaction:
  `0x932864b9b364db37147a8ac6ffb43e51cee84ca83f40d84e060bde976a9b40e9`;
- order transaction:
  `0x7b436f7b324ac645cf5b820e71515e28609c70068edea31d17457f7934604a6e`;
- approved and maximum order cost: `102,000` raw tUSDC (`0.102` tUSDC);
- actual fill cost: `56,000` raw tUSDC (`0.056` tUSDC);
- direct wallet refund: `46,000` raw tUSDC (`0.046` tUSDC);
- acquired YES balance: `1,000,000` raw units (one contract);
- remaining pool allowance: `0`.

The receipt proves that transaction inclusion and a fill are distinct facts:
the pool pulled the maximum cost, returned the improvement directly to the
wallet, paid the maker, and transferred one YES outcome token to the wallet.
This resolves the previously unknown refund destination for this fill path.

The same market subsequently returned status `4` (`Resolved`), finalized
`true`, voided `false`, and winning outcome index `1` (NO). The wallet's YES is
therefore the losing token.

## Guaranteed redemption evidence

To avoid relying on a second directional guess, the wallet minted one complete
set in rolling BTC market `0x0000000000000000000000000000000000000000000000000000000000012801`.
This deposited exactly 1 tUSDC and produced one YES plus one NO.

- exact 1 tUSDC approval:
  `0x6576cbc22e7d9c28a6aed37847b5288a88e55afa49a97757914c4b5a9f4add78`;
- complete-set mint:
  `0xfd38faab771d4f0fb0e6670f16599b0744e1bd819c4fc06d501828ee3abb5916`;
- temporary outcome-token operator grant:
  `0xffa328f441d604ebe5beb379ebb2811e9a43634c981ae88ecfd72f1690fc6faa`;
- winning YES redemption:
  `0x392d13bb2a01d7bc99e889f49e31731ab4590d92231c7dc77a744a1d277c3db2`;
- operator revocation:
  `0x67d30fa24640e03950300be41f0e5eec342e56e63d93dab1aec37d6d058ab1b4`.

All five receipts succeeded. After redemption, the YES balance was zero, the
losing NO balance remained one contract, exactly 1 tUSDC had returned from the
settlement singleton to the wallet, and `isOperator(wallet, module)` was false.

## Live event evidence

A raw Shannon `eth_subscribe` logs subscription was opened for a runtime-
discovered active BTC pool. It received a pool event at block `478890758` in
transaction
`0xa5616dceda1691df9910631afdefd23eb3e2e40dc745afcd93ccf2fa9fdf8e25`.
This verifies actual WebSocket delivery rather than connection setup alone.

## Current blockers

None for the Issue #2 acceptance criteria.
