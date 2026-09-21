# Legal pages

CozyNights has a **legal notice** (Impressum, `/legal-notice`), a **privacy policy** (`/privacy`) and **booking rules** (`/booking-rules`). Every page links to all three: the start page and the map in their footers, all other pages at the bottom, and these docs under every page. The booking dialogs link the booking rules too. German visitors who type `/impressum` or `/datenschutz` are redirected.

Like the whole app, the pages are **in English**. Visitors can let their browser translate them.

The wording lives in the repository. **Who runs the site** (name, address, contact, register entry) does not: the repository is public, and an address committed once stays in its history for good. Each environment reads these details from its own server `.env`.

::: warning Not legal advice
The texts are a careful starting point that matches what CozyNights really does. Before the first real event, compare them with a generator such as eRecht24 or Datenschutz-Generator.de, or have someone qualified read them.
:::

## What the pages say

| Page             | Content                                                                                                                                                                                                                                              |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/legal-notice`  | Provider details under § 5 DDG, contact, register entry, VAT ID if set, a disclaimer (content, links, availability, booking a bed, copyright)                                                                                                        |
| `/privacy`       | Controller, hosting, server logs, the brake on guessing ticket codes, ticket codes, e-mail addresses, bookings and booking passes, crew sign-in with Google, browser storage, the docs on GitHub Pages, e-mail contact, recipients, rights incl. the right to object. Once they are set up, also the booking e-mails, the Telegram option for guests and the crew group ([Notifications](./notifications)). Special-needs requests: explicit consent under Art. 9 GDPR, encryption, who reads them, deletion ([Special-needs requests](./special-needs)) |
| `/booking-rules` | Only Indoor memberships include a bed, when and how to book, special-needs spots (ask the crew, the crew decides and changes a spot it booked), no claim to a particular bed (the crew may move people and writes to them), burner names, fair play, consent and Leave No Trace in the houses |

Left out on purpose:

- **No link to the EU online dispute resolution platform (ODR).** The platform was shut down on 20 July 2025. A leftover link is now misleading and can draw a warning letter.
- **No consumer arbitration statement (VSBG).** Only required from eleven employees upwards.
- **No cookie banner.** CozyNights only sets cookies it can't work without (ticket code, crew session, sign-in protection). They need no consent (§ 25 Abs. 2 TDDDG). Tracking, analytics or embedded third-party content would change that, and the privacy policy with it.
- **No data protection officer.** An association only needs one when at least 20 people regularly process personal data (§ 38 BDSG).
- **No "responsible for the content" (§ 18 Abs. 2 MStV)** unless you set it: it is only required for journalistic-editorial content. The old "V.i.S.d.P. § 55 Abs. 2 RStV" wording is outdated since 2020.

## Settings on the server

The details are `LEGAL_*` variables in the environment's `.env`, next to the other settings. `deploy/staging.env.template` has the block with comments. Write the values in English, like the pages. Put values with spaces or special characters in 'single quotes'; multi-line values separate their lines with `|`.

| Variable                      | Needed          | What goes in                                                                                                   |
| :---------------------------- | :-------------- | :------------------------------------------------------------------------------------------------------------- |
| `LEGAL_NAME`                  | **yes**         | The provider incl. legal form, e.g. `'Musterverein e.V.'`                                                      |
| `LEGAL_ADDRESS`               | **yes**         | A street address where letters can be served, no P.O. box, e.g. `'Musterstraße 1\|20095 Hamburg\|Germany'`     |
| `LEGAL_EMAIL`                 | **yes**         | General contact address                                                                                        |
| `LEGAL_HOSTER`                | **yes**         | The hosting company, e.g. `'Hetzner Online GmbH\|Industriestr. 25\|91710 Gunzenhausen\|Germany'`               |
| `LEGAL_MAIL_PROVIDER`         | with e-mail     | The service that sends the booking e-mails (your processor), e.g. `'Name\|Address\|Country'`                   |
| `LEGAL_PHONE`                 | recommended     | A second fast way to reach you                                                                                 |
| `LEGAL_REPRESENTATIVE`        | associations    | The board members who represent it (§ 26 BGB), e.g. `'the board: Erika Muster (chair)'`                        |
| `LEGAL_REGISTER`              | if registered   | e.g. `'Register of associations: Amtsgericht Hamburg, VR 12345'`                                               |
| `LEGAL_VAT_ID`                | if you have one | VAT identification number (USt-IdNr.); a tax number (Steuernummer) is not needed                               |
| `LEGAL_CONTENT_RESPONSIBLE`   | rarely          | Only for journalistic-editorial content (§ 18 Abs. 2 MStV): `'Name\|Address'`                                  |
| `LEGAL_PRIVACY_EMAIL`         | optional        | A separate address for privacy requests; otherwise `LEGAL_EMAIL`                                               |
| `LEGAL_SUPERVISORY_AUTHORITY` | optional        | The data protection authority of the provider's state                                                          |
| `LEGAL_LOG_RETENTION_DAYS`    | optional        | How long nginx keeps access logs; default `14`                                                                 |
| `LEGAL_DELETION_PERIOD`       | optional        | When bookings and the ticket list are deleted; default _at the latest four weeks after the end of the event_   |
| `LEGAL_TERMS_URL`             | once published  | Link to the membership terms at the ticket shop, a full `https://` address                                     |
| `LEGAL_CODE_OF_CONDUCT_URL`   | recommended     | Link to the event's code of conduct (Hamburn: `https://hamburn.de/code-of-conduct`); the booking rules link it. A full `https://` address |

While one of the four required values is missing, the pages show a red note for the operators (*Note for the operators: details are missing on this server (…)*) and the app log names the missing variables on the first visit. `LEGAL_MAIL_PROVIDER` isn't part of that note: while the server sends e-mail and the value is missing, the privacy policy shows *Mail service missing (LEGAL_MAIL_PROVIDER)* in its section on booking e-mails instead, so read that page once mail is set up.

The privacy policy asks PocketBase which messages this server sends: the sections on booking e-mails, on Telegram for guests and on the crew group only appear once e-mail or the Telegram bot is set up. Telegram runs outside the EU, so guests only get messages there after their own consent (they press START in the bot's chat).

The app reads `.env` only when its container is created. After editing it, deploy again or recreate just the app container (as root on the server):

```bash
source /etc/cozynights/deploy-staging.conf
cd "$APP_DIR/hamburn-cozynights"
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f docker-compose.staging.yml up -d --no-deps --force-recreate app
```

## Booking rules and membership terms

Hamburn is sold as memberships in the ticket shop. **Only Indoor memberships include a bed**; Camper memberships (camper or tent) don't. So only Indoor memberships go into the ticket list, and the booking rules say so.

The bed is part of the membership, so the booking rules are rules of use, not a contract of their own. The contract is the purchase in the ticket shop: **membership terms** belong there, where buyers accept them before paying. As of September 2026 none are published, so the app doesn't mention them; once they are, set `LEGAL_TERMS_URL` and the booking rules and the legal notice link them. The Hamburn Code of Conduct already exists: set `LEGAL_CODE_OF_CONDUCT_URL`, and the booking rules point to it instead of repeating it.

The ticket list holds the ticket codes and the buyers' e-mail addresses, so the crew can reach guests about their bed. Importing them is described in the [event checklist](./event-checklist#ticket-codes).

## Before going live

- [ ] **Every public environment is filled in**, staging included: it is reachable from the internet too. No red note on the legal pages.
- [ ] **Data processing agreement with the hoster.** The privacy policy says one exists. Hetzner offers it in the account settings of its console.
- [ ] **Data processing agreement with the mail service**, which is named in `LEGAL_MAIL_PROVIDER`.
- [ ] **Telegram sections checked**: consent for guests, and the crew group, which gets admins' e-mail addresses on sign-ins and access changes.
- [ ] **Special-needs section checked**: the consent text on `/special-needs` (quoted in [Special-needs requests](./special-needs#privacy)) and the privacy section. What guests write there is often health data (Art. 9 GDPR); only admins read it, and it is deleted with `forget-contacts` after the event.
- [ ] **Server location.** The privacy policy says the server is in the EU.
- [ ] **Log retention matches.** nginx rotates its logs after as many days as `LEGAL_LOG_RETENTION_DAYS` says (Debian default: 14 days, `/etc/logrotate.d/nginx`).
- [ ] **Deletion after the event is planned** within the period the privacy policy names. See [After the burn](./event-checklist#after-the-burn).
- [ ] **Membership terms published** with the ticket shop and linked with `LEGAL_TERMS_URL`. The booking rules must not contradict them.
- [ ] **Texts checked** with a generator or by someone qualified.
- [ ] **Docs on GitHub Pages link the right app.** Set the repository variable `DOCS_APP_URL` to the production address once it exists (see [Working on these docs](../develop/docs)). Until then they link the staging app.

## Keeping the privacy policy true

The privacy policy describes what the app does, so it has to change with the app. Update `hamburn-cozynights/src/routes/privacy/+page.svelte` and its date whenever a change:

- stores new personal data, or keeps data longer,
- adds a cookie, a browser storage entry, or anything loaded from another server (fonts, maps, videos, analytics),
- imports more ticket data, for example names next to the e-mail addresses,
- sends data somewhere new, for example e-mails or webhooks carrying guest data,
- changes who can see what, for example who sees burner names.
