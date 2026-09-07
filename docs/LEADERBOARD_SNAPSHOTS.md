# Deterministic leaderboard coverage and evidence snapshots

The UI advances automatically to the next cohort after a 1.5-second pause,
while preserving the 24-profile per-cohort bound. Users may pause/resume or
advance manually. Completion stops automatic reads; failures do not trigger
an endless retry loop. Reload still restarts the page-local coverage cycle.
This removes repeated clicking, not the underlying RPC cost of a large league.

Issue #78 removes owner-published performance claims from leaderboard membership
selection. The browser still bounds expensive DreamDEX reconstruction, but it
now scans a deterministic enrollment sequence with explicit coverage guarantees.
Snapshots are comparison hints only; they choose neither membership nor rank.

## Read path

1. Supabase returns the complete bounded enrollment set and up to 72 optional
   score snapshots for drift diagnostics.
2. Enrollments are deduplicated by wallet and ordered by immutable enrollment
   time, then normalized wallet address. Snapshot contents do not participate.
3. The client selects the next cohort of at most 24 wallets. At most three
   DreamDEX profile reconciliations run concurrently.
4. Verified results accumulate for the active coverage cycle. The next manual
   refresh continues at the following cohort instead of rechecking claimed
   leaders.
5. After `ceil(enrollments / 24)` completed refreshes, every wallet in the
   captured enrollment list has been attempted exactly once. New enrollments
   join the next cycle; they cannot repeatedly reset an unfinished scan.
6. Cached and rebuilt formula version, exact rational score, settled count, and
   highest evidence block are compared only after deterministic selection.
   Drift is disclosed and the rebuilt value wins.

The UI states cohort progress, cycle coverage, the hard per-refresh limit,
missing evidence, stale snapshots, and corrected drift. Before full successful
coverage it says **Verified subset** and its ordinals apply only to that subset.
It says **Whole-league verified leaderboard** only when every enrollment in the
cycle reconciled without a score-affecting evidence gap and the enrollment set
still matches the current roster. Results span the cycle's read times; this is
coverage of membership, not a simultaneous common-block ranking snapshot.

## Snapshot write path

An enrolled user can sign in with the same Supabase Web3 identity and publish a
candidate snapshot for their own wallet. The security-definer RPC derives the
wallet and profile from `auth.uid()`; it does not accept either from the
browser. Direct table writes are revoked.

Stored fields are:

- wallet/profile identity;
- immutable formula version;
- profile state and settled sample count;
- exact score numerator and denominator plus a six-decimal sorting projection;
- the highest block used by fill or finalization evidence;
- a server-controlled capture time.

These values are intentionally treated as untrusted hints because Supabase
cannot verify Somnia. A false or outdated snapshot cannot change cohort
membership, displace another wallet, or put its stored score on the board. The
browser first chooses wallets from enrollment order, then rebuilds them from
DreamDEX fills, market contracts, RPC receipts, and settlement records.

## Limits and residual risk

- Maximum database enrollments: 1,000 (existing fail-closed guard).
- Snapshot rows fetched: 72.
- DreamDEX wallets rebuilt per board refresh: at most 24.
- Concurrent wallet rebuilds: 3.
- Snapshot stale threshold: 15 minutes, shown in the UI.
- Coverage bound: every enrollment is attempted within
  `ceil(enrollments / 24)` consecutive cohort refreshes.

Wallet enrollment is not proof of unique personhood. Sybil wallets can enlarge
the number of deterministic cohorts, but cannot target shortlist membership by
advertising a high score. Monetary rewards still require persistent identity,
rate limits, and abuse controls beyond this hackathon MVP.

Coverage accumulation is page-local. Reloading starts a new deterministic cycle
at the first cohort; no stale browser result is silently promoted to global
authority. A server-operated whole-league index would be the appropriate scale
path for a league too large to scan interactively.

## Deployment

Apply
[`202609060001_leaderboard_snapshots.sql`](../supabase/migrations/202609060001_leaderboard_snapshots.sql)
to the linked Supabase project. If the table is not available, deterministic
enrollment coverage continues unchanged and the UI labels only the optional
snapshot-comparison index unavailable. Trading and personal proof continue to
work.
