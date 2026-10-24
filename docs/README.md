# AMRAP documentation

| Doc | What it covers |
|---|---|
| [../CONTEXT.md](../CONTEXT.md) | Domain language and business rules |
| [harness.md](harness.md) | Repo conventions and gates (docs 1:1, ADRs, diagrams, skills, reviewer, pgTAP and Deno testing) |
| [pilot.md](pilot.md) | The trial week: owner prerequisites, the trainer's first-day setup and daily check (Slovenian), text for customers, what the owner watches, how to report problems |
| [runbook.md](runbook.md) | Operations: unpause, bootstrap trainer, invite and re-link a customer, deploy migrations and the edge function, database size check, turn on push, Cloudflare Pages |
| [adr/](adr/README.md) | Architecture decision records |
| [schema.md](schema.md) | Tables (including the `notifications` log), columns, constraints, indexes, RLS, grants, views `customer_balances` and `slot_occupancy`, helpers, migrations list |
| [rpcs.md](rpcs.md) | RPC reference: `book`, `cancel`, `top_up`, `adjust`, `create_invite`, `accept_invite`, `charge_due_appointments`, `materialize_recurring`, `activate_rule`, `deactivate_rule`, `send_cutoff_reminders`, `claim_notifications`, `save_push_subscription`, error tokens, helpers (including the notification triggers) |
| [jobs.md](jobs.md) | Scheduled jobs: pg_cron schedules for `charge_due_appointments()` and `send_cutoff_reminders()` (every 15 min) and `materialize_recurring()` (nightly); the `send-push` edge function |
| [notifications.md](notifications.md) | Web push: the notification log, kinds and their data, event triggers, subscriptions, service worker, no-duplicates rule, dispatch through pg_net, Vault config, best effort, manual check |
| [auth.md](auth.md) | App auth: session loading, customer-row lookup, role gating, lookup failed vs not linked, sign-out, invite acceptance, keep-alive, start-up error |
| [data-layer.md](data-layer.md) | App data layer: reads and RPC wrappers in `app/src/data/`, what each selects |
| [time.md](time.md) | Gym-timezone date math: local dates, weeks, template occurrences, DST, cutoff, formatting |
| [app-structure.md](app-structure.md) | App folders, install onboarding, i18n rule, data layer contract, testing with the fake Supabase client |
| [copy-review.md](copy-review.md) | Temporary: every UI string by screen for the trainer's sign-off (changes made, open questions); kept in step with `sl.ts` until sign-off, then deleted |
| [screens.md](screens.md) | Routes, role gating and strings of the customer and trainer screens |

## Architecture diagrams

- [System context](architecture/system-context.md)
- [Data model](architecture/data-model.md)
- [Appointment states](architecture/appointment-states.md)
- [Charging sequence](architecture/charging-sequence.md)
- [Booking sequence](architecture/booking-sequence.md)
- [Auth and invite flow](architecture/auth-invite-flow.md)
- [Materialization sequence](architecture/materialization-sequence.md)
- [Push sequence](architecture/push-sequence.md)
