# Hardening and remaining-risk report

This report covers the Issue #8 implementation pass. Automated tests use
clearly isolated fixtures; live claims require separate network or wallet
evidence.

## Implemented protections

- Current-round snapshots are periodically rebuilt instead of depending on an
  uninterrupted event stream.
- Live discovery is bounded and paginated across binary assets and cadences;
  every candidate remains restricted to the configured operator and venue and
  is verified on-chain before display.
- Market selection is keyed by `marketId`; changing events clears reviewed
  plans, transaction state, and receipts, while order review refreshes the exact
  selected event instead of accepting a replacement.
- A displayed round is automatically rediscovered after its expiry when no
  transaction is in progress.
- Overlapping round reads are sequenced so an older response cannot overwrite a
  newer one.
- Order review refreshes discovery and full book depth before calculating the
  wallet request.
- The reviewed wallet and Somnia chain ID are bound to the order plan and
  rechecked before any approval or order transaction.
- Market status, expiry headroom, and pool identity are rechecked before a
  required approval, preventing approval for a locked or changed round.
- A wallet or network change invalidates an open review.
- Missing liquidity and invalid stake input have visible explanations rather
  than only a disabled button.
- Direction choices expose their selected state, inline review uses accurate
  group semantics, action updates are announced, focus is visible, and reduced
  motion is supported.
- Submitted, filled, unfilled, rejected, and failed transaction states remain
  distinct.
- Bounded token approval and DreamDEX order authorization have separate request,
  submission, and confirmation states. If approval succeeds but the order does
  not, the UI retains the approval receipt and warns that the bounded allowance
  may remain.
- Wallet/provider request dumps are normalized into concise user messages and
  long error content wraps inside the prediction card.
- Shared receipt and challenge routes use explicit loading, ready, not-found,
  and error states. Missing DreamDEX evidence cannot remain labeled as an
  in-progress rebuild, and clipboard denial leaves a selectable result URL.
- React development remounts reuse one page-lifetime Supabase Auth client per
  project instead of creating competing listeners on one session storage key.

## Automated evidence

- Exact UP and DOWN book quotes, including YES-frame protocol encoding.
- Wallet and network binding for reviewed plans.
- Automatic rediscovery after market rollover.
- Accessible direction-selection state.
- Existing discovery, unit, fill, settlement, scoring, reconciliation, social,
  configuration, and component behavior.
- Approval-versus-order progress callbacks, first-approval cancellation, later
  order cancellation, submitted-order uncertainty, and no-fill messaging.
- Missing and failed shared-result reconstruction, missing challenges, and
  clipboard-blocked result sharing.
- Repeated Supabase repository construction, normalized project URLs, and
  conflicting public-key rejection.
- Production dependency audit with zero reported vulnerabilities at the time of
  this pass.

## Manual checks still required

These cannot be honestly marked complete by automated fixtures:

- a filled UP or DOWN call initiated from the React application by the wallet
  owner;
- wallet rejection, wrong-network recovery, account switching during review,
  and a live rollover in the target browser wallet;
- desktop and mobile visual inspection, keyboard-only traversal, and browser
  console/network inspection;
- a deployed Supabase Web3 Auth login, anonymous reads, owner writes, and
  cross-wallet RLS denials with real wallets;
- a full timed judge rehearsal using an actually settled profile.

## Remaining external risks

| Risk | Impact | Mitigation |
|---|---|---|
| No eligible or liquid Event Contract during judging | Live write cannot be demonstrated | Use the live multi-market lobby, then lead with genuine previously settled evidence if all books are empty; never fabricate liquidity |
| Book moves before an IOC lands | Transaction is safely refused or unfilled | Refresh before review, use SDK slippage protection, verify fill events |
| Indexer or RPC interruption | Discovery or profile reconstruction is unavailable | Retry bounded reads, rebuild snapshots, preserve honest error states |
| Demo wallet lacks STT or tUSDC | Wallet cannot authorize the demo | Check public balances before judging; keep credentials outside the application |
| Supabase is not deployed or RLS is unverified | Social writes cannot be claimed | Keep social optional and visibly unconfigured; DreamDEX-backed trading and scoring still operate |
| External font request fails | Typography falls back to the local sans-serif default | Product behavior and proof remain available |

## Release position

The code is suitable for owner-operated testnet demonstration after the manual
checks above. It is not represented as audited production trading software.
