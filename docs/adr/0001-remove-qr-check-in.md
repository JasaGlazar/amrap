# 0001. Remove QR check-in in favour of cutoff-based charging

Status: Accepted
Date: 2026-10-23

## Context

The first design (2026-08-25) charged a credit when the customer checked in by scanning a QR
code at the gym. The trainer runs a trust-based, non-commercial gym where some sessions are
never logged on paper today. A check-in step would reintroduce exactly the manual logging that
goes missing, and it needs a physical QR artefact, camera permissions and a fallback for
people who forget to scan.

## Decision

There is no check-in and no attendance event. Every `booked` appointment is charged the same
way: when it reaches its start time without having been cancelled, it is charged one credit.
A customer who cancels before the cutoff (`late_cancel_hours`, default 5) pays nothing; after
the cutoff the cancel is late and is charged. The trainer can cancel anything for free.

## Consequences

- Nobody has to log anything; the ledger stays correct even for unlogged sessions.
- A no-show is charged exactly like an attended session. This is intended.
- The customer's only warning before a charge is the pre-cutoff reminder push, so that
  reminder is required before the pilot (Stage 3).
- No QR, camera or attendance tables or screens exist; the appointment status set is
  `booked`, `charged`, `cancelled`, `cancelled_late`, `cancelled_by_trainer`.
- Trainer corrections (cancel with refund, adjustments) are the escape hatch when the
  automatic rule is wrong in a particular case.
