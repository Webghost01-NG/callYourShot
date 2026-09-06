# Call Your Shot

Call Your Shot is a human-first prediction league powered by DreamDEX Event
Contracts on Somnia. Players make real UP or DOWN trades on recurring crypto
price rounds and build a verifiable record based on decision quality rather
than account size.

## Status

The project has a live-round application, database-free verified skill
profiles, and an optional Supabase-backed social league. Trading, scoring, and
shared results remain backed by the DreamDEX integration core.

No market, transaction, settlement, wallet, or production result may be
fabricated. A missing integration must be reported as unavailable or blocked.

## Product promise

> Prove how well you can read the market, not how much money you have.

## Delivery order

1. Validate DreamDEX discovery, books, orders, fills, settlement, and redemption.
2. Define the domain model and transparent skill score.
3. Implement the framework-independent DreamDEX adapter.
4. Build the live prediction experience.
5. Add verified profiles, challenges, and leaderboards.
6. Harden the product and prepare the judge demo.

Work is tracked in [GitHub Issues](https://github.com/Webghost01-NG/callYourShot/issues).
See [the product brief](docs/PRODUCT.md), [engineering workflow](docs/ENGINEERING.md),
and [delivery roadmap](docs/ROADMAP.md) before contributing.

## DreamDEX validation harness

Issue #2 includes a local, wallet-controlled harness for reproducing testnet
order, complete-set, and redemption checks:

```bash
npm install
npm run validate:dreamdex
```

Open `http://127.0.0.1:4173`. The harness never receives a private key: it
prepares runtime-discovered transactions and the injected browser wallet signs
each transaction after showing it to the owner.

## Core verification

```bash
npm run typecheck
npm test
npm run build
```

The read-only live check additionally requires trusted DreamDEX origin values:

```bash
DREAMDEX_OPERATOR_ID=<id> DREAMDEX_VENUE_ID=<bytes32> npm run check:live
```

See [the approved core architecture](docs/ARCHITECTURE.md).
Profile derivation and evidence-failure behavior are specified in
[the reconciliation design](docs/PROFILE_RECONCILIATION.md).

Before presenting the project, follow the [judge demo runbook](docs/DEMO_RUNBOOK.md)
and review the [hardening and remaining-risk report](docs/HARDENING_REPORT.md).

The database-free profile can also be checked read-only from the command line.
The account is a public address; no private key is accepted or needed:

```bash
PROFILE_ACCOUNT=<address> DREAMDEX_OPERATOR_ID=<id> DREAMDEX_VENUE_ID=<bytes32> npm run check:profile
```

## Live application

Judge-accessible deployment: **https://call-your-shot-six.vercel.app**

The deployment intentionally fails closed when no eligible live DreamDEX round
or book is available. It never substitutes a sample market. Deployment evidence
and the remaining owner-operated checks are recorded in
[the release validation report](docs/RELEASE_VALIDATION.md).
Official Shannon endpoint health checks and whole-route recovery are documented
in [the endpoint recovery design](docs/ENDPOINT_RECOVERY.md).

Copy `.env.example` to `.env.local` and provide the public DreamDEX operator and
venue identity supplied by the event organizer. Never put wallet credentials in
an environment file.

```bash
npm run dev
```

The application discovers a bounded set of live binary Event Contracts from the
configured DreamDEX operator and venue. It verifies every candidate on-chain,
loads its real order book, and lets the player choose a market without reusing a
quote from another event. If discovery, verification, or every live book fails,
the interface reports that state instead of substituting sample data. An
injected wallet or configured WalletConnect mobile session authorizes each
bounded approval and trade; a submitted transaction is shown separately from a
verified fill. Mobile/QR connection requires the public
`VITE_REOWN_PROJECT_ID` described in
[the wallet connection guide](docs/WALLET_CONNECTION.md).

## Optional social league

Apply the approved migration to a Supabase project, enable Ethereum Web3 Auth,
and configure the application's exact local and deployed redirect URLs. Then
set only these public browser values:

```bash
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-legacy-anon-key>
```

If these values are absent, the application labels the league unconfigured and
does not display invented players. Never expose a service-role or secret key.
See [the persistence, authentication, RLS, privacy, and abuse design](docs/SOCIAL_COMPETITION.md).
The public board uses the bounded, chain-reverified candidate process described
in [the leaderboard snapshot design](docs/LEADERBOARD_SNAPSHOTS.md).

## Hackathon evidence

- [Genuine settled judge receipt](https://call-your-shot-six.vercel.app/?receiptWallet=0x6CeD8D6Bad8Dfd2e60BCEA116fE74548f959f1F2&receiptMarket=0x00000000000000000000000000000000000000000000000000000000000127a9) — rebuilt at runtime from the public DreamDEX fill and finalized Event Contract; it does not require a connected wallet, Supabase, or a currently liquid market
- [DreamDEX integration and transaction evidence](docs/DREAMDEX_VALIDATION.md)
- [Multi-market live discovery evidence](docs/MULTI_MARKET_VALIDATION.md)
- [SDK and documentation feedback](docs/DREAMDEX_FEEDBACK.md)
- [Judge demo runbook](docs/DEMO_RUNBOOK.md)
- [Release validation and rollback](docs/RELEASE_VALIDATION.md)

## Repository policy

- Never work directly on `main`.
- Use one focused branch and pull request per issue.
- Review and verify each pull request before merging.
- Do not begin a dependent issue until its prerequisite pull request is merged.
- Never commit secrets, private keys, or wallet credentials.
- Do not use mock data as if it were live DreamDEX data.
