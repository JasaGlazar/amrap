# Time and calendar

How the app turns slot templates into dates and times (`app/src/lib/time.ts`). The database
does the same in `book()` and `materialize_rule()` ([rpcs.md](rpcs.md)); the app must agree with
it, or a "Rezerviraj" click sends a start that `book()` rejects as `AMRAP_SLOT_MISMATCH`.

## Model

- **Instants** are JavaScript `Date`s. Timestamps from PostgREST (`2026-10-26T06:00:00+00:00`)
  are parsed with `new Date(...)` and compared with `getTime()`, never as strings (the app
  itself sends `toISOString()`, the `Z` form).
- **Local dates** are `YYYY-MM-DD` strings in the gym timezone (`settings.timezone`,
  `Europe/Ljubljana`). Day arithmetic (`addDays`, `weekdayOf`, `weekStart`) is done on them as
  UTC calendar dates, so it never depends on the browser's own timezone.
- **Weekdays** are numbered as in `slot_templates.weekday`: 0 = Monday … 6 = Sunday. A week
  starts on Monday.
- The timezone conversion uses `Intl.DateTimeFormat` with the gym timezone, the only timezone
  database a browser has; `Temporal` is not used.

- `parseLocalDate(value)` reads a local date from outside, such as the trainer calendar's
  `?dan=`: exactly `YYYY-MM-DD` and a real day (it must survive `addDays(value, 0)`), else
  `null`.
- `defaultDayOf(monday, today)` is the day a week opens on: today when today is in that week,
  otherwise the Monday.
- An instant belongs to the day `localDateOf(instant, timeZone)` in the gym timezone, never its
  UTC date: in the night of the autumn change, 00:30 on Sunday is 22:30 UTC on Saturday.

## Local time to instant

`zonedInstant(date, time, timeZone)` returns the instant whose wall-clock time in `timeZone`
is `date time`:

1. Treat `date time` as if it were UTC, read that instant's UTC offset in `timeZone`, and
   subtract it.
2. If the offset at the result differs (the guess crossed a DST change), subtract that
   offset instead.
3. Convert back; if the wall-clock time does not match, the time does not exist that day and
   the result is `null`.

So, as in Postgres (`(date + start_time) at time zone settings.timezone`):

- across a change the wall-clock time stays fixed (10:00 is 08:00 UTC on 2026-10-24 and
  09:00 UTC on 2026-10-26);
- a time inside the autumn fall-back hour (02:00–03:00 on the last Sunday of October) maps to
  the later instant, the one in winter time;
- a time inside the spring-forward gap (02:00–03:00 on the last Sunday of March) has no
  instant; that occurrence is not shown, `book()` could not match it and materialization skips
  it.

## Weeks and occurrences

- `weekRange(monday, timeZone)` is `[local midnight Monday, local midnight next Monday)`; a
  week that contains a DST change is 167 or 169 hours long. The calendar queries occupancy,
  blocked periods and the customer's own appointments for this range.
- `occurrenceInWeek(template, monday, timeZone)` is the template's occurrence in that week:
  date `monday + weekday`, `startsAt = zonedInstant(date, start_time)`,
  `endsAt = startsAt + duration_minutes`; `null` when the start time does not exist that day.
- `overlaps(a, b)` compares half-open ranges `[startsAt, endsAt)`, like the blocked-period
  check in `book()`: an occurrence that ends exactly when a block starts is not blocked.

## Cutoff

- `cutoffOf(startsAt, lateCancelHours)` is `startsAt − lateCancelHours` hours, from
  `settings.late_cancel_hours`.
- `isFreeCancel(startsAt, lateCancelHours, now)` is `now < cutoff`, the same comparison
  `cancel()` makes: at the cutoff itself the cancel is late. The app's answer is a preview; the
  server decides, so a clock difference near the cutoff can change the outcome.

## Remaining time

`timeUntil(instant, now)` splits the time left into days, hours and minutes, rounding minutes
up and never going below zero. `formatTimeUntil` (`i18n/fill.ts`) turns it into copy: days and
hours from one day up, hours and minutes under a day, minutes under an hour. The templates
(`time.*` in `sl.ts`, placeholders filled by `fill`) use abbreviations (`d`, `h`, `min`), so
no Slovenian plural forms are needed.

## Formatting

All display formatting is `Intl.DateTimeFormat('sl-SI')` in the gym timezone: `formatTime`
(`07:00`), `formatDay` (`pon., 26. 10.`), `formatLongDay` (`ponedeljek, 26. oktober`),
`formatDate` (`26. 10. 2026`), and `formatLocalDate` for a local date without a time.
`weekdayName(weekday)` is the lowercase name for use inside a sentence ("ponedeljek ob
07:00"); `weekdayHeading(weekday)` capitalises it for a heading or the start of a label
("Ponedeljek").

Times inside a day as minutes after midnight (the week grid, the overlap check) are in
`lib/schedule.ts`: `minutesOf('07:00:00')`, `endOf(template)` (start plus duration, may pass
midnight) and `clock(minutes)` back to `HH:MM` (wrapping past midnight). These are wall-clock
minutes of a template, not instants, so DST does not apply.
