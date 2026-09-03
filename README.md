# Call Your Shot

Call Your Shot is a human-first prediction league powered by DreamDEX Event
Contracts on Somnia. Players make real UP or DOWN trades on recurring crypto
price rounds and build a verifiable record based on decision quality rather
than account size.

## Status

The project is in its integration-validation phase. Application development
does not begin until the real DreamDEX market lifecycle has been verified.

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

## Repository policy

- Never work directly on `main`.
- Use one focused branch and pull request per issue.
- Review and verify each pull request before merging.
- Do not begin a dependent issue until its prerequisite pull request is merged.
- Never commit secrets, private keys, or wallet credentials.
- Do not use mock data as if it were live DreamDEX data.
