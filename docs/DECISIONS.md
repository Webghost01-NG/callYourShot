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

## Open decisions requiring approval

| Decision | Needed before | Current constraint |
|---|---|---|
| Runtime and application framework | Issue #4 | Select only after the Phase 1 integration spike |
| Wallet connection library | Issue #5 | Must support Somnia and explicit user authorization |
| Persistence technology and schema | Issue #3 implementation | Must store social organization, not replace chain truth |
| Identity policy | Issue #7 | Short wallet address by default; optional names need abuse controls |
| Skill-score formula | Issue #3 completion | Must be transparent, probability-aware, and sample-size honest |
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
