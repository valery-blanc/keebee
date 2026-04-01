#!/bin/bash
# EduBox — Script d'installation complète sur Raspberry Pi 5
# Usage: sudo bash install.sh
#
# Ce script installe Docker, clone le repo, crée les répertoires de données
# et démarre le stack EduBox sur un Pi neuf (Raspberry Pi OS Bookworm 64-bit).

set -euo pipefail

EDUBOX_DIR="/opt/edubox"
DATA_DIR="$EDUBOX_DIR/data"
REPO_URL="https://github.com/VOTRE_ORG/keebee.git"   # À adapter
LOG_FILE="/tmp/edubox-install.log"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*" | tee -a "$LOG_FILE"; }
die()  { echo -e "${RED}[ERREUR]${NC} $*" | tee -a "$LOG_FILE"; exit 1; }

# ─── Vérifications préalables ─────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "Ce script doit être lancé en root (sudo bash install.sh)"
[ "$(uname -m)" = "aarch64" ] || warn "Architecture non-ARM64 détectée — le script est optimisé pour Pi 5"

log "=== EduBox — Installation ==="
log "Répertoire cible : $EDUBOX_DIR"

# ─── 1. Mise à jour système ───────────────────────────────────────────────────
log "1/7 Mise à jour des paquets..."
apt-get update -qq
apt-get upgrade -y -qq

# ─── 2. Installation Docker ───────────────────────────────────────────────────
log "2/7 Installation de Docker..."
if command -v docker &>/dev/null; then
    log "Docker déjà installé ($(docker --version))"
else
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker "$(logname 2>/dev/null || echo pi)"
    log "Docker installé"
fi

# Docker Compose plugin
if ! docker compose version &>/dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi
log "Docker Compose : $(docker compose version --short)"

# ─── 3. Cloner le repo ────────────────────────────────────────────────────────
log "3/7 Déploiement des fichiers EduBox..."
if [ -d "$EDUBOX_DIR/.git" ]; then
    log "Repo déjà présent — git pull..."
    git -C "$EDUBOX_DIR" pull
else
    git clone "$REPO_URL" "$EDUBOX_DIR"
fi

# ─── 4. Fichier .env ──────────────────────────────────────────────────────────
log "4/7 Configuration des secrets..."
if [ ! -f "$EDUBOX_DIR/.env" ]; then
    if [ -f "$EDUBOX_DIR/.env.example" ]; then
        cp "$EDUBOX_DIR/.env.example" "$EDUBOX_DIR/.env"
        # Générer des mots de passe aléatoires
        sed -i "s/CHANGE_ME_MARIADB/$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)/" "$EDUBOX_DIR/.env"
        sed -i "s/CHANGE_ME_MOODLE_DB/$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)/" "$EDUBOX_DIR/.env"
        sed -i "s/CHANGE_ME_MOODLE_ADMIN/$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16)/" "$EDUBOX_DIR/.env"
        sed -i "s/CHANGE_ME_KOHA/$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)/" "$EDUBOX_DIR/.env"
        sed -i "s/CHANGE_ME_PMB/$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)/" "$EDUBOX_DIR/.env"
        sed -i "s/CHANGE_ME_SLIMS/$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)/" "$EDUBOX_DIR/.env"
        sed -i "s/CHANGE_ME_REDIS/$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)/" "$EDUBOX_DIR/.env"
        sed -i "s/CHANGE_ME_SESSION/$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)/" "$EDUBOX_DIR/.env"
        warn ".env créé avec mots de passe générés automatiquement — notez-les !"
        cat "$EDUBOX_DIR/.env"
    else
        die "Fichier .env.example introuvable — créez $EDUBOX_DIR/.env manuellement"
    fi
else
    log ".env existant conservé"
fi

# ─── 5. Répertoires de données (bind mounts) ──────────────────────────────────
log "5/7 Création des répertoires de données..."
mkdir -p "$DATA_DIR/mariadb"
mkdir -p "$DATA_DIR/moodle/data"
mkdir -p "$DATA_DIR/moodle/html"
mkdir -p "$DATA_DIR/kolibri"
mkdir -p "$DATA_DIR/koha/data"
mkdir -p "$DATA_DIR/koha/config"
mkdir -p "$DATA_DIR/digistorm"
mkdir -p "$DATA_DIR/pmb/data"
mkdir -p "$DATA_DIR/pmb/config"
mkdir -p "$DATA_DIR/slims/data"
mkdir -p "$DATA_DIR/slims/config"
mkdir -p "$DATA_DIR/portainer"

# Permissions : MariaDB uid 999
chown -R 999:999 "$DATA_DIR/mariadb"
chmod 750 "$DATA_DIR/mariadb"

# Permissions : Moodle www-data Alpine uid 82
chown -R 82:82 "$DATA_DIR/moodle/data" "$DATA_DIR/moodle/html"
chmod 750 "$DATA_DIR/moodle/data" "$DATA_DIR/moodle/html"

# Kolibri : root avec chmod 777 dans Dockerfile
chmod 777 "$DATA_DIR/kolibri"

# Koha : entrypoint gère les permissions au démarrage
chmod 755 "$DATA_DIR/koha/data" "$DATA_DIR/koha/config"

# PMB / SLiMS : www-data Debian uid 33
chown -R 33:33 "$DATA_DIR/pmb/data" "$DATA_DIR/pmb/config"
chown -R 33:33 "$DATA_DIR/slims/data" "$DATA_DIR/slims/config"
chmod 755 "$DATA_DIR/pmb/data" "$DATA_DIR/pmb/config"
chmod 755 "$DATA_DIR/slims/data" "$DATA_DIR/slims/config"

chmod 755 "$DATA_DIR/digistorm" "$DATA_DIR/portainer"

log "Répertoires créés"

# ─── 6. Démarrage du stack ────────────────────────────────────────────────────
log "6/7 Démarrage du stack Docker..."
cd "$EDUBOX_DIR"
docker compose pull --quiet 2>/dev/null || true
docker compose up -d --build

log "Stack démarré — attente initialisation (90s)..."
sleep 90

# ─── 7. Vérification ──────────────────────────────────────────────────────────
log "7/7 Vérification du statut..."
docker compose ps --format "table {{.Name}}\t{{.Status}}"

echo ""
log "=== Installation terminée ==="
log "Portail    : http://$(hostname -I | awk '{print $1}')/"
log "Moodle     : http://$(hostname -I | awk '{print $1}')/moodle"
log "Kolibri    : http://$(hostname -I | awk '{print $1}')/kolibri"
log "Koha       : http://$(hostname -I | awk '{print $1}')/biblio"
log "Wikipedia  : http://$(hostname -I | awk '{print $1}')/wiki"
log ""
log "Credentials Moodle admin : voir .env → MOODLE_ADMIN_PASS"
log "Log d'installation       : $LOG_FILE"
