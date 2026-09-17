# Server-Backups (restic → Hetzner Storage Box)

Ziel: Fällt der Server aus oder wird er kompromittiert, lassen sich CozyNights,
Vaultwarden und Listmonk mit höchstens einer Stunde Datenverlust
wiederherstellen. Dafür reichen eine Storage Box (BX11, 1 TB, 3,20 €/Monat
netto) und ein Skript mit systemd-Timer.

## Was wird wie gesichert

| Ebene                           | Inhalt                                                                              | Ort                               | Takt                                                       | Wofür                                         |
| ------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| PocketBase-ZIP                  | komplettes `pb_data`                                                                | im Volume, `backups/`             | stündlich, 72 Stück                                        | schnelles Undo im Dashboard                   |
| Deploy-Backup                   | Volume als `tar.gz`                                                                 | `/var/backups/cozynights-staging` | vor jedem Deploy, 10 Stück                                 | Deploy zurückrollen                           |
| **restic**                      | konsistente DB-Kopien, `.env`, nginx, Zertifikate, Vaultwarden-Daten, Listmonk-Dump | **Storage Box**, verschlüsselt    | stündlich; behält 24 Stunden, 14 Tage, 8 Wochen, 12 Monate | Server verloren                               |
| Box-Snapshots                   | Stand der Storage Box                                                               | Storage Box (ZFS)                 | täglich, 10 Stück                                          | jemand mit Serverzugang löscht das Repository |
| optional: Hetzner Cloud Backups | ganze Serverplatte                                                                  | Hetzner                           | täglich, 7 Stück                                           | kompletten Server in Minuten zurückholen      |

**Nicht** im Backup, weil schon im Git-Repository: Code, Datenbankschema
(`pb_migrations/`), Hooks (`pb_hooks/`) und Location-Templates.

Die Datenbanken werden nie als Datei kopiert, solange sie laufen (das kann
eine kaputte Kopie ergeben): SQLite über die Online-Backup-API
(`sqlite3 .backup`), PostgreSQL über `pg_dump`. Jede Kopie wird mit
`PRAGMA integrity_check` geprüft. Einmal pro Woche prüft das Skript einen Teil
des Repositorys und stellt die neuesten Datenbank-Kopien testweise wieder
her. Jeder Fehler geht als Nachricht an `ALERT_WEBHOOK_URL`.

## Notfallblatt

Vaultwarden läuft auf **demselben** Server. Folgende Werte müssen deshalb
zusätzlich **außerhalb** liegen, zum Beispiel ausgedruckt im Vereinsordner
oder in einem zweiten Passwortmanager:

- restic-Passwort (`/etc/server-backup/restic-password`)
- Benutzername und Passwort der Storage Box
- Zugang zur Hetzner Console (mit 2FA-Wiederherstellungscodes)
- `ENCRYPTION_KEY` jeder Umgebung. Ohne ihn sind Burner-Namen und Ticket-Codes
  in einem wiederhergestellten Backup unbrauchbar.

## Einrichtung (einmalig, alles als `root`)

### 0. Bestandsaufnahme (ändert nichts)

```bash
docker ps --format '{{.Names}}\t{{.Image}}'
docker volume ls
docker inspect -f '{{.Name}}: {{range .Mounts}}{{.Source}} -> {{.Destination}}  {{end}}' $(docker ps -q)
```

Notieren:

- Datenverzeichnis von Vaultwarden (Ziel `/data` im Container). Darin liegt
  `db.sqlite3`.
- Name des Postgres-Containers von Listmonk sowie Datenbankbenutzer und
  Datenbankname (siehe `/opt/docker-compose.yml`).

### 1. Storage Box bestellen

Hetzner Console → **Storage Box** → **BX11**, Standort Deutschland. Den
Benutzernamen (`u123456`) und das Passwort sofort in Vaultwarden **und** auf das
Notfallblatt. Protokolle müssen nicht freigeschaltet werden: SFTP auf Port 22
ist immer aktiv.

### 2. Pakete und SSH-Key

```bash
apt-get install -y restic sqlite3 jq curl
install -d -m 700 /root/.ssh /etc/server-backup
ssh-keygen -t ed25519 -N "" -C "server-backup@$(hostname)" -f /root/.ssh/storagebox_ed25519
```

### 3. Storage Box verbinden

```bash
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

### 4. restic-Repository anlegen

```bash
openssl rand -base64 33 > /etc/server-backup/restic-password
chmod 600 /etc/server-backup/restic-password
RESTIC_PASSWORD_FILE=/etc/server-backup/restic-password restic -r "sftp:storagebox:restic/$(hostname)" init
cat /etc/server-backup/restic-password
```

Das Passwort in Vaultwarden speichern **und** auf das Notfallblatt schreiben.
Ohne dieses Passwort ist das Backup nicht lesbar, auch nicht für Hetzner.

### 5. Skript, Konfiguration und Timer installieren

Aus `main`, wie beim Deploy-Skript (root-owned, außerhalb des Checkouts):

```bash
APP_DIR=/opt/hamburn-cozynights-staging
sudo -u deploy git -C "$APP_DIR" fetch origin
show() { sudo -u deploy git -C "$APP_DIR" show "origin/main:hamburn-cozynights/deploy/backup/$1"; }
show server-backup.sh > /tmp/server-backup && install -o root -g root -m 755 /tmp/server-backup /usr/local/sbin/server-backup && rm /tmp/server-backup
show server-backup.service > /etc/systemd/system/server-backup.service
show server-backup.timer > /etc/systemd/system/server-backup.timer
[ -f /etc/server-backup/backup.conf ] || show backup.conf.example > /etc/server-backup/backup.conf
chmod 600 /etc/server-backup/backup.conf
systemctl daemon-reload
```

Dann `/etc/server-backup/backup.conf` anpassen (`nano`):

- Vaultwarden- und Listmonk-Einträge mit den Werten aus Schritt 0
- `ALERT_WEBHOOK_URL`: dieselbe Telegram-URL wie `COZY_ADMIN_WEBHOOK_URL` in
  der CozyNights-`.env`
- Einträge für Dienste, die es nicht gibt, löschen. Ein fehlender Pfad ist
  ein Fehler, er wird nicht still übersprungen.

### 6. Erster Lauf

```bash
server-backup --check
```

Erwartet: je eine `sqlite`/`pg_dump`-Zeile pro Datenbank, dann
`snapshot created`, `retention applied`,
`repository check and restore test passed`, `done`.

Alarm testen (absichtlich falsches Repository, es muss eine Nachricht kommen):

```bash
SERVER_BACKUP_CONFIG=<(sed 's#^RESTIC_REPOSITORY=.*#RESTIC_REPOSITORY=sftp:storagebox:gibt-es-nicht#' /etc/server-backup/backup.conf) server-backup; echo "exit=$?"
```

Wenn beides passt, den Timer einschalten:

```bash
systemctl enable --now server-backup.timer
systemctl list-timers server-backup.timer --no-pager
```

### 7. Automatische Snapshots der Storage Box

Hetzner Console → Storage Box → **Snapshots** → automatische Snapshots
aktivieren: täglich, 10 Slots. Diese Snapshots kann niemand über SFTP
löschen, also auch kein Angreifer mit Zugriff auf den Server.

### 8. Optional: Totmannschalter

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
restic stats --mode raw-data                              # belegter Platz
```

## Wiederherstellen

Immer zuerst die restic-Umgebung laden und den Snapshot wählen:

```bash
set -a; . /etc/server-backup/backup.conf; set +a
restic snapshots --compact
SNAP=latest   # oder eine ID aus der Liste
```

### A. Schnelles Undo: PocketBase-ZIP

Für „vor einer Stunde war es noch richtig“: SSH-Tunnel zum Dashboard
(`ssh -N -L 8091:127.0.0.1:8091 root@<server>`), dann
http://127.0.0.1:8091/_/ → Settings → Backups → gewünschtes
`@auto_pb_backup_…` → **Restore**.

### B. CozyNights-Datenbank aus restic

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
tar czf "/var/backups/server-backup/before-restore/$VOLUME-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C "$MP" .
rm -f "$MP/data.db" "$MP/data.db-wal" "$MP/data.db-shm"
cp "/tmp/restore/var/backups/server-backup/dumps/$NAME.db" "$MP/data.db"
docker compose -f docker-compose.staging.yml up -d
rm -rf /tmp/restore
```

Die Migrationen sind idempotent: PocketBase startet auch mit einem älteren
Stand und ergänzt fehlende Felder.

### C. Vaultwarden aus restic

```bash
VW_DATA=/path/to/vaultwarden/data   # ← aus backup.conf
VW_CONTAINER=vaultwarden            # ← docker ps
rm -rf /tmp/restore && restic restore "$SNAP" --target /tmp/restore --include /var/backups/server-backup/dumps/vaultwarden.db --include "$VW_DATA"
sqlite3 /tmp/restore/var/backups/server-backup/dumps/vaultwarden.db 'PRAGMA integrity_check;'
docker stop "$VW_CONTAINER"
tar czf "/var/backups/server-backup/before-restore/vaultwarden-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C "$VW_DATA" .
cp -a "/tmp/restore$VW_DATA/." "$VW_DATA/"
rm -f "$VW_DATA/db.sqlite3-wal" "$VW_DATA/db.sqlite3-shm"
cp /tmp/restore/var/backups/server-backup/dumps/vaultwarden.db "$VW_DATA/db.sqlite3"
docker start "$VW_CONTAINER"
rm -rf /tmp/restore
```

### D. Listmonk aus restic

```bash
PG_CONTAINER=listmonk_db   # ← aus backup.conf (PG_DUMPS)
rm -rf /tmp/restore && restic restore "$SNAP" --target /tmp/restore --include /var/backups/server-backup/dumps/listmonk.pgdump
docker stop listmonk        # ← App-Container, die Datenbank läuft weiter
docker exec -i "$PG_CONTAINER" pg_restore -U listmonk -d listmonk --clean --if-exists < /tmp/restore/var/backups/server-backup/dumps/listmonk.pgdump
docker start listmonk
rm -rf /tmp/restore
```

### E. Server komplett verloren

1. Ist Hetzner Cloud Backup aktiv: Server aus dem neuesten Backup neu
   aufbauen, danach B bis D für den stündlichen Stand. Fertig.
2. Sonst neuen Debian-Server anlegen, die Cloud Firewall (22/80/443)
   zuweisen, DNS auf die neue IP umstellen und Docker, nginx, certbot,
   restic, sqlite3, jq installieren.
3. Schritte 2 und 3 dieser Anleitung mit **neuem** SSH-Key wiederholen.
   Das restic-Passwort vom Notfallblatt nach
   `/etc/server-backup/restic-password`.
4. Konfiguration zurückholen:
   `restic restore latest --target / --include /etc/nginx --include /etc/letsencrypt --include /etc/cozynights`,
   ebenso die `.env`-Dateien und die Vaultwarden-Daten.
5. CozyNights-Checkouts neu klonen (`deploy/README.md`), Stacks mit
   `docker compose up -d` starten, danach B bis D.

## Wartung

- Ändert sich das Skript im Repo, Schritt 5 wiederholen. Die vorhandene
  `backup.conf` bleibt dabei erhalten.
- Neue Umgebung (zum Beispiel Produktion): Datenbank in `SQLITE_DBS` und
  `.env` in `BACKUP_PATHS` eintragen, dann `server-backup` einmal von Hand
  starten.
- Speichert eine Umgebung später Dateien in PocketBase (etwa ein Kartenbild),
  deren `storage`-Ordner als `volume:<volume>:storage` in `BACKUP_PATHS`
  aufnehmen.
