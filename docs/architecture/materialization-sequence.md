# Materialization sequence

How recurring rules become appointments. `materialize_recurring()` runs nightly from pg_cron
(as `postgres`, no signed-in user) or when the trainer calls it, and runs the private helper
`materialize_rule()` for every active rule of an active slot template; `activate_rule()` runs
the same helper for one rule. For each occurrence date from today through four weeks ahead
(local dates in `settings.timezone`), the helper builds `starts_at` from the date and the
template's `start_time` in the gym's timezone (DST-safe), skips past starts and starts that do
not exist that day, then takes the same advisory lock as `book()` and skips the occurrence if it
overlaps a blocked period (checked after the lock, so a concurrent `cancel_occurrence()` is
seen), if the rule already has an instance there (any
status, so a cancelled one is never recreated), if the customer is already booked at that
start, or if the slot is full. Otherwise it inserts a `booked` appointment with
`source = 'recurring'`. A second run inserts nothing. Details in
[rpcs.md](../rpcs.md#materialize_recurring).

```mermaid
sequenceDiagram
    participant Cron as pg_cron (02:00 UTC) or trainer app
    participant M as materialize_recurring()
    participant H as materialize_rule()
    participant R as recurring_rules and slot_templates
    participant BP as blocked_periods
    participant A as appointments

    Cron->>M: materialize_recurring(4)
    M->>M: auth.uid() is null or is_trainer(), else AMRAP_FORBIDDEN
    M->>R: active rules of active templates, by id
    loop each rule
        M->>H: materialize_rule(rule_id, 4)
        H->>R: lock rule for share, read template
        loop each occurrence date, today to today + 28 days
            H->>H: starts_at = (date + start_time) at time zone settings.timezone
            H->>H: skip if starts_at <= now() or start_time does not exist that day
            H->>H: pg_advisory_xact_lock(template + starts_at), same key as book()
            H->>BP: [starts_at, ends_at) overlaps a blocked period?
            BP-->>H: skip if so
            H->>A: instance of this rule at starts_at (any status)? customer live at starts_at? live count
            A-->>H: skip if instance exists, customer booked, or count >= capacity
            H->>A: insert booked, source recurring, rule_id
        end
        H-->>M: number inserted
    end
    M-->>Cron: total inserted (0 on a second run)
```
