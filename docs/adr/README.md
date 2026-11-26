# Architecture Decision Records

One ADR per decision. An ADR is never deleted: when a decision changes, write a new ADR and
mark the old one `Status: Superseded by NNNN` (or `Superseded in part by NNNN` when only part
of it changes).

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-remove-qr-check-in.md) | Remove QR check-in in favour of cutoff-based charging | Accepted |
| [0002](0002-charge-timing.md) | Charge timing | Accepted |
| [0003](0003-ledger-only-balance.md) | Ledger-only balance with a partial unique index on charges | Accepted |
| [0004](0004-slot-templates-per-slot-capacity.md) | Slot templates with per-slot capacity | Accepted |
| [0005](0005-supabase-free-tier-cloudflare-pages.md) | Supabase free tier and Cloudflare Pages | Superseded in part by 0012 |
| [0006](0006-auth-invite-token-password.md) | Email/password auth with invite tokens | Accepted |
| [0007](0007-relink-by-deleting-auth-user.md) | Re-link a customer by deleting their auth user | Accepted |
| [0008](0008-recurrence-and-occupancy.md) | Recurrence, blocked periods, slot occupancy and cron roles | Accepted |
| [0009](0009-web-push-design.md) | Web push through a notification log, pg_net and one edge function | Accepted |
| [0010](0010-visual-identity-and-themes.md) | Visual identity and themes | Accepted |
| [0011](0011-responsive-navigation-and-on-demand-forms.md) | Responsive navigation and on-demand forms | Accepted |
| [0012](0012-cloudflare-workers-static-assets.md) | Cloudflare Workers static assets instead of Cloudflare Pages | Accepted |
| [0013](0013-data-retention.md) | Data retention | Accepted |
| [0014](0014-wide-week-views.md) | Wide week views | Superseded in part by 0017 |
| [0015](0015-trainer-cancel-notifies-customer.md) | A trainer cancel notifies the customer, with an optional reason | Accepted |
| [0016](0016-cancel-occurrence-closes-it.md) | Cancelling a whole session closes it with a blocked period | Accepted |
| [0017](0017-centred-wide-views.md) | Centred wide views | Accepted |
| [0018](0018-customers-do-not-book-in-first-release.md) | Customers do not book in the first release | Accepted |
| [0019](0019-customers-see-the-calendar-read-only.md) | Customers see the calendar read-only | Accepted |

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

Status is `Accepted`, `Superseded by NNNN` or `Superseded in part by NNNN`.
