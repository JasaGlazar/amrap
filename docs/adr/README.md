# Architecture Decision Records

One ADR per decision. An ADR is never deleted: when a decision changes, write a new ADR and
mark the old one `Status: Superseded by NNNN`.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-remove-qr-check-in.md) | Remove QR check-in in favour of cutoff-based charging | Accepted |
| [0002](0002-charge-timing.md) | Charge timing | Accepted |
| [0003](0003-ledger-only-balance.md) | Ledger-only balance with a partial unique index on charges | Accepted |
| [0004](0004-slot-templates-per-slot-capacity.md) | Slot templates with per-slot capacity | Accepted |
| [0005](0005-supabase-free-tier-cloudflare-pages.md) | Supabase free tier and Cloudflare Pages | Accepted |
| [0006](0006-auth-invite-token-password.md) | Email/password auth with invite tokens | Accepted |
| [0007](0007-relink-by-deleting-auth-user.md) | Re-link a customer by deleting their auth user | Accepted |
| [0008](0008-recurrence-and-occupancy.md) | Recurrence, blocked periods, slot occupancy and cron roles | Accepted |
| [0009](0009-web-push-design.md) | Web push through a notification log, pg_net and one edge function | Accepted |
| [0010](0010-visual-identity-and-themes.md) | Visual identity and themes | Accepted |
| [0011](0011-responsive-navigation-and-on-demand-forms.md) | Responsive navigation and on-demand forms | Accepted |
| [0013](0013-data-retention.md) | Data retention | Accepted |
| [0014](0014-wide-week-views.md) | Wide week views | Accepted |

## Template

File name: `NNNN-kebab-title.md`.

```markdown
# NNNN. <title>

Status: Accepted
Date: YYYY-MM-DD

## Context

What problem or force led to this decision?

## Decision

What we decided, in the active voice.

## Consequences

What becomes easier, what becomes harder, what follow-up it creates.
```

Status is `Accepted` or `Superseded by NNNN`.
