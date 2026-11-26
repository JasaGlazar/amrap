# Free slots overview for customers — design

Date: 2026-11-26. Status: Approved by the owner on 2026-11-26.

## Intent

The gym owner asked that everyone can see which sessions are free ("vsi pregled nad termine
kateri so prosti"). The developer reads this as a view only: a customer sees free places and
asks the trainer for one; the trainer still assigns every appointment. This must be confirmed
with the gym owner. The design costs little if the answer is different, because customer
booking is already behind one setting.

This is a small change on top of the minimal customer scope
(`2026-11-19-minimal-customer-scope-design.md`, PR #30). That work hides the customer calendar
while booking is off. This design shows it again, read-only.

## Goals

1. Every customer sees the week grid with the free places of each session, also while
   `settings.customer_booking_enabled` is false.
2. While booking is off, the grid has no way to book.
3. Turning the setting on brings the book buttons back, with no further change.

## Non-goals

- Customers booking or asking for a place from the app. A request button is a possible later
  step.
- Showing who is in a session. Customers see counts only, as today (`slot_occupancy`).
- A view for people who are not signed in.
- Any database change. `book()` keeps refusing customers while the setting is off.

## Approaches

| Approach | Trade-off |
|---|---|
| A. Show the existing customer calendar always; the setting only decides whether it has book buttons | Reuses the screen, the data and the tests. Removes the route guard PR #30 added. **Chosen.** |
| B. A new read-only "free sessions" screen beside the hidden calendar | Two screens that show the same data. Rejected. |
| C. Turn customer booking on | Not what the developer understood from the owner. One setting away if the owner wants it. Rejected for now. |

## Design

- **Navigation:** the customer shell always shows »Koledar«. The route `/c/koledar` always
  renders. The redirect to `/c` and the "render nothing while loading" guard from PR #30 go
  away.
- **Calendar, booking off:** each session row shows what it shows today: time, »Prosta mesta:
  n od m«, »Zaprto« for a blocked period. In place of the »Rezerviraj« button a full session
  shows the »Polno« tag and a free one shows nothing. The customer's own appointment keeps the
  »Rezervirano« tag and the »Odpovej« button.
- **Hint:** one line above the grid while booking is off: "Za prost termin se dogovorite s
  trenerjem." (final copy by the builder, per `docs/copy-review.md`).
- **Fail closed:** while the settings load or if the read fails, the calendar shows no book
  buttons. The database refuses a booking in any case.
- **Calendar, booking on:** unchanged from today.
- **Trainer side:** unchanged. When a customer asks for a free place, the trainer books them
  into that session from the trainer calendar, as today.

## Tests

- Vitest: with booking off the »Koledar« link shows, the route renders, free counts show, no
  »Rezerviraj« button exists, the hint shows, the customer's own appointment can still be
  cancelled; with booking on the buttons are back; a failed settings read shows no buttons.
- The tests PR #30 added for the hidden link and the redirect are replaced by these.
- No pgTAP change.

## Docs

`docs/screens.md`. ADR 0019 records the read-only calendar, and ADR 0018 gets a pointer to it.
`docs/pilot.md` customer steps mention the free-places view; `docs/runbook.md` "Turn customer
booking on" says that the calendar is already visible and the setting only adds the buttons.

## Where it lands

A separate small pull request after PR #30 merges, so PR #30 stays as reviewed.

## Open question for the gym owner

Does "pregled" mean view only, or should customers also sign up for a free session themselves?
If they should, the change is the setting `customer_booking_enabled = true` and this design's
read-only state is never seen.
