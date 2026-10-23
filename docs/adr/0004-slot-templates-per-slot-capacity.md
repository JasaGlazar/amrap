# 0004. Slot templates with per-slot capacity

Status: Accepted
Date: 2026-10-23

## Context

The trainer has a fixed weekly grid of sessions, mostly attended by several customers at once,
plus occasional ad-hoc times. Different slots have different sizes and lengths. A single
global capacity or fixed duration would not fit.

## Decision

- The weekly grid is stored as `slot_templates`: weekday, start time, `duration_minutes`
  (default 60, any value allowed), `capacity` (default 5) and `active`.
- A slot is a concrete dated occurrence of a template. Recurring rules reference a template and
  are materialized into appointments; customers self-book open slots.
- Capacity is enforced inside `book`: it takes a lock, counts appointments in that slot with
  status `booked` or `charged`, compares with the template's capacity, then inserts.
  Cancelled statuses do not occupy a place.
- Trainer-created ad-hoc appointments have no template (`slot_template_id` is null).

## Consequences

- Duration and capacity are configurable per slot without schema changes.
- Capacity checks and inserts must be serialized per slot (lock) to avoid overbooking.
- A `charged` appointment still counts toward capacity, which matters for the slot that is
  currently in progress.
- Tests need boundary cases (exactly full, one over) and custom duration/capacity.
