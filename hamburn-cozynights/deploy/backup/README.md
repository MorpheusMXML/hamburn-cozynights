# Server-Backups (restic: erst lokal, später Hetzner Storage Box)

Zwei Stufen, dasselbe Skript, derselbe Timer. Der Unterschied ist eine Zeile
in der Konfiguration:

- **Stufe 1 (jetzt):** verschlüsseltes restic-Repository **auf dem Server**
  unter `/var/backups/restic`. In einer Viertelstunde eingerichtet, kostet
  nichts.
- **Stufe 2 (später):** dasselbe Repository auf einer Hetzner Storage Box.
  Erst damit übersteht das Backup auch den Verlust des Servers.

## Überblick

### Was die Daten heute schon schützt (ohne Einrichtung)

| Ebene          | Inhalt               | Ort                               | Takt                       | Hilft bei                                   |
| -------------- | -------------------- | --------------------------------- | -------------------------- | ------------------------------------------- |
| PocketBase-ZIP | komplettes `pb_data` | im Volume, Ordner `backups/`      | stündlich, 72 Stück        | „vor einer Stunde war es noch richtig“      |
| Deploy-Archiv  | Volume als `tar.gz`  | `/var/backups/cozynights-staging` | vor jedem Deploy, 10 Stück | Deploy hat Daten beschädigt: zurückrollen   |

Die ZIPs schreibt PocketBase selbst (`pb_hooks/cozy_backups.pb.js`, läuft ab
dem ersten Deploy mit diesem Stand; Takt und Anzahl: `PB_BACKUP_CRON` /
`PB_BACKUP_KEEP` in der `.env`). Die Archive zieht das Deploy-Skript.

Beide enthalten die komplette Datenbank. Die PocketBase-Settings darin
(SMTP-Passwort) sind mit `PB_ENCRYPTION_KEY` verschlüsselt, das
Google-Client-Secret des Admin-Logins aber nicht (PocketBase legt es in den
Collection-Optionen ab, außerhalb dieser Verschlüsselung). Backups bleiben
deshalb Geheimnisträger: nur root liest sie, und ein abgeflossenes Backup
heißt, das Client-Secret in der Google-Console zu erneuern.

### Was das lokale restic-Repository dazu bringt

- **Versioniert:** stündliche Stände für 24 Stunden, danach tägliche für
  14 Tage, wöchentliche für 8 Wochen, monatliche für 12 Monate. Die ZIPs
  reichen nur drei Tage zurück.
- **Alle Datenbanken des Servers, konsistent:** CozyNights, Vaultwarden und
  Listmonk. Eine laufende Datenbank wird nie als Datei kopiert (das kann eine
  kaputte Kopie ergeben), sondern über die Online-Backup-API von SQLite
  (`sqlite3 .backup`) bzw. `pg_dump`. Jede Kopie wird mit
  `PRAGMA integrity_check` geprüft.
- **Dazu alles für den Wiederaufbau:** `.env`-Dateien (darin `ENCRYPTION_KEY`
  und `PB_ENCRYPTION_KEY`), nginx, Zertifikate, Vaultwarden-Daten.
- **Verschlüsselt und dedupliziert:** Ein Lauf ohne Änderungen kostet ein paar
  Kilobyte. Weil das Repository verschlüsselt ist, darf eine Kopie davon auch
  auf einem Laptop liegen.
- **Getestet:** Einmal pro Woche prüft das Skript das Repository und stellt
  die neuesten Datenbank-Kopien testweise wieder her.
- **Meldet sich:** Jeder Fehler geht als Nachricht an `ALERT_WEBHOOK_URL`,
  ebenso eine volllaufende Platte.

**Nicht** im Backup, weil schon im Git-Repository: Code, Datenbankschema
(`pb_migrations/`), Hooks (`pb_hooks/`) und Location-Templates.

Alle drei Ebenen liegen in Stufe 1 auf **derselben Platte** wie die
Datenbank. Was das bedeutet und was bis zur Storage Box dagegen hilft, steht
unter [Was lokal NICHT schützt](#was-lokal-nicht-schützt). Das
[Notfallblatt](#notfallblatt) gilt ab dem ersten Tag.

## Stufe 1: lokal einrichten

Einmalig, alles als `root`.

### 0. Bestandsaufnahme (ändert nichts)

```bash
docker ps --format '{{.Names}}\t{{.Image}}'
docker volume ls
docker inspect -f '{{.Name}}: {{range .Mounts}}{{.Source}} -> {{.Destination}}  {{end}}' $(docker ps -q)
df -h /var/backups
```

Notieren:

- Name des PocketBase-Volumes (Ziel `/pb_data`), für Staging normalerweise
  `hamburn-cozynights_pb_data_staging`.
- Datenverzeichnis von Vaultwarden (Ziel `/data` im Container). Darin liegt
  `db.sqlite3`.
- Name des Postgres-Containers von Listmonk sowie Datenbankbenutzer und
  Datenbankname (siehe `/opt/docker-compose.yml`).
- Freier Platz. Das Skript warnt unter 5 GB oder unter 15 % frei.

### 1. Pakete

```bash
apt-get update && apt-get install -y restic sqlite3 jq curl rsync
restic version
```

Erwartet: restic 0.14 oder neuer (Debian 12).

### 2. Skript, Konfiguration und Timer installieren

Aus dem Git-Stand auf dem Server, wie beim Deploy-Skript (root-owned,
außerhalb des Checkouts):

```bash
APP_DIR=/opt/hamburn-cozynights-staging
REF=origin/main   # solange das Paket noch nicht in main ist: origin/<branch>
sudo -u deploy git -C "$APP_DIR" fetch origin
show() { sudo -u deploy git -C "$APP_DIR" show "$REF:hamburn-cozynights/deploy/backup/$1"; }
show server-backup.sh > /tmp/server-backup && install -o root -g root -m 755 /tmp/server-backup /usr/local/sbin/server-backup && rm /tmp/server-backup
show server-backup.service > /etc/systemd/system/server-backup.service
show server-backup.timer > /etc/systemd/system/server-backup.timer
install -d -m 700 /etc/server-backup
[ -f /etc/server-backup/backup.conf ] || show backup.conf.example > /etc/server-backup/backup.conf
chmod 600 /etc/server-backup/backup.conf
systemctl daemon-reload
```

Dann `/etc/server-backup/backup.conf` anpassen (`nano`):

- Block **A) Local repository** ist schon aktiv, Block B bleibt
  auskommentiert.
- Volume-Name, Vaultwarden- und Listmonk-Einträge mit den Werten aus
  Schritt 0.
- Einträge für Dienste, die es nicht gibt, löschen. Ein fehlender Pfad ist
  ein Fehler, er wird nicht still übersprungen.
- `ALERT_WEBHOOK_URL`: dieselbe Telegram-URL wie `COZY_ADMIN_WEBHOOK_URL` in
  der CozyNights-`.env`.

### 3. Passwort und Repository anlegen

```bash
[ -f /etc/server-backup/restic-password ] || (umask 077; openssl rand -base64 33 > /etc/server-backup/restic-password)
server-backup --init
ls -ld /var/backups/restic/*
cat /etc/server-backup/restic-password
```

Erwartet: `repository created: /var/backups/restic/<hostname>`, das
Verzeichnis gehört `root` mit `drwx------`. Ein zweiter Aufruf ändert nichts
(`repository already exists`).

Das Passwort **jetzt** auf das [Notfallblatt](#notfallblatt) und in den
Passwortmanager. Ohne dieses Passwort ist das Backup nicht lesbar. Die Datei
wird nie überschrieben, solange sie existiert.

### 4. Erster Lauf und Alarmtest

```bash
server-backup --check
```

Erwartet: je eine `sqlite`/`pg_dump`-Zeile pro Datenbank, dann
`snapshot created`, `retention applied`,
`repository check and restore test passed`, `done`.

Alarm testen (absichtlich falsches Repository, es muss eine Nachricht
kommen):

```bash
SERVER_BACKUP_CONFIG=<(sed 's#^RESTIC_REPOSITORY=.*#RESTIC_REPOSITORY=/var/backups/gibt-es-nicht#' /etc/server-backup/backup.conf) server-backup; echo "exit=$?"
```

Erwartet: `ERROR: no restic repository in /var/backups/gibt-es-nicht`,
`exit=1` und die Nachricht im Chat.

### 5. Timer einschalten

```bash
systemctl enable --now server-backup.timer
systemctl list-timers server-backup.timer --no-pager
```

Das Backup läuft ab jetzt stündlich um Minute 20.

### 6. Optional: Totmannschalter

Der Webhook meldet nur Fehler eines Laufs. Läuft das Skript gar nicht mehr
(Timer aus, Server hängt), kommt keine Nachricht. Dagegen hilft ein
kostenloser Check auf [healthchecks.io](https://healthchecks.io) (Periode
1 Stunde, Karenz 2 Stunden). Dessen Ping-URL als `HEALTHCHECK_URL` eintragen.

## Kontrolle

```bash
systemctl list-timers server-backup.timer --no-pager      # nächster Lauf
journalctl -u server-backup -n 30 --no-pager              # letzte Läufe
set -a; . /etc/server-backup/backup.conf; set +a
restic snapshots --compact | tail -5                      # neueste Snapshots
restic stats --mode raw-data                              # Größe des Repositorys
df -h /var/backups                                        # freier Platz
```

Die PocketBase-ZIPs:

```bash
ls -lh "$(docker volume inspect -f '{{.Mountpoint}}' hamburn-cozynights_pb_data_staging)/backups" | tail -5
```

**Meldung „Platte läuft voll“** (der Lauf endet mit `exit 3`, der Snapshot
wurde trotzdem erstellt): Platz schaffen, zum Beispiel mit
`docker image prune -a` und `journalctl --vacuum-size=200M`. Die Schwellen
stehen als `MIN_FREE_GB` / `MIN_FREE_PERCENT` in der `backup.conf`. Die
Meldung kommt höchstens einmal am Tag.

### Wartung

- Ändert sich das Skript im Repo, Schritt 2 wiederholen. Die vorhandene
  `backup.conf` bleibt dabei erhalten.
- Neue Umgebung (zum Beispiel Produktion): Datenbank in `SQLITE_DBS` und
  `.env` in `BACKUP_PATHS` eintragen, dann `server-backup` einmal von Hand
  starten.
- Speichert eine Umgebung später Dateien in PocketBase (etwa ein Kartenbild),
  deren `storage`-Ordner als `volume:<volume>:storage` in `BACKUP_PATHS`
  aufnehmen.
- Das lokale Repository darf unterhalb eines gesicherten Pfads liegen (etwa
  `/var/backups`): Das Skript nimmt es immer aus dem Backup aus.

## Wiederherstellen

### A. Schnelles Undo: PocketBase-ZIP über das Dashboard

Für „vor einer Stunde war es noch richtig“. Auf dem Mac einen SSH-Tunnel zum
Dashboard öffnen (PocketBase ist von außen nicht erreichbar):

```bash
ssh -N -L 8091:127.0.0.1:8091 root@<server>
```

Dann http://127.0.0.1:8091/_/ öffnen, anmelden → **Settings** → **Backups** →
gewünschtes `@auto_pb_backup_…` → **Restore**. PocketBase startet sich dabei
selbst neu, nach wenigen Sekunden ist der alte Stand aktiv. Alles, was nach
dem Zeitpunkt des ZIPs gebucht wurde, ist danach weg. Die übrigen ZIPs bleiben
erhalten. Zum Schluss die App neu starten, damit sie sich frisch verbindet:

```bash
docker restart cozynights-staging-app
```

### restic: Umgebung laden und Snapshot wählen

Für B bis E immer zuerst:

```bash
set -a; . /etc/server-backup/backup.conf; set +a
restic snapshots --compact
SNAP=latest   # oder eine ID aus der Liste
```

### B. Einzelne Datenbank: CozyNights aus restic

Beispiel Staging. Für Produktion `NAME`, `VOLUME`, `APP_DIR` und
Compose-Datei anpassen:

```bash
NAME=cozynights-staging                       # Name aus SQLITE_DBS
VOLUME=hamburn-cozynights_pb_data_staging
APP_DIR=/opt/hamburn-cozynights-staging
rm -rf /tmp/restore && restic restore "$SNAP" --target /tmp/restore --include "/var/backups/server-backup/dumps/$NAME.db"
sqlite3 "/tmp/restore/var/backups/server-backup/dumps/$NAME.db" 'PRAGMA integrity_check;'
```

Erwartet: `ok`. Dann einspielen. Der aktuelle Stand wird vorher gesichert:

```bash
source /etc/cozynights/deploy-staging.conf; export COMPOSE_PROJECT_NAME
cd "$APP_DIR/hamburn-cozynights"
docker compose -f docker-compose.staging.yml stop app pocketbase
MP=$(docker volume inspect -f '{{.Mountpoint}}' "$VOLUME")
install -d -m 700 /var/backups/server-backup/before-restore
tar czf "/var/backups/server-backup/before-restore/$VOLUME-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" --exclude=./backups -C "$MP" .
rm -f "$MP/data.db" "$MP/data.db-wal" "$MP/data.db-shm"
cp "/tmp/restore/var/backups/server-backup/dumps/$NAME.db" "$MP/data.db"
docker compose -f docker-compose.staging.yml up -d
rm -rf /tmp/restore
```

Die Migrationen sind idempotent: PocketBase startet auch mit einem älteren
Stand und ergänzt fehlende Felder.

### C. Ganzes PocketBase-Volume

**Stand vor einem Deploy:** das Archiv aus `/var/backups/cozynights-staging`
einspielen, siehe [`deploy/README.md`](../README.md#rollback), Abschnitt
„Rollback → Daten“.

**Volume kaputt, gelöscht oder neuer Server:** aus restic neu aufbauen. Erst
die Datenbank wie in B nach `/tmp/restore` holen und prüfen (erster Block),
dann:

```bash
source /etc/cozynights/deploy-staging.conf; export COMPOSE_PROJECT_NAME
cd "$APP_DIR/hamburn-cozynights"
docker compose -f docker-compose.staging.yml up --no-start pocketbase   # legt ein fehlendes Volume an
docker compose -f docker-compose.staging.yml stop app pocketbase
MP=$(docker volume inspect -f '{{.Mountpoint}}' "$VOLUME")
install -d -m 700 /var/backups/server-backup/before-restore
tar czf "/var/backups/server-backup/before-restore/$VOLUME-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" --exclude=./backups -C "$MP" .
find "$MP" -mindepth 1 -maxdepth 1 ! -name backups -exec rm -rf {} +
cp "/tmp/restore/var/backups/server-backup/dumps/$NAME.db" "$MP/data.db"
docker compose -f docker-compose.staging.yml up -d
rm -rf /tmp/restore
```

PocketBase legt alles Übrige im Volume (Log-Datenbank, Typdatei) beim Start
selbst neu an. Der Ordner `backups/` mit den ZIPs bleibt stehen. Liegt ein
`storage`-Ordner im Backup (siehe Wartung), ihn vor dem `up -d` aus
`/tmp/restore` zurück in das Volume kopieren.

Die Settings in der Datenbank sind mit dem `PB_ENCRYPTION_KEY` der `.env`
verschlüsselt, die zum selben Stand gehört (sie liegt im selben Snapshot).
Mit einem anderen Schlüssel startet PocketBase nicht — dann die
Settings-Zeile löschen, wie unter „PocketBase-Settings-Schlüssel“ in
[`deploy/README.md`](../README.md#pocketbase-settings-schlüssel) beschrieben.

### D. Vaultwarden aus restic

```bash
VW_DATA=/path/to/vaultwarden/data   # ← aus backup.conf
VW_CONTAINER=vaultwarden            # ← docker ps
rm -rf /tmp/restore && restic restore "$SNAP" --target /tmp/restore --include /var/backups/server-backup/dumps/vaultwarden.db --include "$VW_DATA"
sqlite3 /tmp/restore/var/backups/server-backup/dumps/vaultwarden.db 'PRAGMA integrity_check;'
docker stop "$VW_CONTAINER"
install -d -m 700 /var/backups/server-backup/before-restore
tar czf "/var/backups/server-backup/before-restore/vaultwarden-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C "$VW_DATA" .
cp -a "/tmp/restore$VW_DATA/." "$VW_DATA/"
rm -f "$VW_DATA/db.sqlite3-wal" "$VW_DATA/db.sqlite3-shm"
cp /tmp/restore/var/backups/server-backup/dumps/vaultwarden.db "$VW_DATA/db.sqlite3"
docker start "$VW_CONTAINER"
rm -rf /tmp/restore
```

### E. Listmonk aus restic

```bash
PG_CONTAINER=listmonk_db   # ← aus backup.conf (PG_DUMPS)
rm -rf /tmp/restore && restic restore "$SNAP" --target /tmp/restore --include /var/backups/server-backup/dumps/listmonk.pgdump
docker stop listmonk        # ← App-Container, die Datenbank läuft weiter
docker exec -i "$PG_CONTAINER" pg_restore -U listmonk -d listmonk --clean --if-exists < /tmp/restore/var/backups/server-backup/dumps/listmonk.pgdump
docker start listmonk
rm -rf /tmp/restore
```

### F. Server komplett verloren

In Stufe 1 geht das nur, wenn es eine Kopie **außerhalb** des Servers gibt
(siehe nächster Abschnitt). Sonst sind die Daten weg.

1. Gibt es ein Hetzner-Backup oder einen Snapshot: Server daraus neu
   aufbauen. Danach bei Bedarf B bis E für den letzten stündlichen Stand aus
   dem mit zurückgekommenen Repository. Fertig.
2. Sonst neuen Debian-Server anlegen, die Cloud Firewall (22/80/443)
   zuweisen, DNS auf die neue IP umstellen und Docker, nginx, certbot,
   restic, sqlite3, jq, rsync installieren.
3. Repository zurückholen. Aus der Kopie auf dem Mac:
   `rsync -a ~/Backups/cozynights-restic/ root@<neuer-server>:/var/backups/restic/`.
   In Stufe 2 stattdessen die Storage Box mit **neuem** SSH-Key verbinden
   (Stufe 2, Schritt 2).
4. Schritt 2 von Stufe 1 wiederholen, das restic-Passwort vom Notfallblatt
   nach `/etc/server-backup/restic-password` (Modus 600).
5. Konfiguration zurückholen:
   `restic restore latest --target / --include /etc/nginx --include /etc/letsencrypt --include /etc/cozynights`,
   ebenso die `.env`-Dateien und die Vaultwarden-Daten.
6. CozyNights-Checkouts neu klonen (`deploy/README.md`), Stacks mit
   `docker compose up -d` starten, danach C bis E.

## Stufe 2: auf die Storage Box umziehen

Alles aus Stufe 1 bleibt, nur das Ziel ändert sich. Alles als `root`.

### 1. Storage Box bestellen

Hetzner Console → **Storage Box** → **BX11** (1 TB, rund 4 € im Monat),
Standort Deutschland. Den Benutzernamen (`u123456`) und das Passwort sofort in
den Passwortmanager **und** auf das Notfallblatt. Protokolle müssen nicht
freigeschaltet werden: SFTP auf Port 22 ist immer aktiv.

### 2. SSH-Key und Verbindung

```bash
install -d -m 700 /root/.ssh
ssh-keygen -t ed25519 -N "" -C "server-backup@$(hostname)" -f /root/.ssh/storagebox_ed25519
BOX=u123456   # ← Benutzername der Storage Box
cat >> /root/.ssh/config <<EOF

Host storagebox
    HostName $BOX.your-storagebox.de
    User $BOX
    IdentityFile /root/.ssh/storagebox_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 60
EOF
chmod 600 /root/.ssh/config
ssh-keyscan -t ed25519 $BOX.your-storagebox.de 2>/dev/null > /tmp/storagebox.hostkey
ssh-keygen -lf /tmp/storagebox.hostkey
```

Der Fingerprint **muss** `SHA256:XqONwb1S0zuj5A1CDxpOSuD2hnAArV1A3wKY7Z3sdgM`
sein (Hetzner-Doku „Storage Box → Overview → SSH host keys“). Nur dann weiter.
Die beiden `sftp`/`scp`-Befehle fragen nach dem Storage-Box-Passwort. Port 22
braucht den Key im RFC4716-Format:

```bash
cat /tmp/storagebox.hostkey >> /root/.ssh/known_hosts && rm /tmp/storagebox.hostkey
ssh-keygen -e -f /root/.ssh/storagebox_ed25519.pub > /tmp/storagebox_rfc4716.pub
echo "mkdir .ssh" | sftp -o PubkeyAuthentication=no storagebox
scp -o PubkeyAuthentication=no /tmp/storagebox_rfc4716.pub storagebox:.ssh/authorized_keys
rm /tmp/storagebox_rfc4716.pub
echo "ls -la" | sftp -b - storagebox
```

Erwartet: Die letzte Zeile listet das Verzeichnis **ohne** Passwortabfrage.

### 3. Repository auf der Box anlegen

Mit demselben Passwort wie lokal (ein Passwort auf dem Notfallblatt) und
denselben Chunker-Parametern, damit sich die Historie platzsparend kopieren
lässt:

```bash
set -a; . /etc/server-backup/backup.conf; set +a     # noch die lokale Konfiguration
BOX_REPO="sftp:storagebox:restic/$(hostname)"
restic -r "$BOX_REPO" init --from-repo "$RESTIC_REPOSITORY" --from-password-file "$RESTIC_PASSWORD_FILE" --copy-chunker-params
```

### 4. Historie mitnehmen oder neu anfangen

**Entweder** alle bisherigen Snapshots auf die Box kopieren (dauert je nach
Größe einige Minuten, lässt sich gefahrlos wiederholen):

```bash
restic -r "$BOX_REPO" copy --from-repo "$RESTIC_REPOSITORY" --from-password-file "$RESTIC_PASSWORD_FILE"
restic -r "$BOX_REPO" snapshots --compact | tail -5
```

**Oder** neu anfangen: diesen Schritt überspringen. Die alte Historie bleibt
dann nur im lokalen Repository.

### 5. Umschalten

In `/etc/server-backup/backup.conf`:

- in Block A die Zeile `RESTIC_REPOSITORY=…` auskommentieren,
- in Block B die Zeile `RESTIC_REPOSITORY="sftp:storagebox:restic/$(hostname)"`
  aktivieren,
- `/root/.ssh/config` in `BACKUP_PATHS` aufnehmen.

```bash
server-backup --check
```

Erwartet: wie beim ersten Lauf, am Ende `done`. Danach den Alarmtest aus
Stufe 1, Schritt 4 wiederholen. Der Timer läuft unverändert weiter.

### 6. Automatische Snapshots der Storage Box

Hetzner Console → Storage Box → **Snapshots** → automatische Snapshots
aktivieren: täglich, 10 Slots. Diese Snapshots kann niemand über SFTP
löschen, also auch kein Angreifer mit Zugriff auf den Server.

### 7. Das lokale Repository danach

Es bekommt keine neuen Snapshots mehr. Wenn der Platz reicht, als zweite
Kopie der bisherigen Historie ein paar Wochen liegen lassen, danach löschen:

```bash
du -sh /var/backups/restic
rm -rf /var/backups/restic    # erst, wenn die Box zuverlässig läuft
```

Zum Lesen des alten Repositorys:
`restic -r /var/backups/restic/$(hostname) snapshots`. Das schnelle lokale
Undo bleiben die PocketBase-ZIPs und die Deploy-Archive.

## Was lokal NICHT schützt

Solange das Repository nur auf dem Server liegt, hilft es **nicht** bei:

- **Platte oder Server kaputt**: Datenbank, ZIPs, Deploy-Archive und
  Repository liegen auf derselben Platte.
- **Server kompromittiert**: Wer `root` ist, kann das Repository löschen und
  das Passwort daneben lesen.
- **Server oder Projekt gelöscht**, auch aus Versehen in der Hetzner Console.

Bis zur Storage Box gibt es zwei günstige Zwischenlösungen. Am besten beide:

### Wöchentlich auf den Mac ziehen

Das Repository ist verschlüsselt, eine Kopie auf dem Laptop verrät ohne das
restic-Passwort nichts. **Auf dem Mac** (nicht auf dem Server), am besten mit
einer Erinnerung im Kalender:

```bash
mkdir -p ~/Backups/cozynights-restic
rsync -a --exclude 'locks/*' -e ssh root@<server>:/var/backups/restic/ ~/Backups/cozynights-restic/
```

- Absichtlich **ohne** `--delete`: Löscht jemand auf dem Server Snapshots,
  bleiben sie auf dem Mac erhalten. Die Kopie wächst dadurch langsam, bei
  diesen Datenmengen um wenige MB pro Woche.
- Nicht zwischen Minute 20 und 30 starten, dann läuft auf dem Server gerade
  das Backup.
- Ab und zu prüfen (fragt nach dem restic-Passwort):
  `brew install restic`, dann
  `restic -r ~/Backups/cozynights-restic/<hostname> check` und
  `restic -r ~/Backups/cozynights-restic/<hostname> snapshots --compact | tail -3`.

### Hetzner-Backups oder Snapshots des Servers

Hetzner Console → Server → **Backups** aktivieren: tägliche Kopie der ganzen
Platte, 7 Stück, 20 % Aufpreis auf den Serverpreis. Damit ist der Server in
Minuten zurück, mit höchstens einem Tag Datenverlust.

Backups hängen am Server: Wird der Server gelöscht, sind sie mit weg. Ein
**Snapshot** (Server → Snapshots → „Snapshot erstellen“, rund 1 Cent pro GB
und Monat) bleibt auch dann bestehen. Sinnvoll vor dem Nutzertest und vor dem
Event.

Beides schützt nicht, wenn jemand Zugang zur Hetzner Console bekommt. Dafür
ist der Pull auf den Mac da, und später die Storage Box.

## Notfallblatt

Vaultwarden läuft auf **demselben** Server. Folgende Werte müssen deshalb
zusätzlich **außerhalb des Servers** liegen, zum Beispiel ausgedruckt im
Vereinsordner oder in einem zweiten Passwortmanager:

- restic-Passwort (`/etc/server-backup/restic-password`). Ohne es ist jedes
  restic-Backup wertlos, auch die Kopie auf dem Mac.
- `ENCRYPTION_KEY` **jeder** Umgebung (Staging, Produktion). Ohne ihn sind
  Burner-Namen und Ticket-Codes in einem wiederhergestellten Backup
  unbrauchbar, egal aus welcher Ebene es stammt.
- `PB_ENCRYPTION_KEY` **jeder** Umgebung: der Schlüssel der
  PocketBase-Settings. Ohne ihn startet PocketBase aus einem Backup nicht;
  der Ausweg (Settings neu aus der `.env`) steht in `deploy/README.md`.
- Zugang zur Hetzner Console (mit 2FA-Wiederherstellungscodes)
- ab Stufe 2: Benutzername und Passwort der Storage Box
