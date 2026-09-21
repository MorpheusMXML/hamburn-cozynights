# Staging-Deploy aus Git (per Knopfdruck)

Ziel: `https://test-cozynights.hamburn.de` wird **nur auf Knopfdruck** aus einem
beliebigen Branch dieses Repos deployt. Die bestehenden PocketBase-Daten
bleiben erhalten, vor jedem Deploy wird automatisch ein Backup gezogen.

## Ablauf eines Deploys

```text
GitHub Actions „Deploy staging“ → Run workflow (Branch wählen)
  1. verify: Typprüfung, Unit-, Integrations- und Smoke-Tests (npm run verify,
     dieselbe Prüfung wie bei jedem Pull Request) – scheitert hier, nicht auf dem Server
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

# Skript aus main installieren (root-owned, außerhalb des Checkouts)
sudo -u deploy git -C "$APP_DIR" show origin/main:hamburn-cozynights/deploy/deploy-staging.sh > /tmp/deploy-staging.sh
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
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub   # Fingerprint für Schritt 4
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

- Ändert sich `deploy-staging.sh` im Repo, Schritt 1 („Skript aus main
  installieren“) wiederholen. Das Skript liegt bewusst außerhalb des
  Checkouts, damit ein Deploy nicht den eigenen Befehl umschreiben kann.
- Logs eines Deploys: im GitHub-Actions-Run. App-Logs:
  `docker logs --tail 100 cozynights-staging-app`.

## Benachrichtigungen (optional)

Buchungsbestätigungen per E-Mail, Telegram-Updates für Gäste und die
Crew-Gruppe (Doku: `docs/admin/notifications.md`). Einstellungen stehen in der
`.env` des Checkouts (Beschreibung jedes Werts: `deploy/staging.env.template`,
Abschnitt 4); `docker-compose.staging.yml` reicht sie an PocketBase weiter.

- **Ein eigener Telegram-Bot nur für Staging.** Der Server liest die
  Nachrichten an den Bot selbst ab (kein Webhook); zwei Server mit demselben
  Bot stehlen sich gegenseitig die Nachrichten.
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

## Staging testen: Benachrichtigungen und Buchungsnachweis

Nach einem Deploy mit gesetzten `.env`-Werten (Abschnitt oben), auf dem Server:

```bash
source /etc/cozynights/deploy-staging.conf
cd "$APP_DIR/hamburn-cozynights"
./scripts/cozy-admin.sh notify status
./scripts/cozy-admin.sh notify test --email du@mauersegler.art
./scripts/cozy-admin.sh tickets add TEST-PASS-1 --email du@mauersegler.art --name "Test"
```

Dann im Browser (Live Booking muss an sein):

1. `https://test-cozynights.hamburn.de` → Code `TEST-PASS-1` → einen Platz buchen.
2. Mail kommt nach ca. 15 s (Betreff mit `[STAGING]`, Link zum Buchungsnachweis).
3. Im Zimmer „Get updates on Telegram“ → im Bot START → der Bot bestätigt den Platz.
4. „🎫 Show booking pass“ → QR-Code und Code.
5. Als Admin: den QR-Code mit der Handy-Kamera scannen (im selben Browser bei `/admin`
   angemeldet) oder im Admin-Kopf „🎫 Check passes“ → Code eintippen → ✅ VALID.
6. Platz wechseln → eine Mail „changed“; Platz freigeben → Mail „released“, der Pass zeigt
   ⚠️ NO SPOT.
7. Die Crew-Gruppe hat Meldungen zu Anmeldungen und Phasenwechseln bekommen.

Nach den Tests: Testbuchungen freigeben und `./scripts/cozy-admin.sh tickets remove TEST-PASS-1`.
