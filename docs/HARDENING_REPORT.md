# Hardening and remaining-risk report

This report covers the Issue #8 implementation pass. Automated tests use
clearly isolated fixtures; live claims require separate network or wallet
evidence.

## Final testnet release pass — September 8, 2026

The #8 pass adds wallet-dialog focus containment for empty and connecting states,
with regression tests. It changes no contracts, database, endpoints, or trading
logic. The current suite passes 67 Node and 86 Vitest tests; typecheck, production
build, and the production dependency audit pass (zero reported vulnerabilities).

Fresh production inspection found six current markets and all six enrolled wallets
reconciled, including two 12-settlement profiles. Navigation at 1440 and 390 px
remained visible across arena/record/league, without horizontal overflow; 320 px
also passed the overflow check. Responsive layout checks do not establish mobile
wallet support. The completed public challenge reloaded with both settled outcomes
and receipt links. See [release validation](RELEASE_VALIDATION.md) and
[the published 2:40 walkthrough](DEMO_MEDIA.md) for evidence and recording limits.

## Implemented protections

- Cancelled add-network/switch-network requests display a Somnia-specific recovery
  message instead of the generic provider-error fallback. Other switch failures
  explain how to select Somnia manually. Component tests verify that both paths
  stop before order preparation or submission and restore the review action.
  Owner screenshots confirm the original cancellation returned control while
  staying on Flare; successful wrong-network recovery still needs owner confirmation.

- Wallet connection cancellation/failure and success use a dismissible page-wide
  status notice, not the trading panel's order state. September 8 owner screenshots
  exposed the misleading order message after connection rejection; the regression
  test now exercises cancellation followed by a successful connection retry.
  This does not count as approval/order rejection or network-switch acceptance.

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
- Live discovery health-checks a complete DreamDEX indexer and Somnia RPC
  bundle, rejects wrong-chain or excessively skewed snapshots, and can rotate
  to the second official Shannon HTTP/WebSocket alias before failing honestly.
  Writes remain pinned and are never automatically resubmitted.

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

## Final owner acceptance — September 8, 2026

After production PR #90, the owner confirmed “all done, checked” for the final
requested pass: updated network-cancellation feedback, successful Somnia network
recovery, account switching invalidating an open review, and market rollover
preventing an expired-round trade. These are owner-reported manual results, not
independently captured browser traces. Earlier owner screenshots demonstrate
connection cancellation/retry and bounded approval cancellation.

This completes the remaining target-wallet release gate for #8. Terminal
comparison and rematch navigation are verified in production (#50), and the
timed walkthrough is published (#49). The latest application suite passes 67
Node and 89 Vitest tests (156 total), with typecheck/build and CI passing.

This confirmation does not establish physical-device/QR acceptance, an
authenticated cross-wallet RLS-denial test, or a second played rematch. QR stays
suspended; those broader checks and external risks remain disclosed rather than
being inferred from the owner's final confirmation.

Real React-originated fills, desktop/mobile rendering, Web3 authentication,
anonymous reads, owner writes, invited-wallet acceptance, two independent
challenge-market fills, and qualified leaderboard profiles have been exercised.

## Remaining external risks

| Risk | Impact | Mitigation |
|---|---|---|
| No eligible or liquid Event Contract during judging | Live write cannot be demonstrated | Use the live multi-market lobby, then lead with genuine previously settled evidence if all books are empty; never fabricate liquidity |
| Book moves before an IOC lands | Transaction is safely refused or unfilled | Refresh before review, use SDK slippage protection, verify fill events |
| RPC interruption | A live read route may fail | Rotate the complete read bundle to the other official Shannon alias, preserve bounded errors, and never replay writes |
| DreamDEX indexer interruption | Discovery and profile reconstruction are unavailable | Report the outage honestly; no second organizer-verified testnet indexer is currently configured |
| Demo wallet lacks STT or tUSDC | Wallet cannot authorize the demo | Check public balances before judging; keep credentials outside the application |
| Supabase is not deployed or RLS is unverified | Social writes cannot be claimed | Keep social optional and visibly unconfigured; DreamDEX-backed trading and scoring still operate |
| External font request fails | Typography falls back to the local sans-serif default | Product behavior and proof remain available |

## Release position

The release has a demonstrated owner-operated desktop testnet path and a reloadable
settled fallback, so judging does not depend on a new round settling. Keep QR out
of the demonstration and disclose the remaining checks above. This is not audited
production trading software, a complete accessibility certification, or proof of
forecasting skill.
