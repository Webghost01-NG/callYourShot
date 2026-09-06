# Social competition and persistence boundary

Status: approved by the product owner for GitHub Issue #7 on 2026-09-04.

## What Supabase is allowed to store

Supabase organizes people; it does not decide prediction results. The schema
stores only:

- an authenticated wallet's public league enrollment, optional display name,
  server-controlled enrollment time, and formula version;
- a challenge's participants, DreamDEX `marketId`, lifecycle state, and server
  timestamps.

It does not store a trusted score, winner, fill, balance, payout, order, market
price, or settlement. The leaderboard and shared views rebuild those claims
from DreamDEX using the reconciliation boundary in
[PROFILE_RECONCILIATION.md](PROFILE_RECONCILIATION.md). A failed rebuild is
excluded and labeled unavailable; it never becomes a zero score or a synthetic
result.

The database timestamp is the enrollment boundary. Only qualifying fills at or
after that time count in the league. The browser cannot choose or move the
boundary, which prevents a player from enrolling immediately before a good
historical run.

## Web3 authentication

League writes require Supabase Sign In with Web3. The browser creates an
EIP-4361 message bound to the current application origin and Somnia Shannon,
sets a five-minute expiry, and asks the connected wallet to sign it. The
message explicitly says that it does not authorize a trade or transfer.

Supabase Auth validates the message and signature. Database mutation functions
then derive the wallet address from the server-side `auth.identities` Web3
record, including the Shannon network binding. They never accept a
caller-supplied wallet as the current user's identity. Wallet addresses are
stored lowercase to avoid case-variant identity
or uniqueness errors and rendered in checksum form in the application.

Before deployment, enable the Ethereum Web3 provider in Supabase Auth and add
the exact production URL plus local development URL to Auth redirect URLs.

## Schema and RLS

The migration is
[`supabase/migrations/202609040001_social_competition.sql`](../supabase/migrations/202609040001_social_competition.sql).

- `league_profiles` binds one Supabase user to one verified Web3 wallet.
- `challenges` binds an enrolled creator and one invited wallet to a DreamDEX
  `marketId`; the invitee must enroll before accepting.
- public/anonymous clients can select only public columns; Supabase user IDs are
  never granted through the data API;
- row-level security permits public reads and limits possible writes to owners
  or challenge participants;
- direct table mutation privileges are revoked. Audited security-definer RPCs
  perform enrollment, name updates, challenge creation, acceptance, and
  cancellation after deriving the caller's Web3 wallet;
- a creator can have at most ten open challenges, and only the invited wallet
  can accept one.

Challenges do not hold collateral, coordinate approvals, submit transactions,
or pay a prize. Each player independently trades on DreamDEX. A challenge only
compares the first qualifying filled call for both wallets in the recorded
market.

### Chain-derived challenge lifecycle

The stored `open`, `accepted`, and `cancelled` values remain coordination state,
not market truth. The public view derives actionable and terminal states from
the exact DreamDEX `marketId`:

- an open challenge whose exact market is no longer in the verified live lobby
  is expired and cannot be accepted in the application;
- acceptance first refreshes that exact market through the on-chain trading and
  expiry guard and requires a readable buy side before the database RPC runs;
- an accepted challenge with both first-call fills waits for settlement and is
  completed only when both results are terminal;
- an accepted challenge that closes before both calls exist is labeled locked
  and incomplete, while preserving any evidence already available;
- completed comparison uses each call's exact `CYS-EDGE-v1` round points, with
  void or otherwise unscored outcomes labeled honestly.

Supabase cannot independently query Somnia during its RPC. A caller bypassing
the application could still change an invited row from `open` to `accepted`,
but that row never makes a stale market actionable: every public client derives
the same locked state from DreamDEX, and the trading path performs its own
on-chain recheck before preparing an order. Enforcing expiry inside persistence
would require a separately trusted chain-aware server boundary and is outside
this browser-only MVP.

## Leaderboard and links

Only profiles with at least ten settled, non-void calls receive a rank.
Ordering uses the exact `CYS-EDGE-v1` rational skill score, then settled sample
size, enrollment time, and wallet address as deterministic tie-breakers. Dollar
profit is displayed in personal records but never used for rank.

Before ten settlements, a caller appears only in the explicitly unranked
qualification section. It shows the provisional score, exact settled sample
count, and progress toward ten. Qualification ordering uses sample count rather
than presenting an unstable early score as a rank. Empty profiles may show
enrollment activity but have no score; no simulated player or outcome is added.

The public client pages enrollments and reconciles at most three wallets
concurrently to avoid an uncontrolled indexer burst. Each refresh verifies at
most 24 snapshot-selected and discovery wallets, and states that coverage in
the UI. It still fails closed if enrollment storage exceeds its 1,000-profile
safety limit. Candidate snapshots are never ranked directly; exact DreamDEX
reconciliation replaces or rejects their values. See
[LEADERBOARD_SNAPSHOTS.md](LEADERBOARD_SNAPSHOTS.md). Provisional players are
shown separately. Profiles with score-affecting
fill, market, or settlement evidence gaps are counted as excluded, not silently
published as valid low performers. Missing explorer-link metadata is labeled
but does not overrule an otherwise complete on-chain settlement.

Challenge links contain a random database UUID. Result links contain only a
public wallet address and DreamDEX `marketId`; the receiver rebuilds the result
and receives explorer links for the underlying fill and finalization evidence.

## Privacy and abuse constraints

- Wallet addresses, optional display names, enrollments, and challenges are
  public. The join screen must make this clear before enrollment.
- Display names are optional, non-unique, restricted to a small ASCII set, and
  always shown beside a shortened wallet address. Reserved project, protocol,
  support, and moderator names are rejected.
- A wallet is not a proof of personhood. Sybil resistance, prizes, moderation
  queues, reporting, blocking, CAPTCHA, and server-level rate limiting are not
  in this MVP. Do not attach monetary rewards until those controls exist.
- Supabase Auth warns that free wallet creation can enable sign-in abuse.
  Production must enable appropriate Auth rate limits and CAPTCHA before a
  public campaign.
- Challenge IDs are not secrets. There is no private challenge mode in this
  schema.
- Deleting an authentication account cascades its profile and any challenge it
  created or accepted. An unaccepted invitation may still contain the invited
  public wallet address until its creator cancels or deletes their account.

## Public configuration

The Vite client accepts only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. New `sb_secret_` keys and legacy JWTs carrying
the `service_role` role are rejected at startup. A service key must never be
placed in source, Vite configuration, a browser, or a deployment environment
that exposes it to the browser.

When either public value is missing, the social layer explicitly renders as
unconfigured and shows no sample players. DreamDEX trading and database-free
personal profiles remain independent.

## Remaining deployment verification

This repository does not contain a Supabase project or credentials, so the
migration and live Web3/RLS flows cannot be executed here. Before release:

1. create or select the intended Supabase project;
2. enable Ethereum Web3 Auth and configure exact redirect URLs;
3. apply the migration through the project's migration workflow;
   this includes the later leaderboard-snapshot migration;
4. test anonymous reads, owner enrollment/name changes, invited-only challenge
   acceptance, cross-wallet denial, and open-challenge limits with real test
   wallets;
5. add only the public URL and publishable key to Vite;
6. enable Auth abuse controls before public promotion.
