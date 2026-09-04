# Judge release validation

Status date: 2026-09-04

This report records only checks actually completed against the public release.
Unavailable integrations and owner-signature checks remain explicit blockers;
they are not represented by fixtures or invented records.

## Deployment

- Stable URL: https://call-your-shot-six.vercel.app
- Immutable URL:
  https://call-your-shot-ll95mx7c8-webghost01-ngs-projects.vercel.app
- Hosting project: `webghost01-ngs-projects/call-your-shot`
- Deployment ID: `dpl_9qnbJEhD6wZKK1uPqUwVPvqp4bLn`
- Application source at deployment: commit `038f423`
- Hosting status observed: `Ready`
- Repository homepage: configured to the stable URL
- Git integration: connected to `Webghost01-NG/callYourShot`

The immutable deployment was created with the Vercel CLI from a working tree
whose application source matched commit `038f423`; the only uncommitted file
was the Vercel ignore entry later included in this release branch. Once this
release PR is reviewed and merged, the connected Git integration should create
a fresh production deployment from `main`.

## Public configuration

Only these DreamDEX browser configuration names are present in the Vercel
Production, Preview, and Development environments:

- `VITE_DREAMDEX_OPERATOR_ID`
- `VITE_DREAMDEX_VENUE_ID`

No wallet key, seed phrase, Vercel token, Supabase service-role key, or other
server secret is stored in source. The local `.vercel` link and pulled
`.env.local` are ignored and must never be committed.

Supabase variables are intentionally absent because no target project URL or
public publishable key has been supplied and no deployed RLS validation has
been completed. The production interface therefore labels the social league
unconfigured and displays no sample participants.

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
| Automated core/application suite | Pass | 31 Node tests and 19 Vitest tests passed before release |
| TypeScript and production build | Pass | Completed before the deployment was created |

The visual checks found no clipped primary content at either viewport. The
no-market snapshot could not exercise the prediction form's keyboard path or a
wallet transaction, so those are not marked complete here.

## Outstanding owner-operated acceptance

- Supply or create the intended Supabase project, enable Ethereum Web3 Auth,
  register the exact local and production redirect URLs, and apply
  `supabase/migrations/202609040001_social_competition.sql`.
- Add only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` after checking
  that the key is public/publishable and not a service-role secret.
- Validate anonymous league reads, authenticated owner writes, invited-wallet
  challenge acceptance, and cross-wallet RLS denial using two real wallets.
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
