# Judge release validation

Status date: 2026-09-04

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

Only these public browser configuration names are present in the Vercel
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
`202609040001` and `202609040002` are present in both the local and remote
migration histories. No service-role key is present in Vercel or source.

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
| Automated core/application suite | Pass | 42 Node tests and 44 Vitest tests passed on the release branch |
| TypeScript and production build | Pass | Typecheck and Vite production build completed on the release branch |
| Dependency audit | Pass | `npm audit --omit=dev` reported zero vulnerabilities |
| Production claim parser | Pass | The stable deployment returned HTTP 200 and its served social bundle contains the nested-claim parser |
| Existing wallet signer recovery | Pass | A connected account is resolved from its active connector without a redundant `connectAsync` request |
| Challenge availability and link fallback | Pass | The UI explains when no real round is available and renders every created link for manual copying |
| Bounded DreamDEX discovery | Pass | A stalled SDK request reached a retryable error within 20 seconds; a regression test proves retry creates a fresh runtime and ignores late results |
| Profile-check process lifecycle | Pass | The live command flushed its JSON report and exited with status 0 in approximately 16 seconds instead of retaining the SDK transport indefinitely |

The visual checks found no clipped primary content at either viewport. The
no-market snapshot could not exercise the prediction form's keyboard path or a
wallet transaction, so those are not marked complete here.

## Current external dependency risk

During the latest owner-acceptance attempt, the DreamDEX indexer returned six
future BTC/ETH markets for the trusted operator and venue, but on-chain
verification failed through both the configured and currently documented
Somnia testnet WebSocket endpoints. The deployed application correctly reached
its bounded unavailable state. This is recorded as an intermittent upstream or
runner-network blocker; it is not represented as a successful trading test and
the public RPC configuration was not changed without verified recovery.

## Outstanding owner-operated acceptance

- Validate invited-wallet challenge acceptance and cross-wallet RLS denial
  using two real wallets when an eligible live DreamDEX round is available.
- Authorize a small real UP or DOWN order from the deployed React application,
  confirm an actual `OrderFilled` event, and verify that the profile reconstructs
  the call. A successful transaction with no fill does not satisfy this check.
- Exercise wallet rejection, wrong-network recovery, account switching during
  review, keyboard-only prediction entry, and a live round rollover.
- Rehearse the complete two-to-three-minute runbook with genuine previously
  settled evidence and record the submission video.

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
