# Judge release validation

Status date: 2026-09-08

## Current release summary

The final #8 pass builds on production commit `276b24a`. The fresh automated
suite passes 67 Node tests and 86 Vitest tests, TypeScript, and the production
build. `npm audit --omit=dev` reports zero vulnerabilities. The existing
530 kB runtime bundle warning remains. The only application change in this pass
keeps keyboard focus inside the wallet chooser when no choices are present or
all controls are disabled during connection; it does not change wallet execution.

Fresh production browser checks on September 8 found six current markets and
complete six-wallet board coverage, with two profiles at 12 settlements each.
The public completed challenge reloaded with Higher/lost and Lower/won and both
fill/result links. Desktop (1440 px) and mobile-width (390 px) navigation to
arena, record, and league retained visible navigation without horizontal overflow;
320 px also passed the document-width check. Desktop and mobile landing layouts
were visually inspected. These are desktop-Chrome responsive checks, not a
physical-device wallet or QR acceptance claim.

Current limitations: QR pairing is deliberately suspended; the final public
video is now published in [the media release](https://github.com/Webghost01-NG/callYourShot/releases/tag/demo-2026-09-08).
It shows live UI and previously executed transactions, not new wallet signatures.
After `aebe490`, production challenge comparison and rematch
navigation passed; a fresh completed comparison loaded in 15.038 seconds.
A second played rematch is not claimed. Both genuine fills and qualified profiles are already
evidenced in [growth-loop validation](GROWTH_LOOP_VALIDATION.md). Do not treat
the older no-trade/no-enrollment observations below as the current state.

## Historical validation baseline

The remainder records checks from earlier releases unless explicitly dated.
This report records only checks actually completed against the public release.
Unavailable integrations and owner-signature checks remain explicit blockers;
they are not represented by fixtures or invented records.

## Deployment

- Stable URL: https://call-your-shot-six.vercel.app
- Hosting project: `webghost01-ngs-projects/call-your-shot`
- Validated application commit: `c988fc5`
- GitHub/Vercel deployment status for that commit: `success`
- Repository homepage: configured to the stable URL
- Git integration: connected to `Webghost01-NG/callYourShot`

The stable deployment returned HTTP 200 after commit `c988fc5` reached `main`.
This document intentionally does not pin a Vercel deployment ID or immutable
preview URL: those identifiers change on every Git-connected documentation
deployment even when the application bundle is unchanged. Deployment rollback
must use the Vercel project history and a verified `main` commit.

## Public configuration

At the historical baseline, these public browser configuration names were present in the Vercel
Production, Preview, and Development environments:

- `VITE_DREAMDEX_OPERATOR_ID`
- `VITE_DREAMDEX_VENUE_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

No wallet key, seed phrase, Vercel token, Supabase service-role key, or other
server secret is stored in source. The local `.vercel` link and pulled
`.env.local` are ignored and must never be committed.

The configured Supabase key is the browser-safe publishable key. Ethereum Web3
authentication is enabled for Somnia network `50312`, and migrations
`202609040001`, `202609040002`, and `202609060001` are present in both the local
and remote migration histories. No service-role key is present in Vercel or
source. The earlier baseline did not include `VITE_REOWN_PROJECT_ID`. That is
not a current environment inventory; QR registration is now suspended in code
regardless of any configured project ID.

## Completed checks

| Check | Result | Evidence |
|---|---|---|
| Public HTTPS response | Pass | Stable URL returned HTTP 200 with valid TLS |
| Git-connected deployment | Pass | GitHub reported the Vercel status for application commit `c988fc5` as successful |
| Application favicon | Pass | `/favicon.svg` returned HTTP 200 as `image/svg+xml` and is declared in the document head |
| Repository homepage | Pass | GitHub points to the stable production URL |
| Desktop rendering | Pass | Visually inspected at 1440 × 1200 |
| Mobile rendering | Pass | Visually inspected at 390 × 844 |
| Honest no-market state | Pass | No eligible round produced an explicit unavailable state, not fallback data |
| Social fail-closed state | Pass | Missing Supabase configuration produced an explicit unconfigured state |
| Anonymous social reads | Pass | Profiles and challenges returned HTTP 200 with empty real tables |
| Anonymous social mutation denial | Pass | `enroll_in_league` was denied with HTTP 401 and PostgreSQL code `42501` |
| Supabase Web3 claim shape | Pass | Client and database read the verified identity from `identity_data.custom_claims`; wrong-network and obsolete flat claims are rejected |
| Authenticated league enrollment | Pass | Owner-operated production check created wallet `0x2981…D196` as provisional profile `ghost` and persisted a display-name update |
| Automated core/application suite | Pass | 66 Node tests and 82 Vitest tests passed on the deterministic-coverage branch, with typecheck and production build |
| TypeScript and production build | Pass | Typecheck and Vite production build completed on the release branch |
| Dependency audit | Pass | `npm audit --omit=dev` reported zero vulnerabilities |
| Production claim parser | Pass | The stable deployment returned HTTP 200 and its served social bundle contains the nested-claim parser |
| Existing wallet signer recovery | Pass | A connected account is resolved from its active connector without a redundant `connectAsync` request |
| Challenge availability and link fallback | Pass | The UI explains when no real round is available and renders every created link for manual copying |
| Bounded DreamDEX discovery | Pass | Each complete route has a 35-second cold-snapshot budget; the UI bound is derived from all route budgets plus grace, and regression tests prove late timed-out results cannot replace recovered data |
| Profile-check process lifecycle | Pass | The live command flushed its JSON report and exited with status 0 in approximately 16 seconds instead of retaining the SDK transport indefinitely |
| Snapshot schema deployment | Pass | Migration `202609060001` was the only pending migration, applied successfully, and the linked `private`/`public` schema lint returned no errors |
| Anonymous snapshot reads | Pass | The deployed `league_score_snapshots` REST relation returned HTTP 200 through the browser-safe publishable key |
| Fair bounded board regression | Pass | Automated tests enforce deterministic enrollment cohorts of at most 24, prove unverified score claims cannot change membership, and expose finite whole-league coverage progress |
| Lagging-indexer discovery recovery | Pass | With the official indexer about 10,500 blocks behind both verified RPCs, the read-only live probe chain-verified four current BTC/ETH Event Contracts and read every real order book; no stale row was trusted as authority |

On 2026-09-07, three fresh `BrowserDreamDexRuntime.loadMarkets()` runs exercised
the production read path with the configured origin and both official endpoint
bundles. They returned two current, chain-verified markets in 26.368 seconds
after one clean route failover, then 16.599 seconds and 4.108 seconds on the
primary route. No run reached the derived UI deadline or fabricated a market.

The visual checks found no clipped primary content at either viewport. The
no-market snapshot could not exercise the prediction form's keyboard path or a
wallet transaction, so those are not marked complete here.

## Current external dependency risk

On 2026-09-07 the official DreamDEX indexer reported block `481827445` while
the two verified Shannon HTTP RPCs reported `481837968` and `481837973`. The old
symmetric 3,000-block guard rejected discovery before candidate verification.
Issue #60 corrects that availability failure: behind-RPC indexer rows may only
nominate bounded candidates, every candidate is still checked against current
chain state and a real book, and the measured lag is visible. An indexer
materially ahead of the selected RPC still fails closed. This does not claim a
successful live trade or hide upstream lag.

## Outstanding owner-operated acceptance

- If QR is restored, verify mobile handoff and desktop QR before claiming support.
- Publish one authenticated snapshot from the production UI and confirm the
  next refresh rebuilds its score from DreamDEX rather than trusting storage.
- Settlement comparison and rematch navigation passed on production after
  `aebe490`; a genuinely played repeat round remains optional adoption evidence.
- Retain a separate real two-wallet cross-wallet RLS-denial acceptance check;
  successful acceptance alone does not prove every denial path.
- Exercise wallet rejection, wrong-network recovery, account switching during
  review, keyboard-only prediction entry, and a live round rollover.
- The 2:40 production walkthrough and settled-evidence rehearsal are published
  in the media release. A newly signed transaction is not part of that recording.
  The owner must still confirm the submission form and any streaming-host requirement.

## Rollback

If the Git-connected release regresses, use the Vercel project deployment list
to promote the last deployment associated with a verified `main` commit. Do not
delete the failed deployment until its build and runtime logs have been
inspected. If a public configuration value is wrong, remove or replace that
single Vercel environment value and redeploy; never work around configuration
failure by hardcoding an origin, credential, market, or response in application
source.

If Supabase validation fails, remove the two public Supabase variables and
redeploy. This returns the application to the explicit social-unconfigured
state while leaving DreamDEX trading and database-free profiles independent.
