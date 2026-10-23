# AMRAP documentation

| Doc | What it covers |
|---|---|
| [../CONTEXT.md](../CONTEXT.md) | Domain language and business rules |
| [harness.md](harness.md) | Repo conventions and gates (docs 1:1, ADRs, diagrams, reviewer, pgTAP testing) |
| [runbook.md](runbook.md) | Operations: unpause, bootstrap trainer, deploy migrations, Cloudflare Pages |
| [adr/](adr/README.md) | Architecture decision records |
| [schema.md](schema.md) | Tables, columns, constraints, indexes, RLS, grants, view `customer_balances`, helpers, migrations list |
| [rpcs.md](rpcs.md) | RPC reference (filled in Task 3) |
| [jobs.md](jobs.md) | pg_cron jobs and edge functions (filled in Task 3) |
| [screens.md](screens.md) | Customer and trainer screens (filled in Task 4) |

## Architecture diagrams

- [System context](architecture/system-context.md)
- [Data model](architecture/data-model.md)
- [Appointment states](architecture/appointment-states.md)
- [Charging sequence](architecture/charging-sequence.md)
- [Booking sequence](architecture/booking-sequence.md)
- [Auth and invite flow](architecture/auth-invite-flow.md)
