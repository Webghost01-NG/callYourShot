# Judge demo runbook

This runbook keeps the demo short, reproducible, and honest. It never substitutes
fixtures or screenshots for live DreamDEX evidence.

## Before judging

1. Install from the committed lockfile with `npm ci`.
2. Configure the approved public DreamDEX origin in `.env.local`.
3. If the social section is part of the demo, configure only the Supabase URL
   and public publishable key after applying the approved migration and Web3
   Auth redirect settings.
4. Confirm the demo wallet is on Somnia Testnet and has enough STT for gas and
   tUSDC for the intended maximum loss. Never export its key.
5. Run `npm run typecheck`, `npm test`, and `npm run build`.
6. Run the read-only checks with the actual organizer-provided origin and demo
   wallet:

   ```bash
   DREAMDEX_OPERATOR_ID=<id> DREAMDEX_VENUE_ID=<bytes32> npm run check:live
   PROFILE_ACCOUNT=<public-address> DREAMDEX_OPERATOR_ID=<id> DREAMDEX_VENUE_ID=<bytes32> npm run check:profile
   ```

7. Open the application once at desktop and mobile widths. Verify keyboard-only
   direction selection, stake entry, review, wallet cancellation, proof links,
   and visible focus.

## Two-to-three-minute sequence

### 0:00–0:25 — The promise

Say: “Call Your Shot is a prediction league where spending more cannot buy a
better rank. Every call and result is rebuilt from a real DreamDEX trade.”

Point to the live question, opening reference, countdown, and UP/DOWN choices.

### 0:25–1:10 — One real call

1. Choose UP or DOWN based on the live round.
2. Enter a deliberately small maximum loss.
3. Show the market-derived price, maximum loss, and possible payout.
4. Open the review and explain the bounded approval, if one is required.
5. Confirm in the wallet.
6. Call out the separate submitted and verified-fill states.

If liquidity moves or the round locks, show the honest refusal and continue to
the verified-history section. Do not retry repeatedly or describe a submission
as a fill.

### 1:10–1:55 — Proof of skill

Use a wallet that already has genuine settled calls. Show the provisional or
verified skill score, equal-weight formula, history, and explorer links for a
fill and finalized result. This is the settlement proof and does not require
waiting for the live round to resolve during judging.

### 1:55–2:35 — Human competition

If the real Supabase deployment has passed authentication and RLS checks, show
the verified leaderboard, create a noncustodial friend challenge, and copy a
result receipt. Explain that Supabase coordinates identities and links while
DreamDEX remains the source of trading and score truth.

If Supabase is not validated, show the explicit “not configured” state and omit
social-write claims.

### 2:35–3:00 — Close

Say: “The interface is simple—pick a side and set your limit—but every rank can
be independently reconstructed from DreamDEX Event Contracts on Somnia.”

## Failure branches

- **No eligible round:** explain the expiry-headroom protection, then use real
  settled profile evidence.
- **Empty selected side:** switch sides only if that matches the presenter’s
  actual call; never invent a price.
- **Wallet/network changed:** review again with the intended wallet on Somnia.
- **IOC no-fill:** explain that price protection prevented a worse fill.
- **Indexer or RPC unavailable:** show the unavailable state and verified
  explorer receipts already returned by real transactions.
- **Supabase unavailable:** omit league writes; trading and profile truth remain
  independent of Supabase.
