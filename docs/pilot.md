# Pilot guide (trial week)

How the gym moves from the paper sheet and the whiteboard to AMRAP for one trial week. The
success criterion (`PLAN.md`, Stage 4): the trainer runs one full week on AMRAP without the paper
sheet. The repo text is English; the parts the trainer and the customers read are Slovenian and
quote the app's own button names (`app/src/i18n/sl.ts`).

## Before day one (owner)

All on the hosted project, from an up-to-date `main`; steps in [runbook.md](runbook.md).

1. The Stage 1-4 migrations are pushed and checked ([Deploy migrations after
   merge](runbook.md#deploy-migrations-after-merge), or the `release-checklist` skill).
2. Push is on and was checked on a phone ([Turn on push
   notifications](runbook.md#turn-on-push-notifications), Stage 3 owner actions 1-8). Without
   it there are no reminders, and the reminder is the customer's only warning before a charge.
3. Cloudflare Pages serves `main`, with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
   `VITE_VAPID_PUBLIC_KEY` set; the auth URL settings and "Confirm email" off are done
   ([Cloudflare Pages build settings](runbook.md#cloudflare-pages-build-settings)).
4. The trainer account exists ([Bootstrap the trainer](runbook.md#bootstrap-the-trainer)).
5. On the trainer's phone: AMRAP opened from the home screen (install card), signed in as the
   trainer, **Vklopi obvestila** on **Nastavitve → Obvestila**.
6. The trainer has this guide's Slovenian parts (below) and the copy review
   ([copy-review.md](copy-review.md)) if it is not signed off yet.

## Prvi dan: nastavitev (trener)

Vse na telefonu, v aplikaciji AMRAP, prijavljeni kot trener. Papirnati list imejte ob sebi.

1. **Nastavitve → Odpoved:** koliko ur pred začetkom lahko stranka še
   brezplačno odpove (privzeto 5). Tapnite »Shrani«.
2. **Nastavitve → Urnik → Nov termin:** za vsak redni termin v tednu vpišite dan,
   začetek, trajanje (min) in število mest; »Aktiven (stranke ga vidijo in rezervirajo)« naj
   ostane označen. Tapnite »Shrani«.
   Ponovite za vse termine z whiteboarda.
3. **Nastavitve → Zaprta obdobja → Novo zaprto obdobje:** dopust ali zaprtje, ki ga že poznate
   (od, do, razlog). V tem času rezervacije niso mogoče. Novo zaprto obdobje ne odpove že
   rezerviranih terminov; aplikacija pove, koliko jih je, odpovejte jih v **Koledarju**
   (»Odpovej«).
4. **Stranke → Nova stranka:** za vsako stranko s papirnatega lista vpišite ime in priimek,
   telefon, po želji e-poštni naslov, in **Začetno stanje kreditov (s papirja)**:
   - ima še kredite (npr. 5): vpišite `5`;
   - je dolžna (npr. 2): vpišite `-2`;
   - stanje je 0: pustite prazno.

   Tapnite »Dodaj stranko«. Odpre se stran stranke. Če ste vpisali začetno stanje, je v razdelku
   »Zgodovina kreditov« vrstica z opombo »Začetno stanje (papir)«. Če se pokaže sporočilo, da
   začetnega stanja ni bilo mogoče vpisati, sta število in opomba v razdelku »Krediti« že
   izpolnjena: tapnite »Dodaj kredite« (pozitivno) ali »Popravi stanje« (negativno).
5. **Stalni termini** (na strani stranke): tapnite »Dodaj stalni termin«, izberite termin in
   znova tapnite »Dodaj stalni termin«.
   Aplikacija takoj rezervira ta termin za naslednje 4 tedne (sporočilo pove, koliko terminov).
6. **Povabilo** (na strani stranke, za vsako stranko, ki bo uporabljala aplikacijo): »Ustvari
   povabilo«, nato »Kopiraj« in povezavo pošljite stranki (SMS, WhatsApp) skupaj z besedilom
   spodaj. Povezava velja 7 dni; novo povabilo razveljavi prejšnje.
7. Stranke brez aplikacije ostanejo v aplikaciji kot zapis: njihove termine dodajate vi
   (**Koledar**, pri terminu »Dodaj stranko«, izberite stranko in »Dodaj«) in jih tudi
   odpoveste vi.

Na koncu primerjajte **Stranke** (stanje vsake stranke) s papirnatim listom.

## Besedilo za stranke (za posredovanje)

> Pozdravljeni! Termine in kredite odslej vodimo v aplikaciji AMRAP. Odprite povezavo spodaj in
> ustvarite račun (e-poštni naslov in geslo). Nato:
>
> 1. Dodajte AMRAP na začetni zaslon telefona (navodila so na vrhu aplikacije). Na iPhonu je to
>    nujno, sicer obvestila ne delujejo.
> 2. Na zaslonu **Domov** tapnite »Vklopi obvestila«. Uro pred rokom za brezplačno odpoved
>    dobite opomnik.
> 3. V **Koledarju** rezervirate prost termin (»Rezerviraj«), na zaslonu **Domov** ga odpoveste
>    (»Odpovej«).
>
> Odpoved do roka (5 ur pred začetkom) je brezplačna. Kasnejša odpoved ali termin, na katerega ne
> pridete, se zaračuna (1 kredit). Stanje in zgodovino kreditov vidite na zaslonu **Domov** in v
> **Zgodovini**.
>
> Povezava: <povezava za povabilo>

Če ste rok za brezplačno odpoved spremenili, popravite »5 ur« v besedilu.

## Med poskusnim tednom: dnevni pregled (trener)

Vsak dan, nekaj minut:

1. **Danes:** današnji termini z imeni rezerviranih strank. Kdo je prišel, aplikacija ne beleži:
   termin se zaračuna ob začetku, če ni bil pravočasno odpovedan.
2. **Danes → Dolžniki:** stranke z negativnim stanjem. Ko plačajo: na strani stranke vpišite
   število v »Krediti« in tapnite »Dodaj kredite«.
3. **Koledar → Termini zunaj urnika:** termini po dogovoru in rezervacije terminov, ki jih ni
   več v urniku. Preverite, ali so pravi.
4. **Obvestila na telefonu:** nove rezervacije in odpovedi strank.

Popravki:

- **Dopust ali zaprtje sredi tedna:** dodajte zaprto obdobje (**Nastavitve → Zaprta obdobja**). Že rezervirani
  termini v njem ostanejo in bi se zaračunali; odpovejte jih v **Koledarju** (»Odpovej«).
- **Termin odpoveste vi** (bolezen, dopust): **Koledar**, »Odpovej« pri stranki, »Odpovej
  termin«. Nikoli se ne zaračuna; že zaračunan termin se stranki vrne (+1).
- **Pozna odpoved, ki je ne želite zaračunati:** na strani stranke v »Krediti« vpišite `1`,
  opomba npr. »Oprostitev pozne odpovedi«, tapnite »Popravi stanje«.
- **Napačno vpisan kredit:** »Popravi stanje« z nasprotnim številom (npr. `-8`) in opombo.

Papirnati list vodite vzporedno le prve dni, kot rezervo. Ko se stanja v **Stranke** ujemajo z
listom, ga odložite.

## Owner: what to watch during the week

In the dashboard SQL editor of the hosted project, once a day:

- **Jobs ran:** `select j.jobname, d.status, d.start_time, d.return_message from
  cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 20;`
  (`charge_due_appointments` and `send_cutoff_reminders` every 15 minutes,
  `materialize_recurring` nightly; [jobs.md](jobs.md)).
- **Charges:** every started `booked` appointment became `charged` with one `session` row:
  `select count(*) from public.appointments where status = 'booked' and starts_at < now() -
  interval '20 minutes';` should be 0.
- **Reminders and pushes:** `select kind, created_at, dispatched_at from public.notifications
  order by created_at desc limit 20;` and `select id, status_code, content, error_msg from
  net._http_response order by id desc limit 10;` (kept 6 hours). In the `send-push` answer
  (`{"claimed":…,"sent":…,"failed":…,"removed":…}`) `failed` counts pushes a push service
  refused and `removed` devices it reported gone (their subscription is deleted; that customer
  enables notifications again). A gateway 401 means the `apikey` fallback in ADR 0009 is
  needed ([runbook.md](runbook.md#turn-on-push-notifications)). A customer without a device
  gets no notification row at all.
- **Pause risk:** the app's keep-alive read on every load keeps the project active; if nobody
  opens the app for days, check the dashboard for the inactivity warning
  ([Unpause](runbook.md#unpause-a-paused-supabase-project)).

## Prijava težav (trener)

Ko kaj ne deluje ali ni prav, pošljite lastniku aplikacije eno sporočilo z:

1. zaslonom (npr. **Koledar**, stran stranke) in kaj ste tapnili;
2. časom (dan in ura) in imenom stranke, če gre za stranko;
3. kaj se je zgodilo in kaj ste pričakovali;
4. posnetkom zaslona, če je mogoče.

Do odgovora vodite stvar na papirju; nič ne popravljajte dvakrat.

Owner triage: an error page "Podatkov ni mogoče naložiti" for everyone →
[Unpause](runbook.md#unpause-a-paused-supabase-project); one customer locked out → [Re-link a
customer](runbook.md#re-link-a-customer); no notifications → the "what to watch" queries above;
a wrong charge → `cron.job_run_details` and the customer's ledger, then a trainer adjustment.

## End of the week

- **Success criterion:** a full week with no entry on the paper sheet that AMRAP did not have.
- **Questions for the trainer:** open copy questions ([copy-review.md](copy-review.md)); should a
  trainer cancel notify the customer; does the trainer want a veto over self-bookings
  (`PLAN.md` open question 1); anything the customers asked about.
- **Record** the outcome (dates, problems reported, answers) in the Stage 4 GitHub issue.
