# Copy review (Slovenian UI)

Every user-visible string of the app, screen by screen, for the trainer to read and sign off
before the pilot. The copy lives in `app/src/i18n/sl.ts` (the only place it may live, see
[app-structure.md](app-structure.md#i18n-rule)); this page mirrors it by hand and is temporary.

- **Until sign-off:** every commit that changes `sl.ts` updates the matching rows here (and the
  "Changes" table when it changes existing copy).
- **At sign-off** (an owner action): one commit applies the trainer's answers to `sl.ts`, moves
  any lasting decision (for example "vi" or "ti") into
  [app-structure.md](app-structure.md#i18n-rule), and deletes this file together with its
  entry in [README.md](README.md) and every mention of it (`.claude/agents/reviewer.md` item 5,
  the reviewer gate in [harness.md](harness.md#reviewer-gate)).

## Za trenerja: kako odgovoriti

Spodaj so vsa besedila aplikacije, razdeljena po zaslonih. Pri vsaki vrstici je lahko vprašanje.
Prosimo:

1. Preberite besedila, kot da ste stranka (zasloni »Stranka«) ali vi (zasloni »Trener«).
2. Pri vprašanjih izberite eno možnost ali napišite svojo.
3. Če vas kakšno drugo besedilo zmoti, pripišite ključ (npr. `calendar.book`) in boljše
   besedilo.
4. Odgovore pošljite lastniku aplikacije v enem sporočilu (posnetek zaslona tega dokumenta s
   pripisi je dovolj). Ko so vsa vprašanja odgovorjena, napišite »Besedila potrjena«.

## Conventions this pass applied

The copy conventions (formal "vi" in messages, short buttons, one Slovenian word per domain
term, plurals, punctuation) are in [app-structure.md](app-structure.md#i18n-rule). Dates and
times use `Intl.DateTimeFormat('sl-SI')` in the gym timezone (`pon., 26. 10.`, `ponedeljek, 26.
oktober`, `26. 10. 2026`, 24-hour `07:00`, [time.md](time.md)); no error found, the hour style
is a question below.

## Changes made in this pass

| Key | Before | After | Why |
|---|---|---|---|
| `settings.templateLine` + `settings.places` | `… · {capacity} mest` | `… · {places}` (1 mesto, 2 mesti, 3 mesta, 5 mest) | "1 mest" and "3 mest" were wrong |
| `cancelDialog.late` | Odpoved je prepozna: zaračunan 1 kredit. | Pozna odpoved: zaračunan bo 1 kredit. | Shown before confirming, so future tense; "pozna odpoved" is the term used everywhere else ("prepozna" suggests it is not allowed) |
| `cancelDialog.refund` | Odpoved s povračilom: stranki se vrne 1 kredit. | Odpoved z vračilom: stranki se vrne 1 kredit. | One term: the ledger says "Vračilo" |
| `customers.email` | E-pošta | E-poštni naslov | Same label as on the login and invite forms |
| `customers.inviteStatus.pending` | Povabljen | Povabilo čaka | The masculine form was wrong for women; describes the invite, not the person |
| `trainer.noOther` | Ni terminov zunaj urnika. | (removed) | Stage 10: the calendar shows "Termini zunaj urnika" only when a day has some (day view) or puts them in their day's column (week grid), like Today |
| `customerDetail.topUpInvalid` | Za polnitev vpišite pozitivno celo število. | Za dodajanje kreditov vpišite pozitivno celo število. | "polnitev" is used nowhere else; the button says "Dodaj kredite" |
| `customerDetail.relinkHint` | … sledite postopku »Re-link a customer« v priročniku (docs/runbook.md). | … naj skrbnik aplikacije odstrani njen stari račun; nato tukaj ustvarite novo povabilo. | English and a repository path in user-visible copy |
| `settings.strandedWarning` | … (Koledar, Termini zunaj urnika). Za potrditev znova kliknite Shrani. | … (»Koledar«, »Termini zunaj urnika«). Za potrditev znova tapnite »Shrani«. | Quoted names; "tapnite" on a phone |
| `pushToggle.needsInstall` | … tapnite Deli, nato Dodaj na začetni zaslon, in aplikacijo odprite … | … tapnite »Deli« in nato »Dodaj na začetni zaslon«, potem pa aplikacijo odprite … | No comma before "in"; quoted names, as in the install card |
| `errors.AMRAP_ALREADY_BOOKED` | Za ta termin ste že rezervirani. | Rezervacija za ta termin že obstaja. | Calque ("rezervirani" are slots, not people), and the trainer sees it too when adding a customer |
| `errors.AMRAP_CAPACITY_FULL` | Ta termin je že zaseden. | Ta termin je že poln. | Same word as the calendar's "Polno" |
| `login.submit` | Prijava | Prijavi se | Stage 5: the page said "Prijava" twice (heading and button); the button names the action |
| `invite.title` | Ustvari račun | Nov račun | Stage 5: heading and button were the same; the heading names the page, the button keeps the action |
| `customerDetail.refund` (new) | Odpovej (`slot.cancel`) | Vrni kredit | Stage 5: on a charged session the action cancels with a refund; "Odpovej" hid that |
| `customers.startingBalance` | Začetno stanje kreditov (s papirja) | Začetno stanje kreditov | Stage 8 (issue #20): the owner removed "(s papirja)"; the hint under the field is unchanged |
| `settings.templateLine` (removed) | {weekday} ob {time} · {minutes} min · {places} | `settings.slotDetails` ({minutes} min · {places}) under a day heading, `settings.timeRange` in the week grid | Stage 9 (issue #16): the list of lowercase lines became day groups on a phone and a week grid from 768 px; the day is now the heading |

## Open questions for the trainer

1. **Vi ali ti?** Aplikacija strank vika. Je to prav za vašo telovadnico, ali raje tikanje?
2. **Gumbi:** ostanejo kratki (»Rezerviraj«, »Poskusi znova«) ali vljudni (»Poskusite znova«)?
3. **Beseda »kredit«:** jo stranke razumejo, ali raje »obisk« / »termin«?
4. **Zaračunan termin** se v zgodovini imenuje »Opravljeno« (tudi če stranke ni bilo) in v
   kreditih »Vadba«. Raje »Zaračunano« in »Termin«?
5. **»Odpovedal trener«** je v moški obliki; nevtralno »Odpoved trenerja«?
6. **»Dolžniki«** na zaslonu Danes: v redu ali raje »Negativno stanje«?
7. **Stranke, prazen seznam:** ko seznam izprazni samo filter (npr. »Dolžniki«, ko nihče nima
   dolga, iskanje pa je prazno), piše »Ni strank, ki bi ustrezale iskanju.« in gumb
   »Počisti iskanje« (ki ponastavi tudi filter). Je to v redu, ali raje npr. »Ni strank za ta
   prikaz.« in »Pokaži vse«?
8. Vsa ostala vprašanja so v tabelah spodaj (stolpec »Vprašanje«).

## All copy by screen

### Prijava (login)

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `login.title` | Prijava |  |
| `login.email` | E-poštni naslov |  |
| `login.password` | Geslo |  |
| `login.submit` | Prijavi se | Spremenjeno (prej »Prijava«, enako kot naslov). V redu? |
| `login.submitting` | Prijavljanje … |  |
| `authErrors.invalid_credentials` | Napačen e-poštni naslov ali geslo. |  |
| `authErrors.user_already_exists` | Račun s tem e-poštnim naslovom že obstaja. |  |
| `authErrors.weak_password` | Geslo je prešibko. |  |
| `authErrors.email_not_confirmed` | E-poštni naslov ni potrjen. Obrnite se na trenerja. |  |
| `authErrors.over_request_rate_limit` | Preveč poskusov. Poskusite znova čez nekaj minut. |  |

### Povabilo in nov račun (invite)

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `invite.title` | Nov račun | Spremenjeno (prej »Ustvari račun«, enako kot gumb). V redu? |
| `invite.intro` | Z računom boste lahko rezervirali termine in spremljali svoje kredite. |  |
| `invite.email` | E-poštni naslov |  |
| `invite.password` | Geslo |  |
| `invite.confirmPassword` | Ponovite geslo |  |
| `invite.submit` | Ustvari račun |  |
| `invite.submitting` | Ustvarjanje računa … |  |
| `invite.passwordMismatch` | Gesli se ne ujemata. |  |
| `invite.passwordTooShort` | Geslo mora imeti vsaj 6 znakov. |  |
| `invite.noSession` | Račun je ustvarjen, vendar prijava ni uspela. Poskusite se prijaviti. |  |

### Stanja aplikacije (napake, nepovezan račun)

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `app.name` | AMRAP |  |
| `common.loading` | Nalaganje … | V redu, ali raje »Nalagam …«? |
| `common.loadFailed` | Podatkov ni mogoče naložiti. |  |
| `common.showMore` | Pokaži več | Novo (Stage 8). Pod dolgimi seznami (Zgodovina; pri stranki opravljeni termini in zgodovina kreditov): naloži naslednjih 10 vrstic. Med nalaganjem gumb kaže `common.loading`, ob napaki se nad njim pokaže `common.loadFailed`. |
| `common.signOut` | Odjava |  |
| `common.continue` | Nadaljuj |  |
| `common.cancel` | Prekliči | Zapre odprt obrazec brez shranjevanja (nova stranka, termin po dogovoru, stalni termin, podatki, dodajanje stranke v termin). |
| `notLinked.title` | Račun ni povezan |  |
| `notLinked.body` | Vaš račun še ni povezan s stranko. Za povezavo se obrnite na trenerja. | »povezan s stranko« zveni nerodno. Predlog: »Vaš račun še ni povezan z vašimi podatki pri trenerju.« |
| `lookupFailed.title` | Podatkov ni mogoče naložiti |  |
| `lookupFailed.body` | Povezava s strežnikom ni uspela. Preverite internet in poskusite znova. |  |
| `lookupFailed.retry` | Poskusi znova |  |
| `startupError.title` | Aplikacije ni mogoče zagnati |  |
| `startupError.body` | Nastavitve strežnika manjkajo ali niso veljavne. Obrnite se na skrbnika. |  |
| `logoutFailed.title` | Odjava ni uspela |  |
| `genericError` | Nekaj je šlo narobe. Poskusite znova. |  |

### Račun (meni v zgornji vrstici)

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `account.menu` | Račun | Ime gumba z ikono osebe (bralniki zaslona ga preberejo). V redu? |
| `account.appearance` | Videz |  |
| `account.theme.system` | Sistem | Sledi nastavitvi telefona. Raje »Kot naprava«? |
| `account.theme.light` | Svetlo |  |
| `account.theme.dark` | Temno |  |

### Navigacija

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `nav.customerLabel` | Glavni meni |  |
| `nav.trainerLabel` | Glavni meni trenerja |  |
| `nav.home` | Domov |  |
| `nav.calendar` | Koledar |  |
| `nav.history` | Zgodovina |  |
| `nav.today` | Danes |  |
| `nav.customers` | Stranke |  |
| `nav.settings` | Nastavitve |  |

### Namestitev aplikacije (kartica na vrhu)

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `install.title` | Namestite aplikacijo |  |
| `install.why` | Dodajte AMRAP na začetni zaslon: odprete ga z enim dotikom, kot vsako aplikacijo. | Je razlog dovolj jasen? |
| `install.iosWhyCustomer` | Na iPhonu obvestila delujejo le v aplikaciji, odprti z začetnega zaslona. Brez nje ne prejmete opomnika pred rokom za brezplačno odpoved, edinega opozorila, preden se termin zaračuna. | Le stranke na iPhonu. Dovolj jasno, zakaj je namestitev pomembna? |
| `install.iosWhyTrainer` | Na iPhonu obvestila o rezervacijah in odpovedih strank delujejo le v aplikaciji, odprti z začetnega zaslona. | Le trener na iPhonu. |
| `install.install` | Namesti aplikacijo |  |
| `install.notNow` | Ne zdaj |  |
| `install.stepsLabel` | Koraki za namestitev |  |
| `install.iosShare` | V Safariju tapnite »Deli« (kvadrat s puščico navzgor). |  |
| `install.iosAdd` | Izberite »Dodaj na začetni zaslon« in potrdite z »Dodaj«. |  |
| `install.iosOtherBrowsers` | V drugih brskalnikih na iPhonu je »Deli« v meniju brskalnika. | Je ta namig razumljiv, ali ga izpustimo? |
| `install.androidMenu` | Odprite meni brskalnika (⋮). |  |
| `install.androidAdd` | Izberite »Namesti aplikacijo« ali »Dodaj na začetni zaslon«. |  |
| `install.openFromHome` | AMRAP odslej odpirajte z ikone na začetnem zaslonu. |  |

### Stranka: Domov

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `customer.balanceLabel` | Stanje kreditov | Ali stranke govorijo o »kreditih«, ali raje »obiski« / »termini«? (Velja za vse besede s »kredit«.) |
| `customer.debt` | dolg | Oznaka ob negativnem stanju: »dolg« v redu? |
| `customer.nextLabel` | Naslednji termin |  |
| `customer.upcomingTitle` | Prihajajoči termini |  |
| `customer.noUpcoming` | Ni prihajajočih terminov. |  |
| `customer.calendarTitle` | Koledar |  |
| `customer.historyTitle` | Zgodovina |  |
| `slot.when` | {day} ob {time} | Ura kot »07:00« ali »7.00«? |
| `slot.duration` | {minutes} min |  |
| `slot.cancel` | Odpovej |  |
| `time.inDaysHours` | čez {days} d {hours} h | »čez 2 d 9 h«: je okrajšava »d« razumljiva, ali raje »čez 2 dni in 9 ur«? |
| `time.inHoursMinutes` | čez {hours} h {minutes} min |  |
| `time.inMinutes` | čez {minutes} min |  |

### Stranka: Koledar

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `calendar.previousWeek` | Prejšnji teden |  |
| `calendar.nextWeek` | Naslednji teden |  |
| `calendar.previousArrow` | ‹ |  |
| `calendar.nextArrow` | › |  |
| `calendar.weekRange` | {from} – {to} |  |
| `calendar.noSlots` | Ta teden ni terminov. |  |
| `calendar.spots` | Prosta mesta: {free} od {capacity} | »Prosta mesta: 3 od 5« ali »Prostih mest: 3 od 5«? |
| `calendar.book` | Rezerviraj |  |
| `calendar.full` | Polno |  |
| `calendar.blocked` | Zaprto | »Zaprto« za termin v zaprtem obdobju (dopust): v redu? |
| `calendar.mine` | Rezervirano |  |
| `calendar.booked` | Termin je rezerviran. |  |

### Odpoved termina (okno)

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `cancelDialog.title` | Odpoved termina |  |
| `cancelDialog.cutoff` | Brezplačna odpoved do {day} ob {time}. |  |
| `cancelDialog.free` | Odpoved je brezplačna. |  |
| `cancelDialog.late` | Pozna odpoved: zaračunan bo 1 kredit. | Spremenjeno (glej zgoraj). V redu? |
| `cancelDialog.confirm` | Odpovej termin |  |
| `cancelDialog.back` | Nazaj |  |
| `cancelDialog.done` | Termin je odpovedan. |  |
| `cancelDialog.noCharge` | Stranki se kredit ne zaračuna. |  |
| `cancelDialog.refund` | Odpoved z vračilom: stranki se vrne 1 kredit. |  |
| `cancelDialog.reason` | Razlog (neobvezno) | Novo (Stage 11): polje le v trenerjevem oknu za odpoved; razlog dobi stranka v obvestilu in ga vidi v zgodovini. |

### Stranka: Zgodovina

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `history.appointmentsTitle` | Termini |  |
| `history.noAppointments` | Ni preteklih terminov. |  |
| `history.ledgerTitle` | Krediti |  |
| `history.noTransactions` | Ni transakcij. | »Ni transakcij« je tehnično. Predlog: »Ni sprememb kreditov.« |
| `history.reason` | Razlog: {reason} | Novo (Stage 11): pod datumom termina, ki ga je trener odpovedal z razlogom (stranka v Zgodovini, trener pri stranki). |
| `appointmentStatus.booked` | Rezervirano |  |
| `appointmentStatus.charged` | Opravljeno | Termin, ki je bil zaračunan, je označen »Opravljeno«, tudi če stranka ni prišla. Raje »Zaračunano«? |
| `appointmentStatus.cancelled` | Odpovedano |  |
| `appointmentStatus.cancelled_late` | Pozna odpoved |  |
| `appointmentStatus.cancelled_by_trainer` | Odpovedal trener | Moška oblika. Trenerka: »Odpovedala trenerka«? Ali nevtralno »Odpoved trenerja«? |
| `transactionType.topup` | Nakup kreditov | V aplikaciji gumb »Dodaj kredite«, v zgodovini »Nakup kreditov«. V redu, ali enotno? |
| `transactionType.session` | Vadba | Vrstica za zaračunan termin: »Vadba« ali »Termin«? |
| `transactionType.late_cancel` | Pozna odpoved |  |
| `transactionType.refund` | Vračilo |  |
| `transactionType.adjustment` | Popravek |  |

### Trener: Danes in Koledar

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `trainer.todayTitle` | Danes |  |
| `trainer.calendarTitle` | Koledar |  |
| `trainer.customersTitle` | Stranke |  |
| `trainer.settingsTitle` | Nastavitve |  |
| `trainer.noSlotsToday` | Danes ni terminov. |  |
| `trainer.debtorsTitle` | Dolžniki | »Dolžniki« je lahko neprijazno. Raje »Negativno stanje«? |
| `trainer.noDebtors` | Nihče nima negativnega stanja. |  |
| `trainer.nobodyBooked` | Ni prijavljenih strank. | »prijavljenih« ali »rezerviranih« strank? |
| `trainer.days` | Dnevi v tednu | Ni vidno: ime vrstice z gumbi za dneve v koledarju na telefonu (bralnik zaslona). |
| `trainer.noSlotsOnDay` | Ta dan ni terminov. | Koledar na telefonu, izbran dan brez terminov. |
| `trainer.todayTag` | danes | Oznaka današnjega stolpca v tedenskem koledarju na računalniku. |
| `trainer.cancelOccurrence` | Odpovej termin | Novo (Stage 11): gumb pod vsakim terminom v Koledarju, ki odpove termin vsem prijavljenim strankam in ga zapre. |
| `occurrenceDialog.title` | Odpoved celega termina | Novo (Stage 11): naslov okna za odpoved celega termina. |
| `occurrenceDialog.booked` | Prijavljenih strank: {count} | Novo (Stage 11): nad seznamom imen v oknu. |
| `occurrenceDialog.refund` | Strankam z oznako »opravljeno« se kredit vrne. | Novo (Stage 11): le ko je kdo termin že plačal. |
| `occurrenceDialog.notify` | Stranke prejmejo obvestilo o odpovedi; razlog vidijo tudi v svoji zgodovini. | Novo (Stage 11). Obvestilo prejmejo le stranke z vklopljenimi obvestili; je stavek dovolj natančen? |
| `occurrenceDialog.reopen` | Termin bo zaprt, zato ga nihče ne bo mogel rezervirati. Znova ga odprete tako, da izbrišete njegovo zaprto obdobje v »Nastavitve« → »Zaprta obdobja«; odpovedane rezervacije ostanejo odpovedane. | Novo (Stage 11). |
| `occurrenceDialog.confirm` | Odpovej termin | Novo (Stage 11): potrditev v oknu (enako kot gumb v Koledarju). |
| `occurrenceDialog.done` | Termin je odpovedan, obveščenih strank: {count}. | Novo (Stage 11), besedilo lastnika. Število je število odpovedanih rezervacij; obvestilo na napravo dobijo le stranke z vklopljenimi obvestili, ostale odpoved vidijo v zgodovini. Raje »odpovedanih rezervacij: 3«? |
| `occurrenceDialog.doneEmpty` | Termin je odpovedan in zaprt. | Novo (Stage 11): ko v terminu ni bilo nikogar. |
| `trainer.chargedTag` | opravljeno | Isto vprašanje kot »Opravljeno« zgoraj. |
| `trainer.addCustomer` | Dodaj stranko | Gumb pri terminu v koledarju; odpre izbiro stranke. Ko je termin poln ali zaprt, gumb namesto tega pokaže »Polno« ali »Zaprto«. Enako besedilo ima gumb, ki ustvari novo stranko (`customers.create`), čeprav gre za drugo dejanje: je to v redu, ali naj bo tukaj »Prijavi stranko« ali »Dodaj v termin«? |
| `trainer.noneToAdd` | Ni strank za dodajanje | Onemogočen gumb pri terminu, ko ni nobene stranke, ki bi jo lahko dodali (vse so že prijavljene ali pa strank še ni). |
| `trainer.addTo` | Stranka za termin {when} |  |
| `trainer.chooseCustomer` | Izberi stranko |  |
| `trainer.add` | Dodaj |  |
| `trainer.added` | Stranka je dodana. |  |
| `trainer.otherTitle` | Termini zunaj urnika |  |
| `trainer.adHocTag` | po dogovoru |  |
| `trainer.offGridTag` | ni več v urniku |  |
| `trainer.timeRange` | {from}–{to} |  |
| `trainer.unknownCustomer` | Neznana stranka |  |
| `trainer.adHocFormTitle` | Nov termin po dogovoru |  |
| `trainer.customer` | Stranka |  |
| `trainer.date` | Datum |  |
| `trainer.start` | Začetek |  |
| `trainer.end` | Konec |  |
| `trainer.adHocSubmit` | Dodaj termin |  |
| `trainer.invalidRange` | Konec mora biti po začetku. |  |
| `trainer.invalidTime` | Ta čas na ta dan ne obstaja. |  |
| `trainer.missingCustomer` | Izberite stranko. |  |

### Trener: Stranke

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `customers.newTitle` | Nova stranka |  |
| `customers.name` | Ime in priimek |  |
| `customers.phone` | Telefon |  |
| `customers.email` | E-poštni naslov |  |
| `customers.create` | Dodaj stranko | Enako besedilo kot gumb pri terminu v koledarju (`trainer.addCustomer`), ki stranko doda v termin. Je to v redu, ali naj bo tukaj »Ustvari stranko«? |
| `customers.startingBalance` | Začetno stanje kreditov | Spremenjeno (prej »Začetno stanje kreditov (s papirja)«, lastnik je »(s papirja)« odstranil). |
| `customers.startingHint` | Neobvezno. Pozitivno število doda kredite, negativno vpiše dolg. | Novo. |
| `customers.startingInvalid` | Začetno stanje mora biti celo število (lahko negativno) ali prazno. | Novo. |
| `customers.nameRequired` | Vpišite ime. |  |
| `customers.noCustomers` | Ni strank. |  |
| `customers.listTitle` | Vse stranke |  |
| `customers.inviteStatus.linked` | Povezan račun | V redu? |
| `customers.inviteStatus.pending` | Povabilo čaka | Spremenjeno (prej »Povabljen«, moška oblika). V redu? |
| `customers.inviteStatus.none` | Brez računa |  |
| `customers.search` | Išči stranko | Novo (iskanje po imenu, telefonu in e-pošti). |
| `customers.searchPlaceholder` | Ime, telefon ali e-pošta | Novo. |
| `customers.filterLabel` | Prikaži | Novo: ime skupine gumbov za filtre (bralnik zaslona). |
| `customers.filters.vsi` | Vsi | Novo. |
| `customers.filters.dolzniki` | Dolžniki | Novo. |
| `customers.filters.brez` | Brez računa | Novo. Vključuje tudi stranke s čakajočim povabilom. |
| `customers.total` | 1 stranka, 2 stranki, 3 stranke, 5 strank | Novo. |
| `customers.shown` | Prikazana 1 od 9, Prikazani 2 od 9, Prikazane 3 od 9, Prikazanih 5 od 9 | Novo. V redu, ali raje »Prikazanih: 5 od 9« za vsa števila? |
| `customers.noMatches` | Ni strank, ki bi ustrezale iskanju. | Novo. |
| `customers.clearSearch` | Počisti iskanje | Novo: počisti iskanje in filter. |

### Trener: Stranka (podrobnosti)

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `customerDetail.back` | Nazaj na stranke |  |
| `customerDetail.detailsTitle` | Podatki |  |
| `customerDetail.editDetails` | Uredi podatke | Gumb, ki odpre obrazec s podatki stranke (ime, telefon, e-pošta). |
| `customerDetail.notGiven` | Ni podatka | Namesto telefona ali e-pošte, ki ju ni. |
| `customerDetail.save` | Shrani |  |
| `customerDetail.saved` | Podatki so shranjeni. |  |
| `customerDetail.creditsTitle` | Krediti |  |
| `customerDetail.amount` | Število kreditov |  |
| `customerDetail.note` | Opomba |  |
| `customerDetail.topUp` | Dodaj kredite |  |
| `customerDetail.adjust` | Popravi stanje | »Popravi stanje« za popravek (tudi za odpis pozne odpovedi z +1): razumljivo? |
| `customerDetail.topUpInvalid` | Za dodajanje kreditov vpišite pozitivno celo število. |  |
| `customerDetail.adjustInvalid` | Za popravek vpišite celo število, različno od 0 (negativno odšteje). |  |
| `customerDetail.creditsSaved` | Stanje je posodobljeno. |  |
| `customerDetail.startingNote` | Začetno stanje (papir) | Novo: opomba pri začetnem stanju v zgodovini kreditov; vidijo jo tudi stranke. V redu? |
| `customerDetail.startingFailed` | Stranka je dodana, začetnega stanja pa ni bilo mogoče vpisati ({error}). Vpišite ga tukaj. | Novo. |
| `customerDetail.inviteTitle` | Povabilo |  |
| `customerDetail.createInvite` | Ustvari povabilo |  |
| `customerDetail.newInvite` | Ustvari novo povabilo |  |
| `customerDetail.inviteCreated` | Povabilo je ustvarjeno. |  |
| `customerDetail.inviteLink` | Povezava za povabilo |  |
| `customerDetail.inviteHint` | Povezavo pošljite stranki. Velja 7 dni; novo povabilo razveljavi prejšnje. |  |
| `customerDetail.copy` | Kopiraj |  |
| `customerDetail.copied` | Povezava je kopirana. |  |
| `customerDetail.copyFailed` | Kopiranje ni uspelo. Povezavo označite in kopirajte ročno. |  |
| `customerDetail.relinkHint` | Račun je povezan. Če stranka izgubi dostop (na primer pozabi geslo), naj skrbnik aplikacije odstrani njen stari račun; nato tukaj ustvarite novo povabilo. | Spremenjeno (prej angleško besedilo). V redu? |
| `customerDetail.rulesTitle` | Stalni termini |  |
| `customerDetail.noRules` | Ni stalnih terminov. |  |
| `customerDetail.ruleLabel` | {weekday} ob {time} |  |
| `customerDetail.unknownTemplate` | Neznan termin |  |
| `customerDetail.ruleInactive` | ustavljen |  |
| `customerDetail.chooseTemplate` | Izberi termin |  |
| `customerDetail.addRule` | Dodaj stalni termin |  |
| `customerDetail.addRuleLabel` | Nov stalni termin |  |
| `customerDetail.ruleTemplate` | Termin | Izbira termina v obrazcu »Nov stalni termin«. |
| `customerDetail.stopRule` | Ustavi |  |
| `customerDetail.restartRule` | Ponovno vključi |  |
| `customerDetail.ruleStarted` | Stalni termin je vključen. Novih terminov: {count}. |  |
| `customerDetail.ruleStopped` | Stalni termin je ustavljen. Odpovedanih terminov: {count}. |  |
| `customerDetail.upcomingTitle` | Prihajajoči termini |  |
| `customerDetail.recentTitle` | Opravljeni termini (zadnjih {days} dni) |  |
| `customerDetail.noRecent` | V tem obdobju ni opravljenih terminov. |  |
| `customerDetail.refund` | Vrni kredit | Gumb pri opravljenem terminu: odpove termin in stranki vrne kredit. Novo (prej »Odpovej«, kot pri prihajajočih). V redu? |
| `customerDetail.historyTitle` | Zgodovina terminov | Novo (Stage 11): vsi pretekli in odpovedani termini stranke s stanjem in razlogom odpovedi, kot jih vidi stranka. |
| `customerDetail.ledgerTitle` | Zgodovina kreditov |  |

### Trener: Nastavitve

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `settings.sectionsLabel` | Razdelki nastavitev | Ime vrstice zavihkov (bralnik zaslona) |
| `settings.tabs.templates` | Urnik |  |
| `settings.tabs.cutoff` | Odpoved | Zavihek z rokom za brezplačno odpoved. Dovolj jasno ali »Rok odpovedi«? |
| `settings.tabs.blocked` | Zaprta obdobja |  |
| `settings.tabs.notifications` | Obvestila |  |
| `settings.templatesTitle` | Termini v tednu | »Termini v tednu« ali »Tedenski urnik«? |
| `settings.noTemplates` | Ni terminov. |  |
| `settings.timeRange` | {start}–{end} | Novo: čas v bloku tedenskega urnika (»07:00–08:00«). |
| `settings.slotDetails` | {minutes} min · {places} | Novo: vrstica pod dnevom na telefonu (»60 min · 5 mest«). |
| `settings.blockLabel` | {day} {time}, {minutes} min, {places}{marks}, uredi | Novo: ime gumba za bralnik zaslona (»Ponedeljek 07:00, 60 min, 5 mest, uredi«; pri neaktivnem še », neaktiven«, pri prekrivanju », prekrivanje«). |
| `settings.places.one` | {count} mesto |  |
| `settings.places.two` | {count} mesti |  |
| `settings.places.few` | {count} mesta |  |
| `settings.places.other` | {count} mest |  |
| `settings.inactive` | neaktiven |  |
| `settings.overlapping` | prekrivanje | Novo: oznaka termina, ki se prekriva z drugim aktivnim terminom istega dne. V redu, ali »se prekriva«? |
| `settings.overlapLegend` | Črtkan rob: termin se prekriva z drugim. | Novo: razlaga nad tedenskim urnikom, ko se kakšna termina prekrivata. |
| `settings.overlapSlot` | {weekday} ob {time} ({minutes} min) | Novo: termin v opozorilu (»ponedeljek ob 07:00 (60 min)«). |
| `settings.overlapWarning.single` | Prekriva se s terminom {slots}. | Novo: opozorilo pri shranjevanju termina, ki se prekriva z enim drugim; sledi mu `settings.confirmAgain`. |
| `settings.overlapWarning.pair` | Prekriva se s terminoma {slots}. | Novo: z dvema (»… s terminoma ponedeljek ob 07:00 (60 min) in ponedeljek ob 07:30 (60 min)«). |
| `settings.overlapWarning.several` | Prekriva se s termini {slots}. | Novo: s tremi ali več. |
| `settings.confirmAgain` | Za potrditev znova tapnite »Shrani«. | Novo: za opozorilom o prekrivanju (enak stavek kot na koncu `settings.strandedWarning`; ko sta obe opozorili, se pokaže le enkrat). |
| `settings.inactiveLegend` | Pikčast rob: neaktiven termin. | Novo: razlaga nad tedenskim urnikom, ko je kakšen termin neaktiven. |
| `settings.newTemplate` | Nov termin |  |
| `settings.editTemplate` | Uredi termin |  |
| `settings.weekday` | Dan |  |
| `settings.startTime` | Začetek |  |
| `settings.duration` | Trajanje (min) |  |
| `settings.capacity` | Število mest |  |
| `settings.active` | Aktiven (stranke ga vidijo in rezervirajo) | Razlaga v oklepaju: v redu? |
| `settings.edit` | Uredi |  |
| `settings.save` | Shrani |  |
| `settings.cancelEdit` | Prekliči |  |
| `settings.saved` | Shranjeno. |  |
| `settings.startRequired` | Vpišite začetek. |  |
| `settings.strandedWarning` | Prihodnje rezervacije tega termina: {count}. Ostanejo rezervirane in bodo zaračunane, dokler jih ne odpoveste (»Koledar«, »Termini zunaj urnika«). Za potrditev znova tapnite »Shrani«. |  |
| `settings.durationInvalid` | Trajanje mora biti pozitivno celo število minut. |  |
| `settings.capacityInvalid` | Število mest mora biti pozitivno celo število. |  |
| `settings.cutoffTitle` | Rok za brezplačno odpoved |  |
| `settings.cutoffHours` | Ur pred začetkom | Oznaka polja: »Ur pred začetkom« razumljiva? |
| `settings.cutoffInvalid` | Vpišite celo število ur, 0 ali več. |  |
| `settings.blockedTitle` | Zaprta obdobja |  |
| `settings.noBlocked` | Ni prihajajočih zaprtih obdobij. |  |
| `settings.blockedLine` | {from} – {to} |  |
| `settings.newBlocked` | Novo zaprto obdobje |  |
| `settings.editBlocked` | Uredi zaprto obdobje |  |
| `settings.fromDate` | Od (datum) |  |
| `settings.fromTime` | Od (ura) |  |
| `settings.toDate` | Do (datum) |  |
| `settings.toTime` | Do (ura) |  |
| `settings.reason` | Razlog |  |
| `settings.blockedOverlapWarning` | V tem obdobju je rezerviranih terminov: {count}. Zaprto obdobje jih ne odpove; ostanejo rezervirani in bodo zaračunani, dokler jih ne odpoveste v »Koledarju« (»Odpovej«). Za potrditev znova tapnite »Shrani«. | Novo (Task 18 review). Razumljivo? |
| `settings.delete` | Izbriši |  |

### Obvestila na telefonu in stikalo za obvestila

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `push.reminderTitle` | Opomnik: termin {day} ob {time} |  |
| `push.reminderBody` | Brezplačna odpoved je možna do {cutoff}. Potem bo termin zaračunan. | Najpomembnejše obvestilo (edino opozorilo pred zaračunanjem). Je dovolj jasno? |
| `push.bookingCreatedTitle` | Nova rezervacija |  |
| `push.bookingCancelledTitle` | Odpoved termina |  |
| `push.bookingCancelledLateTitle` | Pozna odpoved termina |  |
| `push.bookingBody` | {name}: {day} ob {time} |  |
| `push.topupTitle` | Dodani krediti |  |
| `push.topupBody` | Dodano: {amount}. Novo stanje: {balance}. | »Dodano: +8. Novo stanje: 10.« ali »Dodanih 8 kreditov, novo stanje 10.«? |
| `push.adjustmentTitle` | Popravek stanja kreditov |  |
| `push.adjustmentBody` | Popravek: {amount}. Novo stanje: {balance}. |  |
| `push.withNote` | {body} Opomba: {note} |  |
| `push.trainerCancelledTitle` | Termin je odpovedan | Novo (Stage 11): naslov obvestila stranki, ko trener odpove njen termin. |
| `push.trainerCancelledBody` | Trener je odpovedal termin {day} ob {time}. | Novo (Stage 11). Primer: »Trener je odpovedal termin ponedeljek, 26. oktober ob 07:00.« |
| `push.withRefund` | {body} Kredit je vrnjen. | Novo (Stage 11): doda se, ko je bil termin že zaračunan in je kredit vrnjen. |
| `push.withReason` | {body} Razlog: {reason} | Novo (Stage 11): doda se na konec, ko je trener vpisal razlog. |
| `push.genericTitle` | AMRAP |  |
| `push.genericBody` | Imate novo obvestilo. |  |
| `pushToggle.title` | Obvestila |  |
| `pushToggle.customerHint` | Opomnik pred rokom za brezplačno odpoved ter obvestila o kreditih. |  |
| `pushToggle.trainerHint` | Obvestila o rezervacijah in odpovedih strank. |  |
| `pushToggle.on` | Obvestila so na tej napravi vklopljena. |  |
| `pushToggle.off` | Obvestila so na tej napravi izklopljena. |  |
| `pushToggle.enable` | Vklopi obvestila |  |
| `pushToggle.disable` | Izklopi obvestila |  |
| `pushToggle.enabled` | Obvestila so vklopljena. |  |
| `pushToggle.disabled` | Obvestila so izklopljena. |  |
| `pushToggle.blocked` | Obvestila so v brskalniku blokirana. Dovolite jih v nastavitvah brskalnika. |  |
| `pushToggle.denied` | Obvestila niso dovoljena. |  |
| `pushToggle.failed` | Obvestil ni bilo mogoče vklopiti. Poskusite znova. |  |
| `pushToggle.needsInstall` | Na iPhonu obvestila delujejo le v nameščeni aplikaciji: v Safariju tapnite »Deli« in nato »Dodaj na začetni zaslon«, potem pa aplikacijo odprite z začetnega zaslona. |  |
| `pushToggle.needsInstallSeeCard` | Na iPhonu obvestila delujejo le v nameščeni aplikaciji. Navodila za namestitev so zgoraj. |  |
| `pushToggle.unsupported` | Ta brskalnik ne podpira obvestil. |  |
| `pushToggle.noKey` | Obvestila trenutno niso na voljo. |  |

### Sporočila o napakah

| Ključ | Besedilo | Vprašanje |
|---|---|---|
| `errors.AMRAP_ALREADY_BOOKED` | Rezervacija za ta termin že obstaja. | Spremenjeno (prej »Za ta termin ste že rezervirani.«; to vidi tudi trener). V redu? |
| `errors.AMRAP_ALREADY_LINKED` | Ta račun je že povezan s stranko. |  |
| `errors.AMRAP_BLOCKED` | V tem času rezervacije niso mogoče. |  |
| `errors.AMRAP_CAPACITY_FULL` | Ta termin je že poln. |  |
| `errors.AMRAP_FORBIDDEN` | Za to dejanje nimate dovoljenja. |  |
| `errors.AMRAP_INVALID_ARGUMENT` | Podatki niso veljavni. |  |
| `errors.AMRAP_INVITE_INVALID` | Povabilo ni veljavno ali je poteklo. Prosite trenerja za novo povezavo. |  |
| `errors.AMRAP_INVITE_USED` | To povabilo je že uporabljeno. |  |
| `errors.AMRAP_IN_PAST` | Termina v preteklosti ni mogoče rezervirati. |  |
| `errors.AMRAP_NOT_CANCELLABLE` | Tega termina ni mogoče odpovedati. |  |
| `errors.AMRAP_NOT_FOUND` | Zapisa ni mogoče najti. |  |
| `errors.AMRAP_SETTINGS_MISSING` | Nastavitve niso na voljo. Obrnite se na trenerja. |  |
| `errors.AMRAP_SLOT_INACTIVE` | Ta termin ni več na voljo. |  |
| `errors.AMRAP_SLOT_MISMATCH` | Čas ne ustreza izbranemu terminu. |  |
