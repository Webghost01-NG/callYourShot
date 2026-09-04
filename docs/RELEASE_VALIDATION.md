# Judge release validation

Status date: 2026-09-04

This report records only checks actually completed against the public release.
Unavailable integrations and owner-signature checks remain explicit blockers;
they are not represented by fixtures or invented records.

## Deployment

- Stable URL: https://call-your-shot-six.vercel.app
- Immutable URL:
  https://call-your-shot-kk6x5blye-webghost01-ngs-projects.vercel.app
- Hosting project: `webghost01-ngs-projects/call-your-shot`
- Deployment ID: `dpl_An33pfS2psAHaSG9qtb63Hq9TUfM`
- Application source at deployment: commit `a01ad38`
- Hosting status observed: `Ready`
- Repository homepage: configured to the stable URL
- Git integration: connected to `Webghost01-NG/callYourShot`

The immutable deployment was created with the Vercel CLI from a clean working
tree at commit `a01ad38`. Once this release PR is reviewed and merged, the
connected Git integration should create a fresh production deployment from
`main`.

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
| Immutable deployment | Pass | Vercel deployment is `Ready` and has a fixed URL |
| Repository homepage | Pass | GitHub points to the stable production URL |
| Desktop rendering | Pass | Visually inspected at 1440 × 1200 |
| Mobile rendering | Pass | Visually inspected at 390 × 844 |
| Honest no-market state | Pass | No eligible round produced an explicit unavailable state, not fallback data |
| Social fail-closed state | Pass | Missing Supabase configuration produced an explicit unconfigured state |
| Anonymous social reads | Pass | Profiles and challenges returned HTTP 200 with empty real tables |
| Anonymous social mutation denial | Pass | `enroll_in_league` was denied with HTTP 401 and PostgreSQL code `42501` |
| Supabase Web3 claim shape | Pass | Client and database read the verified identity from `identity_data.custom_claims`; wrong-network and obsolete flat claims are rejected |
| Automated core/application suite | Pass | 33 Node tests and 21 Vitest tests passed before release |
| TypeScript and production build | Pass | Completed before the deployment was created |
| Production claim parser | Pass | The stable deployment returned HTTP 200 and its served social bundle contains the nested-claim parser |
| Existing wallet signer recovery | Pass | A connected account is resolved from its active connector without a redundant `connectAsync` request |

The visual checks found no clipped primary content at either viewport. The
no-market snapshot could not exercise the prediction form's keyboard path or a
wallet transaction, so those are not marked complete here.

## Outstanding owner-operated acceptance

- Validate authenticated enrollment with the owner wallet, then validate
  invited-wallet challenge acceptance and cross-wallet RLS denial using two
  real wallets.
- Authorize a small real UP or DOWN order from the deployed React application,
  confirm an actual `OrderFilled` event, and verify that the profile reconstructs
  the call. A successful transaction with no fill does not satisfy this check.
- Exercise wallet rejection, wrong-network recovery, account switching during
  review, keyboard-only prediction entry, and a live round rollover.
- Rehearse the complete two-to-three-minute runbook with genuine previously
  settled evidence and record the submission video.

## Rollback

If the Git-connected release regresses, use the Vercel project deployment list
to promote the last verified immutable deployment above. Do not delete the
failed deployment until its build and runtime logs have been inspected. If a
public configuration value is wrong, remove or replace that single Vercel
environment value and redeploy; never work around configuration failure by
hardcoding an origin, credential, market, or response in application source.

If Supabase validation fails, remove the two public Supabase variables and
redeploy. This returns the application to the explicit social-unconfigured
state while leaving DreamDEX trading and database-free profiles independent.
