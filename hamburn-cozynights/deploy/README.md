# Staging-Deploy aus Git (per Knopfdruck)

Ziel: `https://test-cozynights.hamburn.de` wird **nur auf Knopfdruck** aus einem
beliebigen Branch dieses Repos deployt. Die bestehenden PocketBase-Daten
bleiben erhalten, vor jedem Deploy wird automatisch ein Backup gezogen.

## Ablauf eines Deploys

```text
GitHub Actions „Deploy staging“ → Run workflow (Branch wählen)
  0. gate: Hat genau dieser Stand (derselbe Git-Tree) schon eine grüne CI-Runde
     dieses Repos, normalerweise die des Pull Requests? ja → 1. nur Secrets-Scan
  1. verify: Typprüfung, Unit-, Integrations-, Smoke- und Layout-Tests (dieselbe
     Prüfung wie bei jedem Pull Request) – scheitert hier, nicht auf dem Server
  2. deploy: SSH als `deploy` → Forced Command /usr/local/bin/deploy-cozynights-staging
     a) Commit-SHA auschecken (nur die SHA wird aus dem SSH-Befehl gelesen)
     b) App-Image bauen — alte Container laufen weiter
     c) PocketBase kurz stoppen, Volume nach /var/backups/cozynights-staging sichern
     d) docker compose up -d --remove-orphans
     e) Health-Check auf http://127.0.0.1:3001/api/health (max. 60 s; 200 nur, wenn die App bei PocketBase angemeldet ist)
        → fehlgeschlagen: vorherigen Commit wieder bauen und starten, Job rot
  3. smoke: npm run smoke:remote gegen https://test-cozynights.hamburn.de
     (nur lesend: Seiten, Ticket-Abfrage, Admin-Login-Seite, Admin-Bereich zu)
```

Das Skript bricht **ohne Änderung** ab, wenn der Checkout lokale Änderungen
hat, der Build fehlschlägt (auch wenn der `.env` ein Pflichtwert wie
`PB_ENCRYPTION_KEY` fehlt) oder kein Backup möglich ist. Das PocketBase-Image
wird nicht automatisch aktualisiert: Es gilt die Version aus der
Compose-Datei des deployten Commits.

## Einrichtung (einmalig)

Alle Server-Befehle als `root` (vorher `sudo -i`; ohne root verweigert Docker den Zugriff). Die Anleitung geht davon aus, dass der Checkout
unter `/opt/hamburn-cozynights-staging` liegt und dem User `deploy` gehört.
Schritt 0 prüft das.

### 0. Bestandsaufnahme (ändert nichts)

```bash
APP_DIR=/opt/hamburn-cozynights-staging
id deploy
sudo -u deploy git -C "$APP_DIR" status -sb
sudo -u deploy git -C "$APP_DIR" log --oneline -1
sudo -u deploy git -C "$APP_DIR" remote -v
docker inspect -f 'project={{index .Config.Labels "com.docker.compose.project"}} dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}' cozynights-staging-app cozynights-staging-pocketbase
docker inspect -f '{{range .Mounts}}{{if eq .Destination "/pb_data"}}volume={{.Name}}{{end}}{{end}}' cozynights-staging-pocketbase
```

Prüfen:

- `status` zeigt **keine** geänderten Dateien (`M ...`). Sonst erst klären,
  denn das Deploy-Skript verweigert sonst den Deploy:
  `sudo -u deploy git -C "$APP_DIR" diff` ansehen. Ist die Änderung schon in
  `origin/main` enthalten, verwerfen mit
  `sudo -u deploy git -C "$APP_DIR" checkout -- <datei>`. Die laufenden
  Container sind davon nicht betroffen. Sonst erst in einen Branch
  committen.
- `dir=` ist `$APP_DIR/hamburn-cozynights`.
- `project=` notieren → wird in Schritt 1 **exakt** so eingetragen. Ein
  anderer Projektname würde ein neues, leeres PocketBase-Volume anlegen.

### 1. Server vorbereiten

```bash
APP_DIR=/opt/hamburn-cozynights-staging
PROJECT=hamburn-cozynights   # ← Wert von project= aus Schritt 0

apt-get install -y git curl util-linux
usermod -aG docker deploy
sudo -u deploy git -C "$APP_DIR" remote set-url origin https://github.com/MorpheusMXML/hamburn-cozynights.git
sudo -u deploy git -C "$APP_DIR" fetch origin

install -d -m 755 /etc/cozynights
cat > /etc/cozynights/deploy-staging.conf <<EOF
APP_DIR=$APP_DIR
COMPOSE_PROJECT_NAME=$PROJECT
EOF
install -d -o deploy -g deploy -m 750 /var/backups/cozynights-staging

# Skript aus integration/staging installieren, dem Branch, den Staging deployt
# (root-owned, außerhalb des Checkouts, genau der Pfad des Forced Command aus Schritt 3)
sudo -u deploy git -C "$APP_DIR" show origin/integration/staging:hamburn-cozynights/deploy/deploy-staging.sh > /tmp/deploy-staging.sh
install -o root -g root -m 755 /tmp/deploy-staging.sh /usr/local/bin/deploy-cozynights-staging
rm /tmp/deploy-staging.sh
```

Optionale Werte in `deploy-staging.conf` (Defaults in Klammern):
`BACKUP_DIR` (`/var/backups/cozynights-staging`), `BACKUP_KEEP` (`10`),
`HEALTH_URL` (`http://127.0.0.1:3001/api/health`), `PB_CONTAINER`
(`cozynights-staging-pocketbase`), `COMPOSE_FILE` (`docker-compose.staging.yml`).

### 2. Probelauf auf dem Server

Deployt den **aktuell laufenden** Commit neu. Das testet Backup, Build,
Neustart und Health-Check, ohne Code zu ändern:

```bash
sudo -u deploy /usr/local/bin/deploy-cozynights-staging "deploy $(sudo -u deploy git -C /opt/hamburn-cozynights-staging rev-parse HEAD)"
ls -lh /var/backups/cozynights-staging/
```

Erwartet: `[deploy …] deployed <sha>` und eine `pb_data-*.tar.gz`.

### 3. Deploy-Key (auf deinem Mac)

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-staging" -f ~/deploy_staging
cat ~/deploy_staging.pub
```

Auf dem Server den **Public Key** mit Forced Command eintragen:

```bash
PUBKEY='ssh-ed25519 AAAA... github-actions-staging'   # ← Inhalt von deploy_staging.pub
DEPLOY_HOME=$(getent passwd deploy | cut -d: -f6)
install -d -o deploy -g deploy -m 700 "$DEPLOY_HOME/.ssh"
echo "command=\"/usr/local/bin/deploy-cozynights-staging\",restrict $PUBKEY" >> "$DEPLOY_HOME/.ssh/authorized_keys"
chown deploy:deploy "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
# Fingerprint für Schritt 4: der ECDSA-Hostkey. Die SSH-Action handelt ECDSA
# vor ED25519 aus; ein ED25519-Fingerprint scheitert mit "fingerprint mismatch".
ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub
```

Test vom Mac. Der Key darf **nur** das Skript starten, hier ohne SHA, also
kein Deploy:

```bash
ssh -i ~/deploy_staging deploy@<server> "whoami"
```

Erwartet: `usage: deploy <40-char commit sha>` (statt `deploy`).

### 4. GitHub-Secrets (auf deinem Mac)

```bash
gh secret set STAGING_SSH_HOST --env staging --body "<server-ip-oder-hostname>"
gh secret set STAGING_DEPLOY_SSH_KEY --env staging < ~/deploy_staging
gh secret set STAGING_SSH_FINGERPRINT --env staging --body "SHA256:..."   # aus Schritt 3
# nur falls SSH nicht auf Port 22 läuft:
# gh secret set STAGING_SSH_PORT --env staging --body "2222"
rm ~/deploy_staging ~/deploy_staging.pub
```

Optional unter GitHub → Settings → Environments → `staging`:
**Required reviewers** (Deploy erst nach Freigabe) und **Deployment branches**
(z. B. nur `main` während des Live-Tests).

## Deployen

GitHub → Actions → **Deploy staging** → **Run workflow** → Branch wählen.
Oder vom Mac:

```bash
gh workflow run deploy-staging.yml --ref main
gh run watch
```

Der Branch muss diesen Workflow enthalten, also auf einem `main` ab diesem
Stand basieren.

## Rollback

**Code:** Den Workflow auf einem älteren Branch oder Commit erneut starten.

**Daten** (nur wenn nötig, stellt den Stand vor einem Deploy wieder her):

```bash
source /etc/cozynights/deploy-staging.conf
cd "$APP_DIR/hamburn-cozynights"
ls -1t /var/backups/cozynights-staging/          # Backup auswählen
BACKUP=pb_data-YYYYMMDDTHHMMSSZ-abc1234.tar.gz
VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/pb_data"}}{{.Name}}{{end}}{{end}}' cozynights-staging-pocketbase)
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f docker-compose.staging.yml stop pocketbase
docker run --rm -v "$VOLUME":/pb_data -v /var/backups/cozynights-staging:/backup alpine \
  sh -c "find /pb_data -mindepth 1 -delete && tar xzf /backup/$BACKUP -C /pb_data"
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f docker-compose.staging.yml up -d
```

## PocketBase-Settings-Schlüssel

PocketBase startet mit `--encryptionEnv=PB_ENCRYPTION_KEY`
(`docker-compose.staging.yml`): seine eigenen Settings — SMTP-Passwort,
Absender, Backup-Plan — liegen damit AES-256-GCM-verschlüsselt in der
Datenbank statt im Klartext, also auch verschlüsselt in jedem Backup. Was der
Schlüssel abdeckt und was nicht (das Google-Client-Secret bleibt Klartext):
`docs/develop/deployment.md`, Abschnitt „PocketBase settings key“.

**Einmalig, bevor der erste Deploy mit diesem Stand freigegeben wird** (als
root). Die Compose-Datei verlangt den Wert: Fehlt er, bricht das Deploy beim
Build ab und die alte Version läuft weiter.

```bash
source /etc/cozynights/deploy-staging.conf
ENV_FILE="$APP_DIR/hamburn-cozynights/.env"
if grep -q '^PB_ENCRYPTION_KEY=.\{32\}$' "$ENV_FILE"; then echo "schon gesetzt"; else
  KEY=$(openssl rand -hex 16)
  grep -q '^PB_ENCRYPTION_KEY=' "$ENV_FILE" && sed -i "s/^PB_ENCRYPTION_KEY=.*/PB_ENCRYPTION_KEY=$KEY/" "$ENV_FILE" || printf 'PB_ENCRYPTION_KEY=%s\n' "$KEY" >> "$ENV_FILE"
fi
grep '^PB_ENCRYPTION_KEY=' "$ENV_FILE"   # 32 Zeichen → Vaultwarden (Notiz zur Staging-.env) und Notfallblatt
```

Beim Deploy passiert der Rest von selbst: PocketBase liest die alten
Klartext-Settings, `pb_hooks/cozy_settings.pb.js` speichert sie einmal neu
(Log: `settings were stored in plain text and are now encrypted`; die Zeile
fehlt nur, wenn ein anderer Hook beim Start schon gespeichert hat). Prüfen:

```bash
docker logs cozynights-staging-pocketbase 2>&1 | grep -E 'cozy-settings|encryption'
/opt/hamburn-cozynights-staging/hamburn-cozynights/scripts/cozy-admin.sh notify status
```

- Ohne (oder mit falschem) Schlüssel startet PocketBase danach nicht mehr:
  `invalid settings db data or missing encryption key` bzw.
  `cipher: message authentication failed` im Log. Der Hook verweigert außerdem
  jeden Schlüssel, der nicht genau 32 Zeichen hat, bevor etwas gespeichert wird.
- Jeder `pocketbase`-Befehl im Container braucht das Flag ebenfalls;
  `scripts/cozy-admin.sh` gibt es mit. Von Hand:
  `docker compose exec pocketbase /usr/local/bin/pocketbase <befehl> --dir=/pb_data --encryptionEnv=PB_ENCRYPTION_KEY`.
- `PB_ADMIN_EMAIL`/`PB_ADMIN_PASSWORD` dürfen weiterhin nie an den
  PocketBase-Container: Der Entrypoint des Images würde damit ein
  `superuser upsert` ohne das Flag ausführen, und der Container käme gar nicht
  erst hoch.
- **Rollback auf einen Stand ohne das Flag** (auch der automatische des
  Deploy-Skripts): Dort startet PocketBase mit den schon verschlüsselten
  Settings nicht mehr, der Rollback bleibt „unhealthy“. Dann wie unter
  „Schlüssel verloren“ die Settings-Zeile löschen (die Hooks des alten Stands
  tragen SMTP & Co. ebenfalls aus der `.env` wieder ein) oder das
  Deploy-Archiv einspielen (Abschnitt Rollback → Daten).

**Schlüssel verloren oder wechseln:** Alles Geheime in den Settings kommt aus
der `.env` und wird beim Start von den Hooks wieder eingetragen (SMTP,
Absender, Backup-Plan, Dashboard-Schalter, Log-Dauer). Nur von Hand im
Dashboard gesetzte Werte (Rate-Limits, Trusted Proxy, …) wären danach neu zu
setzen. Mit dem neuen Wert in der `.env`:

```bash
source /etc/cozynights/deploy-staging.conf
cd "$APP_DIR/hamburn-cozynights"
VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/pb_data"}}{{.Name}}{{end}}{{end}}' cozynights-staging-pocketbase)
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f docker-compose.staging.yml stop pocketbase
docker run --rm -v "$VOLUME":/pb_data alpine:3.21 sh -c "apk add -q sqlite && sqlite3 /pb_data/data.db \"DELETE FROM _params WHERE id='settings';\""
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f docker-compose.staging.yml up -d --force-recreate pocketbase
docker logs cozynights-staging-pocketbase 2>&1 | grep 'cozy-'
```

## Wartung

- Ändert sich `deploy-staging.sh` im Repo, die Kopie jedes Stacks neu
  installieren, jeweils aus dem Branch, den der Stack deployt: Staging aus
  `integration/staging` (so läuft ein geändertes Skript zuerst auf Staging),
  Produktion aus `main`, sobald die Änderung released ist. Das Skript liegt
  bewusst außerhalb des Checkouts, damit ein Deploy nicht den eigenen Befehl
  umschreiben kann. Welche Config es liest, ergibt sich aus dem Namen der
  Kopie: `deploy-cozynights-<umgebung>` →
  `/etc/cozynights/deploy-<umgebung>.conf`. Ausgeführt wird nur der Pfad im
  Forced Command des Deploy-Keys
  (`grep -o 'command="[^"]*"' ~deploy/.ssh/authorized_keys`); eine Kopie
  unter anderem Namen ruft niemand auf.

```bash
# Staging, wie Schritt 1
sudo -u deploy git -C /opt/hamburn-cozynights-staging fetch origin &&
  sudo -u deploy git -C /opt/hamburn-cozynights-staging show origin/integration/staging:hamburn-cozynights/deploy/deploy-staging.sh > /tmp/deploy-staging.sh &&
  install -o root -g root -m 755 /tmp/deploy-staging.sh /usr/local/bin/deploy-cozynights-staging &&
  rm /tmp/deploy-staging.sh
# Produktion, erst nach dem Release nach main (Abschnitt „Produktion“, P6)
sudo -u deploy git -C /opt/hamburn-cozynights-production fetch origin &&
  sudo -u deploy git -C /opt/hamburn-cozynights-production show origin/main:hamburn-cozynights/deploy/deploy-staging.sh > /tmp/deploy-production.sh &&
  install -o root -g root -m 755 /tmp/deploy-production.sh /usr/local/bin/deploy-cozynights-production &&
  rm /tmp/deploy-production.sh
```

- Logs eines Deploys: im GitHub-Actions-Run. App-Logs:
  `docker logs --tail 100 cozynights-staging-app`.

## Benachrichtigungen (optional)

Buchungsbestätigungen per E-Mail, Telegram-Updates für Gäste und die
Crew-Gruppe (Doku: `docs/admin/notifications.md`). Einstellungen stehen in der
`.env` des Checkouts (Beschreibung jedes Werts: `deploy/staging.env.template`,
Abschnitt 4); `docker-compose.staging.yml` reicht sie an PocketBase weiter.

- **Ein Bot, aber nur ein Server liest ihn ab.** Der Server liest die
  Nachrichten an den Bot selbst ab (kein Webhook); zwei Server, die denselben
  Bot abfragen, stehlen sich gegenseitig die Nachrichten. Staging und
  Produktion teilen sich Bot und Crew-Gruppe; der jeweils andere Server läuft
  mit `TELEGRAM_GUEST_UPDATES=off` (Crew-Meldungen schickt er weiter). Bis zum
  Livegang liest Staging ab, danach Produktion.
- Nach einer Änderung der `.env` PocketBase neu erzeugen (die Variablen werden
  nur beim Anlegen des Containers gelesen), dann prüfen:

```bash
source /etc/cozynights/deploy-staging.conf
cd "$APP_DIR/hamburn-cozynights"
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f docker-compose.staging.yml up -d --no-deps --force-recreate pocketbase
./scripts/cozy-admin.sh notify status
./scripts/cozy-admin.sh notify test --email du@mauersegler.art
```

- Tickets mit E-Mail-Adressen laden: `./scripts/cozy-admin.sh tickets import liste.csv --dry-run`,
  danach ohne `--dry-run`. Nach dem Event: `./scripts/cozy-admin.sh tickets forget-contacts --yes`.

## Wallet-Pässe (optional)

Der Buchungsnachweis in Apple Wallet und Google Wallet (Doku:
`docs/admin/passes.md`, „Wallet passes“). Die Werte stehen in der `.env` des
Checkouts (`deploy/staging.env.template`, Abschnitt 4b). Wie die Konten, das
Pass-Zertifikat und der Dienstkonto-Schlüssel entstehen, steht im privaten
Betriebs-Runbook, nicht in diesem öffentlichen Repo.

- **Die App liest die Werte, nicht PocketBase.** Nach einer Änderung der `.env`
  also den App-Container neu erzeugen (ein Deploy tut es auch). PocketBase
  erfährt von der App, welche Wallets es gibt, und bietet sie dann in Mails und
  Telegram-Nachrichten an.
- **Nie mehr ändern, sobald ein Pass in einer Wallet liegt:**
  `WALLET_APPLE_PASS_TYPE_ID`, `WALLET_GOOGLE_ISSUER_ID` und `ENCRYPTION_KEY`
  (daraus leitet die App das Token ab, mit dem iPhones nach Updates fragen).
  Sonst aktualisieren sich die Pässe in den Wallets nicht mehr.

```bash
source /etc/cozynights/deploy-staging.conf
cd "$APP_DIR/hamburn-cozynights"
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f docker-compose.staging.yml up -d --no-deps --force-recreate app
sleep 20; docker logs --since 2m cozynights-staging-app 2>&1 | grep -F '[Wallet]'
```

Erwartet: `[Wallet] apple + google wallet passes on; sync every 30 s` (oder nur
`apple` bzw. `google`). Bleibt ein Wallet aus, nennt die Zeile den Grund, z. B.
`[Wallet] Apple Wallet off: missing or invalid: WALLET_APPLE_WWDR`. Gar keine
`[Wallet]`-Zeile: Es ist kein Wallet-Wert gesetzt.

## Staging testen: Benachrichtigungen und Buchungsnachweis

Nach einem Deploy mit gesetzten `.env`-Werten (Abschnitte oben), auf dem Server:

```bash
source /etc/cozynights/deploy-staging.conf
cd "$APP_DIR/hamburn-cozynights"
./scripts/cozy-admin.sh notify status
./scripts/cozy-admin.sh notify test --email du@mauersegler.art
./scripts/cozy-admin.sh tickets add TEST-PASS-1 --email du@mauersegler.art --name "Test"
```

Dann im Browser, als Gast am besten im privaten Fenster (dort spielt die
Admin-Anmeldung nicht mit). Gäste buchen nur während **Live Booking**: Steht die
Phase auf 🛠 Staging, schaltet ein Superuser im Control Center unter
🎟 BOOKING WINDOW → „⚡ Switch right now“ → „Live Booking“ um, und die
Crew-Gruppe meldet es. Beim Zurückschalten auf 🛠 Staging fragt der Dialog, ob
die Gastbuchungen freigegeben werden.

1. `https://test-cozynights.hamburn.de` → Code `TEST-PASS-1` → einen Platz buchen.
2. Die Mail kommt innerhalb etwa einer Minute (Betreff mit `[STAGING]`, Link zum
   Buchungsnachweis).
3. Im Zimmer „✈️ Get updates on Telegram“ → im Bot START → „✅ Connected! …“ mit dem
   Platz, dem QR-Code als Bild und dem Knopf „Show booking pass“. `/pass` schickt den
   Pass noch einmal, das Bot-Menü zeigt /pass, /stop und /help. Verbinden geht auch
   über `/telegram`, dort auch ohne Platz.
4. „🎫 Show booking pass“ → QR-Code und Code. Mit eingerichteten Wallets (Abschnitt
   oben) darunter „Add to Apple Wallet“ (iPhone) bzw. „Add to Google Wallet“
   (Android), am Rechner beide; ohne Wallet-Werte gibt es keinen Wallet-Knopf.
5. Als Admin: den QR-Code mit der Handy-Kamera scannen (im selben Browser bei `/admin`
   angemeldet) → „✅ Check in“, oder im Admin-Menü „🎫 Check-in“ → Code eintippen →
   ✅ CHECKED IN. Das checkt den Gast wirklich ein, und danach kann er seinen Platz
   nicht mehr freigeben: für Schritt 6 erst „↩️ Undo check-in“.
6. Platz wechseln (freigeben und innerhalb einer Minute einen anderen buchen) →
   **eine** Nachricht „changed“ per Mail und Telegram; ein Wallet-Pass zeigt den neuen
   Platz nach etwa einer Minute von selbst. Platz freigeben → „released“, die
   Pass-Seite sagt „This ticket holds no spot right now“, der Check-in ⚠️ NO SPOT.
7. Die Crew-Gruppe hat Meldungen zu Anmeldungen und Phasenwechseln bekommen.

Nach den Tests: Testbuchungen freigeben und `./scripts/cozy-admin.sh tickets remove TEST-PASS-1`.

## Produktion (https://cozynights.hamburn.de)

Ein eigener Stack auf demselben Server, getrennt in allem, was Daten hält oder
auf einem Port lauscht. Staging bleibt, wie es ist.

| | Staging | Produktion |
| --- | --- | --- |
| Checkout | `/opt/hamburn-cozynights-staging` | `/opt/hamburn-cozynights-production` |
| Compose-Datei · Projekt | `docker-compose.staging.yml` · `hamburn-cozynights` | `docker-compose.production.yml` · `cozynights-production` |
| Container | `cozynights-staging-app`, `-pocketbase` | `cozynights-production-app`, `-pocketbase` |
| Ports (nur 127.0.0.1) | App 3001, PocketBase 8091 | App 3002, PocketBase 8092 |
| Volume | `hamburn-cozynights_pb_data_staging` | `cozynights-production_pb_data` |
| Config · Deploy-Skript | `/etc/cozynights/deploy-staging.conf` · `/usr/local/bin/deploy-cozynights-staging` | `/etc/cozynights/deploy-production.conf` · `/usr/local/bin/deploy-cozynights-production` |
| Deploy-Archive | `/var/backups/cozynights-staging` | `/var/backups/cozynights-production` |
| Workflow · Environment | „Deploy staging“ · `staging` | „Deploy production“ · `production` (nur `main`) |

Produktion bekommt nur freigegebenen Code, dreifach geprüft: der Workflow
verweigert jeden Ref außer `main`, das GitHub-Environment `production` lässt nur
`main` zu und wartet auf die Freigabe, und das Deploy-Skript verweigert einen
Commit, der nicht auf `origin/main` liegt (`REQUIRE_BRANCH=main`).

Bis zum Livegang steht vor der ganzen Seite die **Schranke**: eine
Google-Anmeldung, die nur Konten der Workspace `mauersegler.art` durchlässt
(Abschnitt „Die Schranke“ unten).

### Einrichtung (einmalig, als root)

Vorher erledigt: DNS für `cozynights.hamburn.de` (A und AAAA wie der Server),
zwei eigene Google-OAuth-Clients (Typ „Web application“, Consent-Screen
„Internal“) — Admin-Login mit Redirect-URI
`https://cozynights.hamburn.de/auth/callback/google`, Schranke mit
`https://cozynights.hamburn.de/oauth2/callback` —, und die Produktions-Dateien
sind auf `main`.

**P1. Checkout** (gehört `deploy`, steht auf `main`):

```bash
P=/opt/hamburn-cozynights-production
install -d -o deploy -g deploy -m 755 "$P"
sudo -u deploy git clone -q https://github.com/MorpheusMXML/hamburn-cozynights.git "$P"
sudo -u deploy git -C "$P" checkout -q --detach origin/main
sudo -u deploy git -C "$P" log --oneline -1
```

**P2. Die Schranke zuerst**, damit die Seite nie offen ist. Client-ID und
Secret des Schranken-Clients in die `.env` eintragen (`nano`):

```bash
R=/opt/hamburn-cozynights-production/hamburn-cozynights
install -d -m 750 /opt/cozynights-gate
install -m 644 "$R/deploy/gate/docker-compose.yml" /opt/cozynights-gate/docker-compose.yml
install -m 600 "$R/deploy/gate/gate.env.template" /opt/cozynights-gate/.env
sed -i "s|^OAUTH2_PROXY_COOKIE_SECRET=.*|OAUTH2_PROXY_COOKIE_SECRET=$(openssl rand -base64 32 | tr -- '+/' '-_')|" /opt/cozynights-gate/.env
nano /opt/cozynights-gate/.env
install -m 644 "$R/deploy/nginx/cozynights-gate-on.conf" "$R/deploy/nginx/cozynights-gate-off.conf" /etc/nginx/snippets/
install -o root -g root -m 755 "$R/deploy/gate/cozynights-gate" /usr/local/sbin/cozynights-gate
cozynights-gate on
```

Erwartet: `gate ON`, dazu der Hinweis, dass noch kein vhost die Seite ausliefert.

**P3. Zertifikat und vhost.** Erst ein vhost nur für Port 80, damit certbot
das Zertifikat holen kann, dann der echte aus dem Repo:

```bash
R=/opt/hamburn-cozynights-production/hamburn-cozynights
V=/etc/nginx/sites-available/cozynights.hamburn.de
printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name cozynights.hamburn.de;\n    location / { return 404; }\n}\n' > "$V"
ln -s "$V" /etc/nginx/sites-enabled/cozynights.hamburn.de
nginx -t && systemctl reload nginx
certbot certonly --nginx -d cozynights.hamburn.de --deploy-hook "systemctl reload nginx"
install -m 644 "$R/deploy/nginx/cozynights.hamburn.de.conf" "$V"
nginx -t && systemctl reload nginx
cozynights-gate status
```

Erwartet: `GET https://cozynights.hamburn.de/ → 302 https://accounts.google.com/…`.

**P4. Config und `.env`.** Eigene Schlüssel, `LEGAL_*` aus der Staging-`.env`;
danach den Google-Client des Admin-Logins eintragen (`nano`) und die `.env` als
sichere Notiz in Vaultwarden ablegen, beide Schlüssel aufs Notfallblatt:

```bash
P=/opt/hamburn-cozynights-production
R=$P/hamburn-cozynights
cat > /etc/cozynights/deploy-production.conf <<CONF
APP_DIR=$P
COMPOSE_PROJECT_NAME=cozynights-production
COMPOSE_FILE=docker-compose.production.yml
BACKUP_DIR=/var/backups/cozynights-production
HEALTH_URL=http://127.0.0.1:3002/api/health
PB_CONTAINER=cozynights-production-pocketbase
REQUIRE_BRANCH=main
CONF
install -d -o deploy -g deploy -m 750 /var/backups/cozynights-production
install -o deploy -g deploy -m 600 "$R/deploy/production.env.template" "$R/.env"
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|; s|^PB_ENCRYPTION_KEY=.*|PB_ENCRYPTION_KEY=$(openssl rand -hex 16)|" "$R/.env"
sed -i '/^LEGAL_/d' "$R/.env" && grep '^LEGAL_' /opt/hamburn-cozynights-staging/hamburn-cozynights/.env >> "$R/.env"
nano "$R/.env"
chown deploy:deploy "$R/.env" && chmod 600 "$R/.env"
```

**P5. Erststart von Hand.** Image bauen, PocketBase starten, dann mit
`scripts/cozy-admin.sh` das Service-Konto der App und den ersten Superuser
anlegen und die Crew einladen (`cozy-admin.sh --help`). Das Werkzeug nimmt
Compose-Datei und Projekt aus der Deploy-Config:

```bash
R=/opt/hamburn-cozynights-production/hamburn-cozynights
cd "$R"
GIT_SHA=$(sudo -u deploy git -C /opt/hamburn-cozynights-production rev-parse HEAD) docker compose -f docker-compose.production.yml build app
docker compose -f docker-compose.production.yml up -d pocketbase
export COZY_DEPLOY_CONF=/etc/cozynights/deploy-production.conf
./scripts/cozy-admin.sh --help
```

Erwartet danach: `curl -s http://127.0.0.1:3002/api/health` antwortet mit
`"status":"ok"`, Version und Commit.

**P6. Deploy-Skript, Probelauf, Deploy-Key.** Dasselbe Skript wie für Staging,
unter dem Namen der Produktion installiert; der Probelauf deployt den laufenden
Commit neu (Backup, Build, Health-Check):

```bash
R=/opt/hamburn-cozynights-production/hamburn-cozynights
install -o root -g root -m 755 "$R/deploy/deploy-staging.sh" /usr/local/bin/deploy-cozynights-production
sudo -u deploy /usr/local/bin/deploy-cozynights-production "deploy $(sudo -u deploy git -C /opt/hamburn-cozynights-production rev-parse HEAD)"
ls -lh /var/backups/cozynights-production/
```

Deploy-Key wie in Schritt 3/4 oben, aber als zweiter Key mit eigenem Forced
Command `command="/usr/local/bin/deploy-cozynights-production",restrict` und
den Secrets `PRODUCTION_SSH_HOST`, `PRODUCTION_DEPLOY_SSH_KEY`,
`PRODUCTION_SSH_FINGERPRINT` (derselbe ECDSA-Fingerprint) im Environment
`production`. Das Environment: Required reviewers, Deployment branches nur
`main`, keine Umgehung für Admins.

**P7. Erster Deploy über GitHub:** Actions → **Deploy production** → Run
workflow auf `main` (oder `gh workflow run deploy-production.yml --ref main`),
freigeben. Hinter der Schranke prüft der Smoke-Job nur `/api/health` (der
deployte Commit) und die Umleitung zu Google.

**P8. Backups:** Die Produktions-Datenbank in das Server-Backup aufnehmen
(`deploy/backup/README.md`, „Neue Umgebung“), dann die Prüfung des Backups
laufen lassen.

### Die Schranke

```bash
cozynights-gate status   # nginx an/aus, oauth2-proxy, was ein Besucher bekommt
cozynights-gate on       # zu: jeder Besuch braucht ein mauersegler.art-Google-Konto
cozynights-gate off      # LIVEGANG: öffentlich
```

- nginx fragt oauth2-proxy (`/opt/cozynights-gate`, Port 4180, nur lokal)
  per `auth_request`; `/etc/nginx/snippets/cozynights-gate.conf` zeigt auf
  `cozynights-gate-on.conf` oder `cozynights-gate-off.conf`. Das Skript
  schaltet in der sicheren Reihenfolge, testet nginx und stellt bei einem
  Fehler den alten Zustand wieder her.
- Einzige Ausnahme: `/api/health`. Fällt oauth2-proxy bei eingeschalteter
  Schranke aus, antwortet nginx mit 500 — die Seite bleibt zu.
- Anmeldung an der Schranke gilt 7 Tage; Logs: `docker logs cozynights-gate`.
- Nach dem Livegang installiert lassen: `cozynights-gate on` schließt die
  Seite in Sekunden wieder (Notfall, nach dem Event).

### Wartung Produktion

- Admin-Werkzeug immer aus dem Produktions-Checkout mit ihrer Config:
  `COZY_DEPLOY_CONF=/etc/cozynights/deploy-production.conf /opt/hamburn-cozynights-production/hamburn-cozynights/scripts/cozy-admin.sh list`
  (aus dem Staging-Checkout verweigert es das).
- Nach einer Änderung der `.env`:
  `cd /opt/hamburn-cozynights-production/hamburn-cozynights && docker compose -f docker-compose.production.yml up -d --no-deps --force-recreate pocketbase`
  (bzw. `app`).
- PocketBase-Dashboard: `ssh -N -L 8092:127.0.0.1:8092 <server>`, dann `http://127.0.0.1:8092/_/`.
- Rollback und Schlüssel-Themen wie oben bei Staging, mit den Namen aus der
  Tabelle.
