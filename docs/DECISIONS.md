# Decision log

This file records decisions that constrain implementation. Proposed choices do
not become accepted architecture merely by appearing here.

## Accepted product decisions

- The product is human-first and uses AI only when it adds measurable value.
- The MVP begins with one reliably available BTC Event Contract cadence.
- Only real DreamDEX fills and finalized outcomes count toward player records.
- Friend challenges compare independent DreamDEX trades and do not custody
  participant funds.
- Custom Event Contract creation is outside the MVP.
- `CYS-EDGE-v1` uses round points equal to
  `100 × (result − filled outcome price)` and a skill score equal to
  `50 + average round points ÷ 2`.
- Stake size never affects rank, the first qualifying fill locks one call per
  player and market, and profiles remain provisional until ten settled,
  non-void rounds.
- Chain evidence is authoritative. Application persistence contains only
  rebuildable, formula-versioned derived state and social organization.
- The trading core is strict TypeScript split into deterministic domain modules
  and an injected DreamDEX SDK adapter, with no application framework.
- Core tests use Node's test runner through `tsx`; TypeScript, `tsx`, and Node
  types are development-only dependencies.
- The application uses React 19 with Vite, Wagmi over viem for explicit wallet
  authorization, and TanStack Query for wallet state. Its UI consumes the core
  adapter and does not reimplement chain rules.
- Public deployment configuration uses `VITE_DREAMDEX_OPERATOR_ID` and
  `VITE_DREAMDEX_VENUE_ID`; optional indexer and RPC overrides contain no keys.

See [DOMAIN_AND_SCORING.md](DOMAIN_AND_SCORING.md) for the approved policy.

## Open decisions requiring approval

| Decision | Needed before | Current constraint |
|---|---|---|
| Persistence technology and schema | Issue #3 implementation | Must store social organization, not replace chain truth |
| Identity policy | Issue #7 | Short wallet address by default; optional names need abuse controls |
| Hosting and CI/CD | Deployment phase | Requires explicit authorization |

## Known technical constraints

- Event Contracts use `@somnia-chain/markets-sdk`; DreamDEX's HTTP API does not
  expose Event Contract endpoints.
- Live indexed status may lag the contract, so writes require an on-chain gate.
- Finalized binary markets are not discovered through the ordinary live sweep.
- Mainnet USDso uses 18 decimals; transaction values require bigint tick and lot
  arithmetic.
- Pools are recycled across rolling windows, so pool address alone is not a
  durable market identity.
