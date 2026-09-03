# Engineering workflow

## Required issue lifecycle

1. Select the next unblocked GitHub issue.
2. Confirm its dependencies and acceptance criteria.
3. Synchronize `main` with `origin/main`.
4. Create one focused branch named for that issue.
5. Implement only the accepted scope.
6. Run the relevant automated and manual verification.
7. Review the complete diff and remaining risks.
8. Create an imperative, focused commit.
9. Push the branch and open a pull request linked to the issue.
10. Merge only after explicit user approval.
11. Start the next issue only after the prerequisite merge.

## Branch and commit conventions

- Branches: `feat/<issue>-<description>`, `fix/<issue>-<description>`, or
  `docs/<issue>-<description>`.
- Commits: imperative Conventional Commit style, for example
  `docs: establish repository foundation`.
- Pull requests must include intent, verification, risks, and linked issues.

## Data integrity

- Never hardcode a rolling market ID or pool address.
- Key persistent market data by DreamDEX `marketId`.
- Resolve current contracts and market parameters from official SDK or on-chain
  sources at runtime.
- Keep transaction prices and quantities in exact integer units until display.
- Never turn an unavailable upstream response into an empty successful state.
- Never label fixtures, examples, or cached snapshots as current live data.
- Store transaction hashes and explorer links only when returned by real calls.

## Safety gates

Explicit approval is required before changing:

- application architecture or framework;
- production dependencies;
- persistence schemas;
- public API contracts;
- CI/CD or hosting configuration;
- authentication, wallet, or security-sensitive configuration;
- smart contracts or custody assumptions.

Stop when credentials, funding, network access, or product policy is missing.
Document the blocker rather than bypassing it.

## Verification baseline

Each pull request must add or update verification proportional to its risk.
Integration work must distinguish read-only checks, dry-run preparation, signed
transactions, mined transactions, fills, settlements, and redemptions.
