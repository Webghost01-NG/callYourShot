# Hackathon submission checklist

Status date: 2026-09-08

This page separates submission-ready evidence from owner actions. Do not replace
an incomplete item with a placeholder URL, staged transaction, or invented
metric.

## Copy-ready project summary

- **Name:** Call Your Shot
- **One sentence:** A prediction league where every score starts with a real
  DreamDEX fill.
- **Category:** Consumer-facing social prediction product
- **Network:** Somnia Shannon testnet (`50312`)
- **Core integration:** DreamDEX Event Contracts through
  `@somnia-chain/markets-sdk`
- **Live app:** https://call-your-shot-six.vercel.app
- **Repository:** https://github.com/Webghost01-NG/callYourShot

### Short description

Call Your Shot lets people make simple YES/NO calls on live DreamDEX Event
Contracts, then turns real fills and finalized outcomes into an independently
checkable prediction-performance record. Friend challenges use separate noncustodial trades, and
the ranking formula weights each settled call equally so a larger wallet cannot
buy a higher score.

## Required evidence

- [x] Public source repository with reproducible install, test, and build steps
- [x] Public HTTPS application
- [x] DreamDEX SDK and current-chain Event Contract integration
- [x] Architecture and verification-flow diagram in the README
- [x] Genuine product screenshot from the public deployment
- [x] Public fill, finalization, oracle, and runtime-reconciled receipt links
- [x] Verified leaderboard with two profiles above the ten-settlement threshold
- [x] Accepted two-wallet challenge with two independent DreamDEX fills
- [x] SDK/documentation feedback
- [x] Public 2:40 demo video: [MP4 download](https://github.com/Webghost01-NG/callYourShot/releases/download/demo-2026-09-08/Call-Your-Shot-Live-Demo.mp4)
- [x] Real two-wallet challenge comparison from invitation through settlement
- [ ] Mobile/QR acceptance evidence — QR pairing is currently suspended; not claimed as supported
- [x] Owner-approved MIT repository license
- [x] Owner-approved Node 22 continuous-integration workflow

The checked items are directly inspectable in the repository. The challenge's
two-call activation and terminal comparison are complete. Production also passed
rematch navigation; a second played rematch is not claimed. The remaining
items require owner-controlled accounts or publishing and must remain unchecked
until completed.

The README now leads with the redesigned production UI and explicitly separates
the historical receipt screenshot from current product visuals. Browser-wallet
connection is the supported demonstration path; do not demonstrate or promise
the disabled QR connector. The [public media release](https://github.com/Webghost01-NG/callYourShot/releases/tag/demo-2026-09-08)
includes the 2:40 video, chapter captions, PowerPoint, and PDF deck. The recording
shows live UI and previously executed fill/settlement evidence, not a newly
signed transaction. Confirm the submission form accepts a GitHub download link;
if it requires a streaming host, upload this same MP4 there before submitting.

## Final DoraHacks pass

Open the [official Event Contracts Hackathon page](https://dorahacks.io/hackathon/event-contracts/detail)
immediately before submission and confirm the current form fields and deadline.
The public page is protected by an interactive WAF in automated environments,
so the owner must perform this last form-level check in a normal browser.

Before pressing submit:

1. paste the copy-ready name, one-sentence pitch, and short description above;
2. link the stable production URL and this public repository;
3. upload the repository-owned social preview and genuine receipt screenshot;
4. add the final video URL in this file and the README;
5. open every evidence link in a signed-out browser window;
6. confirm the video demonstrates a real fill or clearly uses the genuine
   previously settled receipt when no live round is available;
7. disclose testnet status, suspended QR support, and that only rematch navigation—not a second played rematch—is verified;
8. never call transaction inclusion a fill or provisional profiles ranked.

## Judging alignment

| Criterion | What to show |
|---|---|
| Technical implementation | Multi-market discovery, chain/indexer binding, real book, bounded wallet approval/order, decoded fill, settlement and oracle proof |
| Innovation | A bankroll-neutral skill score and noncustodial human competition built from trading evidence |
| UX and design | Pick a market, choose YES/NO, cap risk, then inspect proof only when wanted |
| Business/ecosystem impact | Challenges and rematches create voluntary independent Event Contract trades and share verifiable DreamDEX receipts |
| Presentation/demo | One current call, one already-settled public receipt, one friend challenge, and a concise proof pipeline |
