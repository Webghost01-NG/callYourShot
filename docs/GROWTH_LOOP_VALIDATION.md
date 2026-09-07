# Ecosystem growth-loop validation

Status date: 2026-09-07

The product path is implemented and automatically tested. A complete real
two-wallet production journey is still pending owner-operated signatures and
must not be described as completed until the evidence table below is filled.

## The smallest credible loop

1. **Call:** one player chooses a live Event Contract and independently signs a
   real DreamDEX order.
2. **Challenge:** that player creates a link tied to the exact `marketId` and
   one invited public wallet.
3. **Respond:** the invited wallet enrolls, accepts while the exact market is
   still chain-verified as tradable, and independently signs its own order.
4. **Compare:** after DreamDEX settlement, the challenge rebuilds both first
   qualifying fills, their result evidence, and their `CYS-EDGE-v1` points.
5. **Repeat:** either participant opens **Challenge again on a live event**. The
   opponent is prefilled, but the app must discover a new current market; it
   never reuses the locked `marketId`.

No challenge step holds funds, submits a trade for the other player, or awards
rank for volume. Two voluntary fills create DreamDEX activity; settlement turns
them into shareable proof; the rematch returns both people to live discovery.

## Honest MVP measures

These are definitions, not claimed results:

| Measure | Count only when |
|---|---|
| Invitation created | An authenticated enrolled creator records a challenge for one chain-verified live `marketId` and a distinct invited wallet |
| Challenge accepted | The exact invited wallet authenticates and accepts before that same market locks |
| Two-call activation | Both distinct wallets have a decoded first qualifying `OrderFilled` event in that challenge's market after their enrollment boundaries |
| Settled comparison | Both calls resolve from the same finalized Event Contract and both proof panels link to fill and result evidence |
| Repeat pair | The same unordered wallet pair creates a later challenge for a different live `marketId` after the earlier challenge becomes terminal |

Do not use button clicks, copied URLs, submitted-but-unfilled orders, wallet
connections, or database challenge rows as trading activation. Do not publish a
conversion rate while the denominator is zero or too small to be meaningful.

## Owner-operated acceptance procedure

Use two real wallets, A and B. Each needs enough Shannon STT for gas and testnet
collateral for a deliberately small order. Never share either private key.

1. Open the production app in two independent browser profiles.
2. Enroll A and B before trading so both fills fall inside their public league
   boundaries.
3. From A, choose a liquid live market with enough time remaining, enter B's
   address, and create the challenge.
4. Open the rendered link as B. Confirm it names the exact invited wallet and
   exact current Event Contract; sign in, accept, and make B's real call.
5. From A, make A's own real call in the same Event Contract.
6. For both wallets, require a decoded fill. A mined transaction with no
   `OrderFilled` evidence does not pass.
7. After settlement, reopen the challenge link and confirm both sides show a
   terminal call, exact round points, **Verify fill**, and **Verify result**.
8. Open both proof links and confirm the wallet/market identities match.
9. Click **Challenge again on a live event**. Confirm the previous opponent is
   prefilled and the old locked market is not selected.

If the live round lacks enough time or liquidity, stop and use the next round.
Do not retry a wallet write automatically or substitute a different market into
the existing challenge.

## Real evidence record

Complete this only after the procedure succeeds:

| Evidence | Value |
|---|---|
| Challenge URL | Pending owner-operated run |
| Wallet A fill transaction | Pending owner-operated run |
| Wallet B fill transaction | Pending owner-operated run |
| Event Contract finalization | Pending owner-operated run |
| Wallet A result link verified | Pending owner-operated run |
| Wallet B result link verified | Pending owner-operated run |
| Rematch route verified | Pending owner-operated run |

The empty evidence record is intentional. It prevents product capability from
being confused with observed adoption.
