#!/bin/bash
# EduBox — Restauration depuis un backup
# Usage: sudo bash restore.sh --from /var/backups/edubox --date 20260401_1200
#
# Restaure :
#   - Les bases de données MariaDB depuis le dump SQL
#   - Les données applicatives depuis l'archive tar
#   - Kolibri optionnel via --with-kolibri

set -euo pipefail

EDUBOX_DIR="/opt/edubox"
DATA_DIR="$EDUBOX_DIR/data"
BACKUP_DIR="/var/backups/edubox"
BACKUP_DATE=""
WITH_KOLIBRI=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()  { echo -e "${RED}[ERREUR]${NC} $*"; exit 1; }
confirm() {
    read -rp "$(echo -e "${YELLOW}$* [oui/non]${NC} ")" ans
    [[ "$ans" == "oui" ]] || die "Restauration annulée."
}

# ─── Arguments ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --from)    BACKUP_DIR="$2"; shift 2 ;;
        --date)    BACKUP_DATE="$2"; shift 2 ;;
        --with-kolibri) WITH_KOLIBRI=true; shift ;;
        *) die "Argument inconnu : $1" ;;
    esac
done

[ "$(id -u)" -eq 0 ] || die "Ce script doit être lancé en root"

ENV_FILE="$EDUBOX_DIR/.env"
[ -f "$ENV_FILE" ] || die ".env introuvable : $ENV_FILE"
set -a; source "$ENV_FILE"; set +a

# ─── Sélection du backup ──────────────────────────────────────────────────────
if [ -z "$BACKUP_DATE" ]; then
    log "Backups disponibles :"
    ls -1t "$BACKUP_DIR"/mariadb_*.sql.gz 2>/dev/null | head -10 | \
        sed 's|.*/mariadb_||;s|\.sql\.gz||'
    read -rp "Entrez la date du backup (ex: 20260401_1200) : " BACKUP_DATE
fi

SQL_FILE="$BACKUP_DIR/mariadb_${BACKUP_DATE}.sql.gz"
APP_FILE="$BACKUP_DIR/appdata_${BACKUP_DATE}.tar.gz"
KOLIBRI_FILE="$BACKUP_DIR/kolibri_${BACKUP_DATE}.tar.gz"

[ -f "$SQL_FILE" ] || die "Backup SQL introuvable : $SQL_FILE"
[ -f "$APP_FILE" ] || die "Backup appdata introuvable : $APP_FILE"

log "=== EduBox Restore — backup du $BACKUP_DATE ==="
log "SQL     : $SQL_FILE ($(du -sh "$SQL_FILE" | cut -f1))"
log "Appdata : $APP_FILE ($(du -sh "$APP_FILE" | cut -f1))"
[ "$WITH_KOLIBRI" = "true" ] && log "Kolibri : $KOLIBRI_FILE"

echo ""
warn "ATTENTION : cette opération va ÉCRASER toutes les données actuelles !"
confirm "Confirmer la restauration ?"

# ─── 1. Arrêt du stack ────────────────────────────────────────────────────────
log "1/5 Arrêt du stack..."
cd "$EDUBOX_DIR"
docker compose down

# ─── 2. Restauration données applicatives ────────────────────────────────────
log "2/5 Restauration données applicatives..."
# Vider les répertoires cibles (sauf kolibri)
for dir in moodle/data moodle/html koha/data koha/config digistorm pmb/data pmb/config slims/data slims/config portainer; do
    rm -rf "${DATA_DIR:?}/$dir"
    mkdir -p "$DATA_DIR/$dir"
done

tar -xzf "$APP_FILE" -C "$DATA_DIR"
log "Appdata restauré"

# Réappliquer les permissions
chown -R 999:999 "$DATA_DIR/mariadb" 2>/dev/null || true
chmod 750 "$DATA_DIR/mariadb" 2>/dev/null || true
chown -R 82:82 "$DATA_DIR/moodle/data" "$DATA_DIR/moodle/html"
chmod 750 "$DATA_DIR/moodle/data" "$DATA_DIR/moodle/html"
chown -R 33:33 "$DATA_DIR/pmb/data" "$DATA_DIR/pmb/config"
chown -R 33:33 "$DATA_DIR/slims/data" "$DATA_DIR/slims/config"
chmod 777 "$DATA_DIR/kolibri"

# ─── 3. Démarrer MariaDB seul ─────────────────────────────────────────────────
log "3/5 Démarrage MariaDB..."
docker compose up -d mariadb
log "Attente MariaDB (60s)..."
sleep 60

# Vérifier que MariaDB est healthy
RETRIES=10
until docker exec edubox-mariadb healthcheck.sh --connect --innodb_initialized &>/dev/null; do
    RETRIES=$((RETRIES-1))
    [ $RETRIES -le 0 ] && die "MariaDB ne démarre pas — vérifiez les logs"
    log "MariaDB pas encore prêt, attente 10s... ($RETRIES essais)"
    sleep 10
done
log "MariaDB healthy"

# ─── 4. Restauration SQL ──────────────────────────────────────────────────────
log "4/5 Restauration des bases de données..."
zcat "$SQL_FILE" | docker exec -i edubox-mariadb mysql -u root -p"${MARIADB_ROOT_PASS}"
log "Bases de données restaurées"

# ─── 5. Restauration Kolibri (optionnel) ──────────────────────────────────────
if [ "$WITH_KOLIBRI" = "true" ]; then
    [ -f "$KOLIBRI_FILE" ] || die "Backup Kolibri introuvable : $KOLIBRI_FILE"
    log "5/5 Restauration Kolibri (peut prendre 30-60 min)..."
    rm -rf "${DATA_DIR:?}/kolibri"
    mkdir -p "$DATA_DIR/kolibri"
    chmod 777 "$DATA_DIR/kolibri"
    tar -xzf "$KOLIBRI_FILE" -C "$DATA_DIR/kolibri"
    log "Kolibri restauré"
else
    log "5/5 Kolibri ignoré (utiliser --with-kolibri pour le restaurer)"
fi

# ─── Démarrage complet ────────────────────────────────────────────────────────
log "Démarrage du stack complet..."
docker compose up -d
sleep 30
docker compose ps --format "table {{.Name}}\t{{.Status}}"

log "=== Restauration terminée ==="
