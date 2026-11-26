# Self-registration — design

Date: 2026-11-19. Status: the five open decisions were settled by the owner on 2026-11-26; waiting for final approval.

## Intent

The gym will hang a QR code on the wall. A new customer scans it, registers in the app, and the
trainer then gives them fixed appointments. Today the order is the other way round: the trainer
creates the customer record and sends an invite link ([ADR 0006](../../adr/0006-auth-invite-token-password.md)).

This is the third of three projects. It builds on the minimal customer scope
(`2026-11-19-minimal-customer-scope-design.md`) and adds one browser test to the suite from
`2026-11-19-browser-tests-in-ci-design.md`.

## Goals

1. A person who scans the QR code can create an account and a customer record without the
   trainer doing anything first.
2. After registering, the customer sees a clear "the trainer will assign your sessions" state.
3. The trainer notices new registrations and can assign fixed appointments to them.
4. Someone who was never in the gym cannot fill the customer list with fake records.
5. Customers who already have a record from the trainer can still be linked to it.

## Non-goals

- Google or other social sign-in. It can be added later without rework.
- Email confirmation and self-service password reset. Supabase's built-in email is limited to
  2 emails per hour and is not for production (ADR 0006). A lost password is still handled by
  the trainer ([ADR 0007](../../adr/0007-relink-by-deleting-auth-user.md)).
- A trainer approval step before the account works. A new account has no appointments and no
  credits until the trainer acts, so there is nothing to protect with an approval.
- Merging two customer records.
- A captcha.

## Anti-goals

- A second way to become a trainer. Registration only ever creates the role `customer`.
- A registration that leaves an account with no customer record and no way forward.
- Personal data of other customers visible to a new account.

## Constraints

- All writes that create or link customer records go through `SECURITY DEFINER` RPCs with
  explicit checks, as `accept_invite` does.
- Role comes from the `customers` row, never from auth metadata (ADR 0006).
- Supabase free tier. No new services.
- Migrations follow the `new-migration` skill. UI copy is Slovenian in `app/src/i18n/sl.ts`.

## Approaches

**Creating the customer record**

| Approach | Trade-off |
|---|---|
| A. The app signs up, then calls a new RPC `register_customer` | Same pattern as `accept_invite`, testable in pgTAP, clear errors. If the second step fails, the account has no record yet; the app must offer to finish. **Chosen.** |
| B. A database trigger on `auth.users` creates the record from sign-up metadata | One step for the app, but it puts our logic in Supabase's auth schema, a failure blocks every sign-up including the trainer's, and it trusts user-editable metadata for the name. Rejected. |
| C. An edge function that does both with the service key | Atomic, but adds a second deployed function and a path that bypasses RLS. Rejected. |

**Who may register**

| Approach | Trade-off |
|---|---|
| A. Anyone who has the link | Simplest. The link is public once someone shares it, so anyone can add records to the trainer's list. |
| B. The link carries a gym code that the database checks | A person must have seen the QR code. The trainer can change the code if it leaks, and then prints a new QR. One settings column and one check. **Chosen.** |
| C. Trainer approves each registration | Strongest, but it adds a step and a screen, and the trainer already controls everything that matters (appointments, credits). Rejected. |

## Design

### 1. Database

- `settings.registration_code text` — the gym code. Null means registration is closed. Only the
  trainer can read or change it; customers and signed-out users cannot read it. (Today a
  customer can read the whole `settings` row, so the builder must keep the code out of that
  read: a separate one-row table readable only by the trainer is the simplest way.)
- `customers.registered_at timestamptz` — set when a record is created by registration, null
  for records the trainer created. It drives the "new" marker in section 4.
- New RPC:

  ```
  public.register_customer(p_name text, p_phone text, p_code text) returns uuid
  ```

  Checks, in order:
  1. A signed-in user → else `AMRAP_FORBIDDEN`.
  2. The user is not linked to a customer record yet → else `AMRAP_ALREADY_LINKED`.
  3. Registration is open and `p_code` equals the gym code → else new error
     `AMRAP_REGISTRATION_CLOSED` (one error for "closed" and "wrong code", so the code cannot
     be guessed from the answer).
  4. `p_name` trimmed is 2 to 80 characters; `p_phone` trimmed is 6 to 30 characters (the
     phone number is required) → else `AMRAP_INVALID_ARGUMENT`.

  Effect: one `customers` row with role `customer`, the name, the phone, the email of the auth
  user, `auth_user_id = auth.uid()` and `registered_at = now()`. Returns its id. Granted to
  `authenticated`.
- New RPC `set_registration_code(p_code text)` for the trainer: sets or clears the code. A code
  is 8 or more characters. The app generates a random one; the trainer never types it.

### 2. Registration page

Route `/registracija`, outside `RequireAuth`, like `/invite/:token`. The QR code holds
`https://<app address>/registracija?koda=<gym code>`.

1. Fields: name, phone, email, password, password again. All are required.
2. Client checks as on the invite page: password at least 6 characters and both equal; name and
   phone not empty.
3. `supabase.auth.signUp`. If the account already exists, the page signs in with the same
   password, as the invite page does. A wrong password shows "an account with this email
   exists, sign in" with a link to `/login`.
4. `register_customer(name, phone, code)`. A refusal shows its `errors.AMRAP_*` copy.
5. `refresh()` the auth state and go to `/`, which lands on the customer Home.

A visit without `?koda=` shows no form, only copy that tells the person to scan the code in the
gym, so no account is created without a code. A wrong code is refused after submit with the
same advice.

### 3. An account without a record

If step 4 fails or the browser closes between steps 3 and 4, the user has an account and no
customer record. Today that shows `NotLinkedPage` with sign out only. New behaviour:

- `NotLinkedPage` keeps its text and adds a link "finish registration" to `/registracija`.
- `/registracija` for a signed-in user without a record shows only the name and phone fields
  and runs step 4. It needs the code in the address, so the person scans the QR again.
- A signed-in user who has a record and opens `/registracija` is redirected to `/`.

### 4. What the customer and the trainer see

- **Customer Home, no appointments yet:** an empty state: the trainer will assign your
  sessions, and you will see them here. The install card and the notification switch show as
  usual, so the customer can turn on notifications at once.
- **Trainer's customer list:** a "Nov" tag on records with `registered_at` set and no recurring
  rule yet, and a filter for them. The tag goes away when the trainer adds the first fixed
  appointment.
- **Trainer push:** a new notification kind `customer_registered` (name of the new customer,
  opens the customer's page). Without it the trainer only finds out by opening the list.
- **Trainer Settings, new section "Registracija":** shows whether registration is open, the
  full link, a copy button, "new code" (the old QR stops working; the page says so before the
  trainer confirms) and "close registration".

### 5. The QR code

The QR is the link from Settings turned into an image. This design does not add a QR library
to the app. `docs/runbook.md` gets a section "Print the registration QR": copy the link from
Settings, make the QR with any generator, print it. A new code means a new print.

### 6. Existing invites

The invite flow stays as it is. It is the way to link a person to a record the trainer already
has, for example a customer imported with a credit balance. The trainer's customer page keeps
the invite button for unlinked records.

If a person with an existing record registers through the QR instead, there are two records.
The runbook describes the fix: the trainer keeps the record that has the history, deletes the
new record and its auth user, and sends an invite for the old one.

For that, and to remove fake registrations, the trainer needs to delete a record. New RPC
`delete_customer(p_customer_id)`: trainer only, and only for a record with no appointments and
no credit transactions (`AMRAP_NOT_DELETABLE` otherwise), never for a trainer record. A delete
button shows on the customer's page when the record qualifies. The auth user is deleted in the
Supabase dashboard, as in ADR 0007; a user whose record is gone sees the page from section 3.

### 7. Docs

A new ADR "Customers register themselves with a gym code" that refines ADR 0006 (invites are no
longer the only way in; email is still unconfirmed, so the gym code is the proof that a person
was in the gym). Updates to `docs/auth.md`, `docs/rpcs.md`, `docs/schema.md`,
`docs/screens.md`, `docs/notifications.md`, `docs/runbook.md`, `docs/pilot.md`, `CONTEXT.md`
(terms: registration, gym code) and the auth flow diagram.

## Tests

- **pgTAP:** every check of `register_customer`, one test each; a second call by the same user
  is refused; the row has role `customer` whatever is passed; a customer and a signed-out user
  cannot read the gym code; `set_registration_code` is trainer only; `delete_customer` refuses
  a record with history and a trainer record; `customer_registered` is written for the trainer.
- **Vitest:** the page's client checks, the account-exists path, the finish-registration path,
  the redirect for a linked user, the empty Home state, the "Nov" tag and the Settings section.
- **Browser test** (`registration.spec.ts`): open the link with the code, register, land on the
  empty Home; the trainer sees the new customer with the tag, assigns a fixed appointment, and
  the customer sees it. A wrong code is refused.

## Decisions by the owner (2026-11-26)

1. **Gym code in the QR link:** yes.
2. **Phone number:** required.
3. **Invite flow:** kept.
4. **Push to the trainer on each registration:** yes.
5. **QR image:** made outside the app; the owner handles it.

## Left to the builder

- Where the gym code is stored so that customers cannot read it (section 1).
- The Slovenian copy, in the style of `docs/copy-review.md`.
- Migration split and task order, following the `new-migration` skill.

## Owner actions after merge

- `supabase db push` and the release checklist.
- Open registration in Settings, print the QR, hang it in the gym.
- Check in the Supabase dashboard that sign-ups are allowed and that the sign-up rate limit
  suits a busy evening at the gym.
