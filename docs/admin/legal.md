# Legal pages

CozyNights has a legal notice (**Impressum**, `/impressum`), a privacy policy (**Datenschutzerklärung**, `/datenschutz`) and **booking rules** (**Buchungsregeln**, `/buchungsregeln`). Every page links to all three: the start page and the map in their footers, all other pages at the bottom, and these docs under every page. The booking dialogs link the booking rules too.

The pages are **in German on purpose**. They are written for German law; the rest of the app stays English. Visitors can let their browser translate them.

The wording lives in the repository. **Who runs the site** (name, address, contact, register entry) does not: the repository is public, and an address committed once stays in its history for good. Each environment reads these details from its own server `.env`.

::: warning Not legal advice
The texts are a careful starting point that matches what CozyNights really does. Before the first real event, compare them with a generator such as eRecht24 or Datenschutz-Generator.de, or have someone qualified read them.
:::

## What the pages say

| Page              | Content                                                                                                                                                                                                                                              |
| :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/impressum`      | Provider details under § 5 DDG, contact, register entry, VAT ID, a disclaimer (content, links, availability, spot booking, copyright)                                                                                                                |
| `/datenschutz`    | Controller, hosting, server logs, the brake on guessing ticket codes, ticket codes, e-mail addresses and bookings, crew sign-in with Google, browser storage, the docs on GitHub Pages, e-mail contact, recipients, rights incl. the right to object |
| `/buchungsregeln` | Who can book, when and how, no claim to a particular spot (the crew may move people and writes to them), burner names, fair play, house rules and consent in the houses                                                                              |

Left out on purpose:

- **No link to the EU online dispute resolution platform (ODR).** The platform was shut down on 20 July 2025. A leftover link is now misleading and can draw a warning letter.
- **No consumer arbitration statement (VSBG).** Only required from eleven employees upwards.
- **No cookie banner.** CozyNights only sets cookies it can't work without (ticket code, crew session, sign-in protection). They need no consent (§ 25 Abs. 2 TDDDG). Tracking, analytics or embedded third-party content would change that, and the privacy policy with it.
- **No data protection officer.** An association only needs one when at least 20 people regularly process personal data (§ 38 BDSG).

## Settings on the server

The details are `LEGAL_*` variables in the environment's `.env`, next to the other settings. `deploy/staging.env.template` has the block with comments. Put values with spaces or special characters in 'single quotes'; multi-line values separate their lines with `|`.

| Variable                      | Needed          | What goes in                                                                                                    |
| :---------------------------- | :-------------- | :-------------------------------------------------------------------------------------------------------------- |
| `LEGAL_NAME`                  | **yes**         | The provider incl. legal form, e.g. `'Musterverein e.V.'`                                                       |
| `LEGAL_ADDRESS`               | **yes**         | A street address where letters can be served, no P.O. box, e.g. `'Musterstraße 1\|20095 Hamburg'`               |
| `LEGAL_EMAIL`                 | **yes**         | General contact address                                                                                         |
| `LEGAL_HOSTER`                | **yes**         | The hosting company, e.g. `'Hetzner Online GmbH\|Industriestr. 25\|91710 Gunzenhausen\|Deutschland'`            |
| `LEGAL_PHONE`                 | recommended     | A second fast way to reach you                                                                                  |
| `LEGAL_REPRESENTATIVE`        | associations    | The board members who represent it (§ 26 BGB), e.g. `'den Vorstand: Erika Muster (Vorsitz)'`                    |
| `LEGAL_REGISTER`              | if registered   | e.g. `'Vereinsregister: Amtsgericht Hamburg, VR 12345'`                                                         |
| `LEGAL_VAT_ID`                | if you have one | VAT identification number                                                                                       |
| `LEGAL_CONTENT_RESPONSIBLE`   | rarely          | Only for journalistic-editorial content (§ 18 Abs. 2 MStV): `'Name\|Address'`                                   |
| `LEGAL_PRIVACY_EMAIL`         | optional        | A separate address for privacy requests; otherwise `LEGAL_EMAIL`                                                |
| `LEGAL_SUPERVISORY_AUTHORITY` | optional        | The data protection authority of the provider's state                                                           |
| `LEGAL_LOG_RETENTION_DAYS`    | optional        | How long nginx keeps access logs; default `14`                                                                  |
| `LEGAL_DELETION_PERIOD`       | optional        | When bookings and the ticket list are deleted; default _spätestens vier Wochen nach dem Ende der Veranstaltung_ |
| `LEGAL_TERMS_URL`             | once published  | Link to the event's participation terms (Teilnahmebedingungen), e.g. at the ticket shop; `https://` only        |

While a required value is missing, both pages show a red note for the operators and the app log names the missing variables on the first visit.

The app reads `.env` only when its container is created. After editing it, deploy again or recreate just the app container (as root on the server):

```bash
source /etc/cozynights/deploy-staging.conf
cd "$APP_DIR/hamburn-cozynights"
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f docker-compose.staging.yml up -d --no-deps --force-recreate app
```

## Booking rules and participation terms

The sleeping spot is part of the Hamburn ticket, so the booking rules are rules of use, not a contract of their own. The contract is the ticket purchase: the event's **participation terms** (Teilnahmebedingungen) belong to the ticket shop, where buyers accept them before paying. Once they are published, set `LEGAL_TERMS_URL`; the booking rules and the Impressum then link them.

The ticket list holds the ticket codes and the buyers' e-mail addresses, so the crew can reach guests about their spot. Importing them is described in the [event checklist](./event-checklist#ticket-codes).

## Before going live

- [ ] **Every public environment is filled in**, staging included: it is reachable from the internet too. No red note on `/impressum` or `/datenschutz`.
- [ ] **Data processing agreement with the hoster.** The privacy policy says one exists. Hetzner offers it in the account settings of its console.
- [ ] **Server location.** The privacy policy says the server is in the EU.
- [ ] **Log retention matches.** nginx rotates its logs after as many days as `LEGAL_LOG_RETENTION_DAYS` says (Debian default: 14 days, `/etc/logrotate.d/nginx`).
- [ ] **Deletion after the event is planned** within the period the privacy policy names. See [After the burn](./event-checklist#after-the-burn).
- [ ] **Participation terms published** with the ticket shop and linked with `LEGAL_TERMS_URL`. The booking rules must not contradict them.
- [ ] **Texts checked** with a generator or by someone qualified.
- [ ] **Docs on GitHub Pages link the right app.** Set the repository variable `DOCS_APP_URL` to the production address once it exists (see [Working on these docs](../develop/docs)). Until then they link the staging app.

## Keeping the privacy policy true

The privacy policy describes what the app does, so it has to change with the app. Update `hamburn-cozynights/src/routes/datenschutz/+page.svelte` and its date whenever a change:

- stores new personal data, or keeps data longer,
- adds a cookie, a browser storage entry, or anything loaded from another server (fonts, maps, videos, analytics),
- imports more ticket data, for example names next to the e-mail addresses,
- sends data somewhere new, for example e-mails or webhooks carrying guest data,
- changes who can see what, for example who sees burner names.
