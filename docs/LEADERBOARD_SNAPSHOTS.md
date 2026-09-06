# Bounded leaderboard snapshots

Issue #48 replaces an unbounded browser-wide DreamDEX rebuild with a bounded,
observable candidate process. Snapshots improve discovery; they never become
score truth.

## Read path

1. Supabase returns public league enrollments and at most 72 recent score
   snapshot candidates.
2. The client selects at most 24 wallets: up to 18 leading snapshot candidates,
   then recent enrollment discovery slots. The connected wallet is always
   included when enrolled.
3. At most three DreamDEX profile reconciliations run concurrently.
4. Only the newly rebuilt DreamDEX profiles enter `buildLeagueBoard`.
5. Cached and rebuilt formula version, exact rational score, settled count, and
   highest evidence block are compared. Drift is disclosed and the rebuilt
   value wins.

The UI states how many enrolled wallets were checked, the hard per-refresh
limit, missing evidence, stale snapshots, and corrected drift. A bounded view
is not described as complete when more enrollments exist.

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
cannot verify Somnia. A false or outdated snapshot may nominate a wallet for a
refresh, but it cannot put that stored score on the board: the browser rebuilds
the wallet from its DreamDEX fills, market contracts, and settlement records.

## Limits and residual risk

- Maximum database enrollments: 1,000 (existing fail-closed guard).
- Snapshot rows fetched: 72.
- DreamDEX wallets rebuilt per board refresh: 24.
- Concurrent wallet rebuilds: 3.
- Snapshot stale threshold: 15 minutes, shown in the UI.

The candidate index is not Sybil-resistant. Many fake high snapshots could
consume the 18 snapshot slots, although their claimed scores still cannot pass
the DreamDEX rebuild. Six discovery slots and the connected-wallet slot reduce
starvation but do not eliminate it. Monetary rewards require a trusted
chain-aware indexer and abuse controls beyond this hackathon MVP.

## Deployment

Apply
[`202609060001_leaderboard_snapshots.sql`](../supabase/migrations/202609060001_leaderboard_snapshots.sql)
to the linked Supabase project. If the table is not yet available, the client
falls back to a bounded enrollment sample and labels the snapshot index
unavailable; trading and personal proof continue to work.
