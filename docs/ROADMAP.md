# Delivery roadmap

The canonical work items are GitHub Issues. Issue numbers below define the
dependency order; a later phase does not start before the prerequisite pull
request is merged.

| Phase | Issue | Outcome | Principal blocker |
|---|---:|---|---|
| Foundation | #1 | Repository policies and decision gates | None |
| Integration validation | #2 | Evidence for the real DreamDEX lifecycle | Secure testnet signing and funds for write checks |
| Domain design | #3 | Approved score and domain invariants | Results from #2 and product approval |
| Trading core | #4 | Framework-independent verified adapter | Approved architecture and #2 |
| Live round | #5 | Human prediction and wallet flow | Approved frontend/wallet stack and #4 |
| Profiles | #6 | Settlement reconciliation and skill record | #3 and #4 |
| Social | #7 | Leaderboard, challenge, and result sharing | #6 and identity policy |
| Hardening | #8 | Reliable, accessible judge-ready product | #4 through #7 |
| Multi-market lobby | #22 | Trusted live binary Event Contract selection | #8 and approved discovery architecture |

## Phase 1 evidence requirements

Read-only validation must precede any signed transaction. The validation report
must cover:

- supported SDK version and configuration;
- live binary-market discovery and venue scoping;
- market status and expiry read from chain;
- current tick, lot, and minimum quantity;
- live UP/DOWN order book and event subscription;
- finalized-market discovery and oracle evidence;
- actual refund destination behavior.

A write validation remains blocked until a dedicated testnet wallet and faucet
funds are provided securely. Private keys must never enter source control,
issues, pull requests, logs, or chat.
