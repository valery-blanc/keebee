#!/bin/bash
# EduBox — Sauvegarde périodique (MariaDB + données applicatives)
# Exécuté toutes les 6 heures via systemd timer
# Pour un backup complet (avec Kolibri) : bash backup.sh --with-kolibri

set -euo pipefail

EDUBOX_DIR="/opt/edubox"
DATA_DIR="$EDUBOX_DIR/data"
BACKUP_DIR="/var/backups/edubox"
DATE=$(date +%Y%m%d_%H%M)
ENV_FILE="$EDUBOX_DIR/.env"

if [ -f "$ENV_FILE" ]; then
    set -a; source "$ENV_FILE"; set +a
fi

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# Dump MariaDB
log "Dump MariaDB..."
docker exec edubox-mariadb mysqldump \
    --all-databases \
    --single-transaction \
    --routines \
    --triggers \
    -u root -p"${MARIADB_ROOT_PASS}" \
    | gzip > "$BACKUP_DIR/mariadb_$DATE.sql.gz"
log "MariaDB : $BACKUP_DIR/mariadb_$DATE.sql.gz"

# Archive données applicatives (hors Kolibri — trop volumineux pour un backup quotidien)
log "Archive appdata (hors Kolibri)..."
tar -czf "$BACKUP_DIR/appdata_$DATE.tar.gz" \
    --exclude="$DATA_DIR/kolibri" \
    -C "$DATA_DIR" .
log "Appdata : $BACKUP_DIR/appdata_$DATE.tar.gz"

# Rotation : garder les 7 derniers backups
ls -tp "$BACKUP_DIR"/mariadb_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm --
ls -tp "$BACKUP_DIR"/appdata_*.tar.gz 2>/dev/null  | tail -n +8 | xargs -r rm --
log "Rotation done (kept last 7)"

log "Backup terminé : $DATE"
