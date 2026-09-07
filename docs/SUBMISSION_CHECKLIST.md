# Hackathon submission checklist

Status date: 2026-09-07

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
checkable skill record. Friend challenges use separate noncustodial trades, and
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
- [ ] Final two-to-three-minute demo video URL
- [ ] Real two-wallet challenge comparison from invitation through settlement
- [ ] Real Reown Project ID and mobile/QR acceptance evidence
- [x] Owner-approved MIT repository license
- [x] Owner-approved Node 22 continuous-integration workflow

The checked items are directly inspectable in the repository. The challenge's
two-call activation is complete, but its separate terminal-comparison item stays
unchecked until the shared Event Contract genuinely finalizes. The remaining
items require owner-controlled accounts or publishing and must remain unchecked
until completed.

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
7. disclose testnet status and any unfinished mobile/two-wallet acceptance;
8. never call transaction inclusion a fill or provisional profiles ranked.

## Judging alignment

| Criterion | What to show |
|---|---|
| Technical implementation | Multi-market discovery, chain/indexer binding, real book, bounded wallet approval/order, decoded fill, settlement and oracle proof |
| Innovation | A bankroll-neutral skill score and noncustodial human competition built from trading evidence |
| UX and design | Pick a market, choose YES/NO, cap risk, then inspect proof only when wanted |
| Business/ecosystem impact | Challenges and rematches create voluntary independent Event Contract trades and share verifiable DreamDEX receipts |
| Presentation/demo | One current call, one already-settled public receipt, one friend challenge, and a concise proof pipeline |
