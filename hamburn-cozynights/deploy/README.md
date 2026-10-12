# Staging-Deploy aus Git (per Knopfdruck)

Ziel: `https://test-cozynights.hamburn.de` wird **nur auf Knopfdruck** aus
`integration/staging` (oder `main`) deployt. Die bestehenden PocketBase-Daten
bleiben erhalten, vor jedem Deploy wird automatisch ein Backup gezogen.

## Ablauf eines Deploys

```text
GitHub Actions „Deploy staging“ → Run workflow (Branch wählen)
  0. gate: Hat genau dieser Stand (derselbe Git-Tree) schon eine grüne CI-Runde
     dieses Repos, normalerweise die des Pull Requests? ja → 1. nur Secrets-Scan
  1. verify: Typprüfung, Unit-, Integrations-, Smoke- und Layout-Tests (dieselbe
     Prüfung wie bei jedem Pull Request) – scheitert hier, nicht auf dem Server
  2. deploy: SSH als `deploy` → Forced Command /usr/local/bin/deploy-cozynights-staging
     Der Deploy läuft abgelöst von der SSH-Verbindung (eigene Session, Log in
     /var/backups/cozynights-staging/deploy-<UTC>-<sha7>.log); die SSH-Seite zeigt
     nur dieses Log und endet mit dem Exit-Code des Deploys.
     a) prüfen, bevor etwas passiert (nur die SHA wird aus dem SSH-Befehl gelesen):
        Branch (REQUIRE_BRANCH), kein Downgrade, Signaturen, Compose-Pin
     b) laufendes App-Image als <image>:prev merken, Commit-SHA auschecken
     c) App-Image bauen — alte Container laufen weiter
     d) PocketBase kurz stoppen, Volume nach /var/backups/cozynights-staging sichern
     e) docker compose up -d --remove-orphans (höchstens UP_TIMEOUT = 300 s: kommt
        PocketBase nicht hoch, wartet Compose sonst ewig)
     f) Health-Check auf http://127.0.0.1:3001/api/health (max. 60 s; 200 nur, wenn die App bei PocketBase angemeldet ist)
        → e) oder f) fehlgeschlagen: vorherigen Commit auschecken, :prev-Image ohne Neubau starten, Job rot
  3. smoke: npm run smoke:remote gegen https://test-cozynights.hamburn.de
     (nur lesend: Seiten, Ticket-Abfrage, Admin-Login-Seite, Admin-Bereich zu)
```

Das Skript bricht **ohne Änderung** ab, wenn der Checkout lokale Änderungen
hat, eine Prüfung aus a) scheitert, der Build fehlschlägt (auch wenn der
`.env` ein Pflichtwert wie `PB_ENCRYPTION_KEY` fehlt) oder kein Backup möglich
ist. Bricht es nach dem Checkout ab — Fehler, `kill`, abgerissene Verbindung
ist kein Abbruch mehr —, stellt ein Trap den alten Stand her: erst den
Checkout (PocketBase liest `pb_hooks/` und `pb_migrations/` daraus), dann den
Image-Tag, dann PocketBase. Das PocketBase-Image wird nicht automatisch
aktualisiert: Es gilt die Version aus der Compose-Datei des deployten Commits.

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

apt-get install -y git curl util-linux gnupg
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
(`cozynights-staging-pocketbase`), `COMPOSE_FILE` (`docker-compose.staging.yml`),
`HEALTH_TRIES`/`HEALTH_INTERVAL` (`30`/`2` s), `UP_TIMEOUT` (`300` s für
jedes `compose up`), `DEPLOY_LOG_KEEP` (`20`
Deploy-Logs), `HELPER_IMAGE` (`alpine:3.21`), `ALLOW_NO_BACKUP` (`0`), dazu
`REQUIRE_BRANCH`, `ALLOW_DOWNGRADE` (`0`), `TRUSTED_GNUPGHOME`,
`TRUSTED_SIGNERS`, `TRUSTED_MERGE_SIGNERS` und `COMPOSE_PIN` (Schritt 5 und
Rollback). Werte mit Leerzeichen in Anführungszeichen, die Datei wird von der
Shell gelesen: `REQUIRE_BRANCH="integration/staging main"`.

### 2. Probelauf auf dem Server

Deployt den **aktuell laufenden** Commit neu. Das testet Backup, Build,
Neustart und Health-Check, ohne Code zu ändern:

```bash
sudo -u deploy /usr/local/bin/deploy-cozynights-staging "deploy $(sudo -u deploy git -C /opt/hamburn-cozynights-staging rev-parse HEAD)"
ls -lh /var/backups/cozynights-staging/
```

Erwartet: `[deploy …] deployed <sha>`, als letzte Zeile `exit 0`, und eine
`pb_data-*.tar.gz` neben dem Log `deploy-*.log`.

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

### 5. Signatur-Schranke und Compose-Pin

Zwei Sperren, die root einrichtet und die der `deploy`-User nicht ändern kann
(alles unter `/etc/cozynights` gehört root). Beide sind aus, solange ihre
Config fehlt. Beim Umstieg eines laufenden Stacks die Reihenfolge aus
„Umstieg auf das gehärtete Deploy-Skript“ einhalten.

**Signaturen.** Mit `TRUSTED_GNUPGHOME` in der Config prüft das Skript jeden
neuen Commit (`git rev-list <laufend>..<ziel>`; bei einem Redeploy des
laufenden Commits oder einem Downgrade den Ziel-Commit selbst):

- normale Commits: signiert von einem Schlüssel aus `TRUSTED_SIGNERS` (deiner;
  Haupt- und Signatur-Unterschlüssel zählen beide, die YubiKey-Signatur also auch);
- Merge-Commits: von `TRUSTED_SIGNERS` oder von `TRUSTED_MERGE_SIGNERS`
  (GitHubs web-flow-Schlüssel: Merges im Web und mit `gh pr merge`). Ein nur
  von GitHub signierter Merge muss ein **sauberer** Merge sein:
  `git merge-tree` seiner beiden Eltern ergibt genau seinen Inhalt — keine
  Konfliktlösung, nichts zusätzlich hineingelegt.

Sonst Exit 12 mit der Liste der Commits. Von GitHub signierte Einzel-Commits
(Dependabot, Bearbeiten im Web, Squash-Merge, Konfliktlösung im Web) gehen so
nicht durch: **Solche Commits muss Max neu signieren**, bevor sie deployt
werden.

a) Auf dem Mac den öffentlichen Schlüssel kopieren:

```bash
gpg --fingerprint --with-subkey-fingerprints   # Fingerprint des Hauptschlüssels notieren (40 Zeichen, ohne Leerzeichen)
gpg --export --armor <fingerprint> | pbcopy
```

b) Auf dem Server als root (Inhalt der Zwischenablage zwischen die
`KEY`-Zeilen einfügen):

```bash
cat > /root/max.asc <<'KEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----
…
-----END PGP PUBLIC KEY BLOCK-----
KEY
curl -fsSL https://github.com/web-flow.gpg -o /root/web-flow.gpg
install -d -o root -g root -m 755 /etc/cozynights/gnupg
gpg --homedir /etc/cozynights/gnupg --batch --import /root/max.asc /root/web-flow.gpg
gpgconf --homedir /etc/cozynights/gnupg --kill all
find /etc/cozynights/gnupg -maxdepth 1 -type f -exec chmod 644 {} +
chown -R root:root /etc/cozynights/gnupg
gpg --homedir /etc/cozynights/gnupg --list-keys --with-subkey-fingerprints
```

Die Warnung `unsafe permissions on homedir` ist hier gewollt: Das Skript liest
den Schlüsselbund als `deploy` und kopiert ihn bei jedem Lauf in ein eigenes
Temp-Verzeichnis. Die Liste muss deinen Schlüssel (derselbe Fingerprint wie
auf dem Mac) und GitHub zeigen.

c) Config, je Stack ein Block. Staging bekommt dabei `REQUIRE_BRANCH` mit zwei
Branches — **erst mit dem neuen Skript**: das alte kennt nur einen Branch und
verweigert dann jeden Deploy (Exit 10).

```bash
# Staging
MAX_FPR=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX   # ← dein Fingerprint aus a)
GH_FPR=$(gpg --show-keys --with-colons /root/web-flow.gpg | awk -F: '$1 == "fpr" && $10 ~ /B5690EEEBB952194$/ { print $10 }')
echo "Max: $MAX_FPR · GitHub: $GH_FPR"   # beide 40 Zeichen
CONF=/etc/cozynights/deploy-staging.conf
sed -i '/^\(TRUSTED_GNUPGHOME\|TRUSTED_SIGNERS\|TRUSTED_MERGE_SIGNERS\|REQUIRE_BRANCH\)=/d' "$CONF"
cat >> "$CONF" <<CONF
TRUSTED_GNUPGHOME=/etc/cozynights/gnupg
TRUSTED_SIGNERS=$MAX_FPR
TRUSTED_MERGE_SIGNERS=$GH_FPR
REQUIRE_BRANCH="integration/staging main"
CONF
cat "$CONF"
```

```bash
# Produktion (REQUIRE_BRANCH=main steht seit P4 drin und bleibt)
MAX_FPR=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX   # ← dein Fingerprint aus a)
GH_FPR=$(gpg --show-keys --with-colons /root/web-flow.gpg | awk -F: '$1 == "fpr" && $10 ~ /B5690EEEBB952194$/ { print $10 }')
echo "Max: $MAX_FPR · GitHub: $GH_FPR"   # beide 40 Zeichen
CONF=/etc/cozynights/deploy-production.conf
sed -i '/^\(TRUSTED_GNUPGHOME\|TRUSTED_SIGNERS\|TRUSTED_MERGE_SIGNERS\)=/d' "$CONF"
cat >> "$CONF" <<CONF
TRUSTED_GNUPGHOME=/etc/cozynights/gnupg
TRUSTED_SIGNERS=$MAX_FPR
TRUSTED_MERGE_SIGNERS=$GH_FPR
CONF
cat "$CONF"   # muss REQUIRE_BRANCH=main enthalten
```

`B5690EEEBB952194` ist GitHubs aktueller web-flow-Schlüssel (seit Januar 2024;
der zweite in der Datei ist abgelaufen). Ein Platzhalter-Fingerprint oder einer
mit Leerzeichen lässt das Skript mit Exit 14 abbrechen, bevor etwas passiert.
Weitere Schlüssel: mit Leerzeichen getrennt in Anführungszeichen,
`TRUSTED_SIGNERS="FPR1 FPR2"`.

**Compose-Pin.** Der `deploy`-User ist in der Gruppe `docker`, und Docker ist
root auf diesem Server, auf dem auch Vaultwarden läuft: Eine Compose-Datei mit
`privileged: true` oder einem Mount von `/` wäre root. Mit einem Pin deployt
das Skript nur eine Compose-Datei, deren sha256 root freigegeben hat; jede
Änderung daran braucht vorher root (Exit 13). Pin für das, was **gerade
läuft**, nach dem Lesen der Datei (keine `privileged`, keine Host-Mounts außer
`pb_hooks`/`pb_migrations`, kein `include:`/`extends:` — der Pin deckt nur
diese eine Datei ab):

```bash
# Staging
F=docker-compose.staging.yml
sudo -u deploy git -C /opt/hamburn-cozynights-staging show "HEAD:hamburn-cozynights/$F" | less
sudo -u deploy git -C /opt/hamburn-cozynights-staging show "HEAD:hamburn-cozynights/$F" | sha256sum > "/etc/cozynights/$F.sha256"
cat "/etc/cozynights/$F.sha256"
```

```bash
# Produktion
F=docker-compose.production.yml
sudo -u deploy git -C /opt/hamburn-cozynights-production show "HEAD:hamburn-cozynights/$F" | less
sudo -u deploy git -C /opt/hamburn-cozynights-production show "HEAD:hamburn-cozynights/$F" | sha256sum > "/etc/cozynights/$F.sha256"
cat "/etc/cozynights/$F.sha256"
```

`HEAD` ist der laufende Commit; bei einem frischen Stack derselbe Befehl mit
`origin/<branch>` statt `HEAD`. Ändert ein späterer Commit die Datei, bricht
der Deploy mit Exit 13 ab und nennt beide Befehle: das `git diff` zum Lesen
und die Zeile, die den neuen Hash als root freigibt. Danach den Deploy erneut
starten. Statt der Datei geht auch `COMPOSE_PIN=<sha256>` in der Config (die
Config gewinnt).

## Umstieg auf das gehärtete Deploy-Skript (v1.32.3)

v1.32.3 bringt ein neues `deploy-staging.sh`: abgelöster Lauf mit Log, Trap,
Rollback per `:prev`-Image, mehrere Branches in `REQUIRE_BRANCH`,
Downgrade-Sperre, Signatur-Schranke, Compose-Pin. **Das neue Skript wird erst
nach dem Release-Deploy installiert**; v1.32.3 selbst geht mit der alten,
installierten Kopie raus. Danach müssen **beide** Kopien neu installiert
werden, jede aus ihrem Branch. Reihenfolge:

**Teil 1 — Staging**

0. **Pflicht: ein Platz pro Ticket**, Block „Staging“ unter „Vor einem
   Release“ (Abschnitt Deployen). Nur ohne Ausgabe weiter: Mit dem alten Skript
   rollt ein Abbruch der Migration **nicht** zurück.
1. **Release deployen, altes Skript:** den Release-PR nach
   `integration/staging` mergen, dann
   `gh workflow run deploy-staging.yml --ref integration/staging`, freigeben,
   grün abwarten. Am Server noch nichts ändern. Hängt der Job bei
   `starting stack` oder endet er dort rot: „Notfall: Release-Deploy mit dem
   alten Skript hängt oder scheitert“ unten.
2. **Als root** auf dem Server, in dieser Reihenfolge:
   1. nginx: Wartungsseite und vhost aus dem Release (Block „Staging“ unter
      „nginx nach dem Release“ unten). Der neue vhost zeigt bei 502/504 die
      Seite `/var/www/cozynights/cozy-down.html`; ohne die Datei wird daraus
      ein 404.
   2. Skript-Kopie aus `origin/integration/staging` neu installieren (Block
      „Staging“ unter „Wartung“; muss `grep -c TRUSTED_GNUPGHOME
      /usr/local/bin/deploy-cozynights-staging` > 0 ergeben);
   3. Schlüsselbund und Config: Schritt 5 a)–c) (inklusive
      `REQUIRE_BRANCH="integration/staging main"`);
   4. Compose-Pin für `docker-compose.staging.yml` aus `HEAD` (Schritt 5,
      „Compose-Pin“) — `HEAD` ist jetzt der Release-Commit.
3. **Trockenlauf auf Staging** = denselben, laufenden Commit noch einmal
   deployen; er muss **beide** Sperren passieren. Vorher prüfen, dass
   `integration/staging` noch auf dem laufenden Commit steht:

   ```bash
   sudo -u deploy git -C /opt/hamburn-cozynights-staging fetch -q origin && sudo -u deploy git -C /opt/hamburn-cozynights-staging rev-parse HEAD origin/integration/staging   # zweimal dieselbe SHA
   ```

   Dann vom Mac `gh workflow run deploy-staging.yml --ref integration/staging`
   (oder auf dem Server, wie Schritt 2 der Einrichtung:
   `sudo -u deploy /usr/local/bin/deploy-cozynights-staging "deploy $(sudo -u deploy git -C /opt/hamburn-cozynights-staging rev-parse HEAD)"`).
   Im Log müssen stehen: `signatures ok: 1 commit(s)…`,
   `compose file approved (…)`, `running app image … kept as …:prev`,
   `deployed <sha>` und zuletzt `exit 0`.

**Teil 2 — Produktion**, erst wenn der Trockenlauf auf Staging grün ist:

0. **Pflicht: ein Platz pro Ticket**, Block „Produktion“ unter „Vor einem
   Release“. Nur ohne Ausgabe weiter.
1. **Release deployen, altes Skript:** Release-PR nach `main` mergen,
   `gh workflow run deploy-production.yml --ref main`, freigeben, grün
   abwarten. Hängt oder scheitert er: „Notfall …“ unten, Werte „Produktion“.
2. **Als root:**
   1. nginx: Block „Produktion“ unter „nginx nach dem Release“;
   2. Produktions-Kopie aus `origin/main` neu installieren (Block „Produktion“
      unter „Wartung“);
   3. Config mit dem Produktions-Block aus Schritt 5 c) (der Schlüsselbund aus
      5 b) gilt für beide Stacks, `REQUIRE_BRANCH=main` bleibt);
   4. Compose-Pin für `docker-compose.production.yml` aus `HEAD` des
      Produktions-Checkouts.
3. **Trockenlauf auf Produktion:** wie oben mit
   `/opt/hamburn-cozynights-production`, `origin/main` und
   `gh workflow run deploy-production.yml --ref main`.

Scheitert ein Trockenlauf, ändert er nichts; das Log sagt, woran:

- Exit 12 `signed by <fingerprint>, not a trusted key`: falscher Fingerprint
  in der Config — mit dem genannten vergleichen. `not signed` oder
  `not a merge` beim laufenden Commit: Er ist weder von dir noch als sauberer
  GitHub-Merge signiert; Schranke bis zum nächsten sauber signierten Release
  aus lassen (`TRUSTED_GNUPGHOME` aus der Config nehmen).
- Exit 13: Pin nicht aus `HEAD` geschrieben — den Pin-Schritt wiederholen.
- Exit 10: `REQUIRE_BRANCH` prüfen.

Zurück zum alten Skript: die Kopie aus dem vorigen Release installieren
(`git show <alter-commit>:hamburn-cozynights/deploy/deploy-staging.sh`) und
`REQUIRE_BRANCH` auf einen Branch kürzen; die übrigen neuen Werte ignoriert es.

### nginx nach dem Release

Der vhost aus dem Release zeigt bei 502/504 (App down oder zu langsam) eine
Seite, die sich selbst neu lädt. Sie muss vor dem vhost liegen. Der alte vhost
wird gesichert; scheitert `nginx -t`, kommt er zurück und nginx lädt nichts
neu. Als root, nach dem Release-Deploy des Stacks:

```bash
# Staging
R=/opt/hamburn-cozynights-staging/hamburn-cozynights
V=/etc/nginx/sites-available/test-cozynights.hamburn.de
B=/root/vhost-test-cozynights.hamburn.de.$(date +%Y%m%d-%H%M%S)
if [ -f "$V" ] && cp -a "$V" "$B"; then
  install -d -m 755 /var/www/cozynights && install -m 644 "$R/deploy/nginx/cozy-down.html" /var/www/cozynights/
  install -m 644 "$R/deploy/nginx/test-cozynights.hamburn.de.conf" "$V"
  if nginx -t; then systemctl reload nginx && echo "neuer vhost aktiv, alter in $B"; else cp -a "$B" "$V" && echo "nginx -t gescheitert: alter vhost zurück, nichts neu geladen"; fi
else echo "$V fehlt — Pfad prüfen: ls -l /etc/nginx/sites-enabled/"; fi
curl -sI https://test-cozynights.hamburn.de/ | head -n1
```

```bash
# Produktion (der vhost bindet die Schranke ein: /etc/nginx/snippets/cozynights-gate.conf aus P2)
R=/opt/hamburn-cozynights-production/hamburn-cozynights
V=/etc/nginx/sites-available/cozynights.hamburn.de
B=/root/vhost-cozynights.hamburn.de.$(date +%Y%m%d-%H%M%S)
if [ -f "$V" ] && cp -a "$V" "$B"; then
  install -d -m 755 /var/www/cozynights && install -m 644 "$R/deploy/nginx/cozy-down.html" /var/www/cozynights/
  install -m 644 "$R/deploy/nginx/cozynights.hamburn.de.conf" "$V"
  if nginx -t; then systemctl reload nginx && echo "neuer vhost aktiv, alter in $B"; else cp -a "$B" "$V" && echo "nginx -t gescheitert: alter vhost zurück, nichts neu geladen"; fi
else echo "$V fehlt — Pfad prüfen: ls -l /etc/nginx/sites-enabled/"; fi
cozynights-gate status
```

Erwartet: Staging `HTTP/2 200`; Produktion wie vorher (Schranke an: Umleitung
zu Google). Zurück zum alten vhost: `cp -a "$B" "$V" && nginx -t && systemctl reload nginx`.

### Notfall: Release-Deploy mit dem alten Skript hängt oder scheitert

Anzeichen: Der Job hängt nach `starting stack` oder endet dort rot, ohne
`rolling back`; die Seite ist down. Das alte Skript hat dann den neuen Commit
ausgecheckt, das neue App-Image gebaut (es trägt jetzt schon den Tag
`…-app:latest`, das vorige ist ohne Tag), PocketBase gestoppt, gesichert und
mit dem neuen Code gestartet — und rollt nicht zurück. Als root, erst die
Werte des Stacks, dann die Schritte der Reihe nach in derselben Shell:

```bash
# Staging
APP_DIR=/opt/hamburn-cozynights-staging
export COMPOSE_PROJECT_NAME=hamburn-cozynights
F=docker-compose.staging.yml
SCRIPT=deploy-cozynights-staging
VOL=hamburn-cozynights_pb_data_staging
BK=/var/backups/cozynights-staging
HEALTH=http://127.0.0.1:3001/api/health
```

```bash
# Produktion
APP_DIR=/opt/hamburn-cozynights-production
export COMPOSE_PROJECT_NAME=cozynights-production
F=docker-compose.production.yml
SCRIPT=deploy-cozynights-production
VOL=cozynights-production_pb_data
BK=/var/backups/cozynights-production
HEALTH=http://127.0.0.1:3002/api/health
```

1. Den hängenden Deploy beenden (erst das Skript, dann sein `compose up`):

```bash
pgrep -af "$SCRIPT|$F up"
pkill -f "/usr/local/bin/$SCRIPT"; pkill -f "$F up"; sleep 2
pgrep -af "$SCRIPT|$F up" || echo "nichts läuft mehr"
```

2. Den vorigen Commit bestimmen. Das alte Skript schreibt kein Log auf dem
   Server; im Actions-Log steht er als `current:`, im Checkout im Reflog, und
   das Archiv dieses Deploys endet auf seine ersten 7 Zeichen:

```bash
PREV=$(sudo -u deploy git -C "$APP_DIR" reflog -n1 --format=%gs | sed -n 's/^checkout: moving from \([0-9a-f]\{40\}\) to .*/\1/p')
echo "PREV=$PREV"; sudo -u deploy git -C "$APP_DIR" log --oneline -1 "$PREV"
ls -1t "$BK"/pb_data-*.tar.gz | head -n1
```

   `PREV` muss mit `current:` aus dem Actions-Log übereinstimmen; ist es leer
   oder anders, von Hand setzen: `PREV=<40-stellige SHA aus current:>`.

3. Zurück auf `PREV`, das vorige Image neu bauen (`:latest` ist das neue) und
   starten. PocketBase startet dabei mit den Migrationen und Hooks von `PREV`
   (Bind-Mount aus dem Checkout):

```bash
sudo -u deploy git -C "$APP_DIR" checkout --quiet --detach "$PREV"
cd "$APP_DIR/hamburn-cozynights"
GIT_SHA=$PREV docker compose -f "$F" build app
timeout 600 docker compose -f "$F" up -d --remove-orphans
curl -s "$HEALTH"; echo   # "status":"ok" und "commit" = $PREV
```

   Kommt `up` auch so nicht hoch: `docker compose -f "$F" logs --tail 50 pocketbase`.

4. Datenbank: Nur wenn eine Migration des Releases angewendet wurde, das
   Archiv dieses Deploys einspielen. Scheitert eine Migration, nimmt
   PocketBase alle neuen Migrationen dieses Starts zusammen zurück; dann gibt
   es nichts einzuspielen. Prüfen (Migrationen in der Datenbank, die `PREV`
   nicht kennt; keine Ausgabe = keine):

```bash
D=$(docker volume inspect -f '{{.Mountpoint}}' "$VOL") && sqlite3 -readonly "$D/data.db" ".backup /tmp/cozy-mig.db" && comm -23 <(sqlite3 -readonly /tmp/cozy-mig.db "SELECT file FROM _migrations WHERE file LIKE '%.js';" | LC_ALL=C sort) <(ls "$APP_DIR/hamburn-cozynights/pb_migrations" | LC_ALL=C sort); rm -f /tmp/cozy-mig.db
```

   Steht dort etwas: Abschnitt Rollback → Daten mit
   `BACKUP=` dem neuesten `pb_data-*-<erste 7 Zeichen von PREV>.tar.gz` aus
   Schritt 2 (verwirft, was seit dem Snapshot geschrieben wurde — während des
   kaputten Deploys in der Regel nichts). Steht dort nur
   `1761100000_one_spot_per_ticket.js`, reicht statt des Restores, den Index
   zu löschen (Rollback → „Nach einem Rollback über v1.32.3“).

5. Ursache beheben (meist: ein Ticket mit zwei Plätzen, Prüfung „Vor einem
   Release“), dann den Release-Deploy noch einmal starten. Ein noch laufender
   Actions-Job: `gh run cancel <run-id>`.

## Exit-Codes

| Code | Bedeutung | Stand danach |
| --- | --- | --- |
| 0 | deployt | neu |
| 1 | Health-Check gescheitert oder `up -d` nicht binnen `UP_TIMEOUT` fertig, zurückgerollt | alt |
| 2 | Aufruf ohne 40-stellige SHA | unverändert |
| 3 | ein anderer Deploy läuft noch | unverändert |
| 4 | lokale Änderungen im Checkout | unverändert |
| 5 | Commit nicht auf origin | unverändert |
| 6 | Build gescheitert | unverändert |
| 7 | kein PocketBase-Volume (Erst-Deploy: `ALLOW_NO_BACKUP=1`) | unverändert |
| 8 | Snapshot-Helfer-Image nicht ladbar | unverändert |
| 9 | Snapshot gescheitert | unverändert, PocketBase wieder gestartet |
| 10 | Commit auf keinem Branch aus `REQUIRE_BRANCH` | unverändert |
| 11 | Downgrade ohne `ALLOW_DOWNGRADE=1` | unverändert |
| 12 | Commit ohne vertrauenswürdige Signatur | unverändert |
| 13 | Compose-Datei nicht freigegeben (Pin) | unverändert |
| 14 | Signatur- oder Pin-Config kaputt (Schlüsselbund, Fingerprints, gpg, Pin-Datei) | unverändert |
| 15 | unerwarteter Fehler, Zeile und Befehl im Log | vom Trap wiederhergestellt |
| 16 | auch der alte Stand kam nicht hoch (Rollback unhealthy oder sein `up` lief in `UP_TIMEOUT`), oder der Trap konnte ihn nicht herstellen | **Handarbeit:** Log lesen (`manual intervention needed`) |
| 129/130/143 | durch ein Signal beendet (`kill -- -<pid>`) | vom Trap wiederhergestellt |

## Deployen

GitHub → Actions → **Deploy staging** → **Run workflow** → Branch wählen.
Oder vom Mac:

```bash
gh workflow run deploy-staging.yml --ref integration/staging
gh run watch
```

Der Branch muss diesen Workflow enthalten, und der Server nimmt nur Commits,
die auf `integration/staging` oder `main` liegen (`REQUIRE_BRANCH`, Exit 10),
nicht älter als der laufende sind (Exit 11) und, mit Signatur-Schranke,
signiert sind (Exit 12).

### Vor einem Release: ein Platz pro Ticket

Seit v1.32.3 erzwingt die Datenbank „ein Platz pro Ticket“ (Unique-Index
`idx_beds_order_unique` auf `beds.order`, Migration
`1761100000_one_spot_per_ticket.js`). Hält ein Ticket schon zwei Plätze, bricht
die Migration ab und nennt Ticket und Plätze im PocketBase-Log: PocketBase
startet nicht. Die Datenbank bleibt dabei unverändert (PocketBase nimmt alle
neuen Migrationen eines Starts zusammen zurück), aber die Seite ist down. Was
dann passiert, hängt vom installierten Deploy-Skript ab:

- **Altes Skript** (vor dem Umstieg, also auch beim Deploy von v1.32.3 selbst):
  **kein Rollback.** `docker compose up -d` wartet auf ein gesundes PocketBase,
  ewig oder bis Compose aufgibt; der Job hängt bis zum Timeout der Action
  (20 min) oder wird rot, die Seite bleibt down, bis root aufräumt:
  „Notfall: Release-Deploy mit dem alten Skript hängt oder scheitert“.
- **Neues Skript:** `up` gibt nach `UP_TIMEOUT` (300 s) auf, das Skript startet
  das `:prev`-Image wieder (Exit 1). Die Seite ist ein paar Minuten down.

Darum **vor jedem Release Pflicht**, als root auf einer Kopie (ändert nichts;
keine Ausgabe = sauber; das Release-Skript prüft es ebenfalls):

```bash
# Staging
D=$(docker volume inspect -f '{{.Mountpoint}}' hamburn-cozynights_pb_data_staging) && sqlite3 -readonly "$D/data.db" ".backup /tmp/cozy-precheck.db" && sqlite3 -readonly /tmp/cozy-precheck.db "SELECT \"order\", COUNT(*), GROUP_CONCAT(label || ' (' || id || ')', ', ') FROM beds WHERE \"order\" != '' GROUP BY \"order\" HAVING COUNT(*) > 1;"; rm -f /tmp/cozy-precheck.db
```

```bash
# Produktion
D=$(docker volume inspect -f '{{.Mountpoint}}' cozynights-production_pb_data) && sqlite3 -readonly "$D/data.db" ".backup /tmp/cozy-precheck.db" && sqlite3 -readonly /tmp/cozy-precheck.db "SELECT \"order\", COUNT(*), GROUP_CONCAT(label || ' (' || id || ')', ', ') FROM beds WHERE \"order\" != '' GROUP BY \"order\" HAVING COUNT(*) > 1;"; rm -f /tmp/cozy-precheck.db
```

Steht dort eine Zeile, entscheidet die Crew, welcher Platz falsch ist, und
gibt ihn frei (Lageplan oder Dashboard über den Tunnel); dann noch einmal
prüfen und erst danach deployen.

## Rollback

**Automatisch:** Scheitert der Health-Check oder kommt `docker compose up -d`
nicht binnen `UP_TIMEOUT` (300 s) zurück, checkt das Skript den vorigen Commit
aus und startet das Image, das vor dem Deploy lief (`<image>:prev`), ohne
Neubau (Exit 1). Nur wenn es keins gibt (vorher lief keine App), baut es den
vorigen Commit neu. Kommt auch der vorige Stand nicht hoch (auch dessen `up`
ist begrenzt), endet es mit Exit 16 und `manual intervention needed`: dann im
Log `compose logs` von PocketBase lesen (häufig: falscher `PB_ENCRYPTION_KEY`
in der `.env`, das hilft kein Rollback).

**Code, absichtlich:** Am besten vorwärts: `git revert` auf einem Branch,
signiert, PR, normal deployen. Einen älteren Commit selbst verweigert das
Skript (Downgrade, Exit 11), bis root es für genau diesen Lauf erlaubt; mit
Signatur-Schranke muss der alte Commit selbst signiert sein:

```bash
CONF=/etc/cozynights/deploy-staging.conf     # bzw. deploy-production.conf
OLD=<40-stellige SHA>                        # muss auf einem REQUIRE_BRANCH liegen
echo 'ALLOW_DOWNGRADE=1' >> "$CONF"
sudo -u deploy /usr/local/bin/deploy-cozynights-staging "deploy $OLD"   # bzw. …-production
sed -i '/^ALLOW_DOWNGRADE=/d' "$CONF"
```

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

### Nach einem Rollback über v1.32.3: der Index bleibt

Gilt für jeden Weg zurück auf v1.32.2 oder älter (automatisch per `:prev`,
`ALLOW_DOWNGRADE`, von Hand). PocketBase führt beim Zurückrollen keinen
Down-Zweig einer Migration aus: Hat es `1761100000_one_spot_per_ticket.js`
angewendet, bleibt der Unique-Index `idx_beds_order_unique` in der Datenbank.
Der alte Code belegt beim Umbuchen erst den neuen Platz und gibt dann den alten
frei; mit dem Index scheitern so Platzwechsel und Tausch („UNIQUE constraint
failed“). Das Skript meldet den Fall im Log
(`the index idx_beds_order_unique stays`). Prüfen, als root (keine Ausgabe =
kein Index, nichts zu tun; Produktion: `cozynights-production_pb_data`):

```bash
D=$(docker volume inspect -f '{{.Mountpoint}}' hamburn-cozynights_pb_data_staging) && sqlite3 -readonly "$D/data.db" ".backup /tmp/cozy-idx.db" && sqlite3 -readonly /tmp/cozy-idx.db "SELECT name FROM sqlite_master WHERE name = 'idx_beds_order_unique';"; rm -f /tmp/cozy-idx.db
```

Entfernen im PocketBase-Dashboard, nicht mit `sqlite3` (PocketBase hält sein
Schema im Speicher und in `_collections`): Tunnel vom Mac
`ssh -N -L 8091:127.0.0.1:8091 <server>` (Produktion 8092), dann
`http://127.0.0.1:8091/_/` als Superuser.

1. Settings → Application → „Hide collection create and edit controls“
   ausschalten → Save (auf den Servern an, `PB_HIDE_CONTROLS`; ohne das fehlt
   das Zahnrad).
2. Collections → `beds` → Zahnrad → Indexes → `idx_beds_order_unique` löschen
   → Save. PocketBase entfernt den SQL-Index selbst und hält sein Schema
   stimmig.
3. Settings → Application → den Schalter wieder einschalten → Save (spätestens
   der nächste Neustart schaltet ihn auch wieder ein).

**Später wieder v1.32.3 oder neuer deployen:** Die Migration steht in
`_migrations` als angewendet und läuft nie wieder (geprüft mit PocketBase
0.40.4), der Index kommt also **nicht** von selbst zurück. Nach der
Ein-Platz-Prüfung („Vor einem Release“) im Dashboard wie oben unter Indexes →
„New index“ genau diesen Inhalt eintragen und speichern (scheitert, solange
ein Ticket zwei Plätze hält):

```sql
CREATE UNIQUE INDEX `idx_beds_order_unique` ON `beds` (`order`) WHERE `order` != ''
```

Im Zweifel eine Claude-Session fragen. Ist die Migration damals gar nicht
durchgelaufen (der Deploy scheiterte genau an ihr), steht sie nicht in
`_migrations` und läuft beim nächsten Deploy ganz normal.

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

- Nach einer Änderung am Skript (zuletzt v1.32.3) erst deployen, dann
  installieren, erst Staging, dann Produktion, mit Trockenlauf dazwischen:
  Abschnitt „Umstieg auf das gehärtete Deploy-Skript“.
- Logs eines Deploys: im GitHub-Actions-Run und auf dem Server in
  `/var/backups/cozynights-staging/deploy-<UTC>-<sha7>.log` (die letzten 20).
  Reißt die SSH-Verbindung ab (Netz, `command_timeout` der Action), läuft der
  Deploy auf dem Server zu Ende, der Job wird nur rot; wie er ausging, steht
  in der letzten Zeile des neuesten Logs (`exit <code>`, siehe Exit-Codes):
  `tail -n 3 "$(ls -1t /var/backups/cozynights-staging/deploy-*.log | head -n1)"`.
  Einen laufenden Deploy abbrechen: `kill -- -<pid>` (die ganze Prozessgruppe;
  die pid steht in der zweiten Zeile des Logs). Ein laufendes `docker build`
  endet damit sofort, ein laufendes `compose up` stoppt das Skript selbst; dann
  stellt der Trap den alten Stand her (Exit 143, oder 16, wenn das nicht
  gelingt). Ein bloßes `kill <pid>` wartet, bis ein laufendes `docker build`
  oder `git` fertig ist.
- App-Logs: `docker logs --tail 100 cozynights-staging-app`.
- Das Testgerüst des Skripts läuft auf dem Mac in einem Wegwerf-Container
  (`debian:12`, Docker als Attrappe, keine Ports):
  `bash hamburn-cozynights/deploy/test/deploy-script.test.sh`.

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
2. Die Mail kommt innerhalb etwa einer Minute (Betreff mit `[STAGING]`): der Platz,
   der QR-Code als Bild in der Mail, darunter Link und Code des Buchungsnachweises.
   Die Testmail von `notify test --email` trägt einen Beispiel-QR-Code; damit vor
   einem Release in Gmail, Apple Mail und Outlook prüfen, ob das Bild erscheint.
3. Im Zimmer „✈️ Get updates on Telegram“ → im Bot START → „✅ Connected! …“ mit dem
   Platz, dem QR-Code als Bild und dem Knopf „Show booking pass“. `/pass` schickt den
   Pass noch einmal, das Bot-Menü zeigt /pass, /stop und /help. Verbinden geht auch
   über `/telegram`, dort auch ohne Platz.
4. „🎫 Show booking pass“ → QR-Code und Code.
5. Als Admin: den QR-Code mit der Handy-Kamera scannen (im selben Browser bei `/admin`
   angemeldet) → „✅ Check in“, oder im Admin-Menü „🎫 Check-in“ → Code eintippen →
   ✅ CHECKED IN. Das checkt den Gast wirklich ein, und danach kann er seinen Platz
   nicht mehr freigeben: für Schritt 6 erst „↩️ Undo check-in“.
6. Platz wechseln (freigeben und innerhalb einer Minute einen anderen buchen) →
   **eine** Nachricht „changed“ per Mail und Telegram. Platz freigeben → „released“, die
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

Produktion bekommt nur freigegebenen Code, mehrfach geprüft: der Workflow
verweigert jeden Ref außer `main`, das GitHub-Environment `production` lässt nur
`main` zu und wartet auf die Freigabe, und das Deploy-Skript verweigert einen
Commit, der nicht auf `origin/main` liegt (`REQUIRE_BRANCH=main`), der älter
als der laufende ist, der nicht von dir (oder als sauberer GitHub-Merge)
signiert ist, oder dessen Compose-Datei root nicht freigegeben hat (Schritt 5
der Einrichtung).

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
`main`, keine Umgehung für Admins. Danach Signatur-Schranke und Compose-Pin
mit den Produktions-Blöcken aus Schritt 5 der Staging-Einrichtung.

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
