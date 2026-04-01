# FEAT-011 — Bind mounts + scripts install/backup/restore

**Statut** : EN COURS
**Date** : 2026-04-01

## Contexte

Les volumes Docker nommés (`mariadb_data`, `moodle_data`, etc.) stockaient les données dans
`/var/lib/docker/volumes/` — inaccessibles directement, et vulnérables à `docker compose down -v`.

Migration vers des bind mounts : chaque volume est maintenant un répertoire sur le Pi dans
`/opt/edubox/data/`, lisible et sauvegardable directement.

## Comportement après migration

### Structure `/opt/edubox/data/`

```
/opt/edubox/data/
├── mariadb/          → /var/lib/mysql         (uid 999 — MariaDB)
├── moodle/
│   ├── data/         → /var/www/moodledata    (uid 82 — www-data Alpine)
│   └── html/         → /var/www/html          (uid 82 — www-data Alpine)
├── kolibri/          → /kolibri_data          (chmod 777 — root)
├── koha/
│   ├── data/         → /var/lib/koha
│   └── config/       → /etc/koha
├── digistorm/        → /app/static/fichiers
├── pmb/
│   ├── data/         → /var/www/html/pmb/temp
│   └── config/       → /var/www/html/pmb/includes (uid 33 — www-data Debian)
├── slims/
│   ├── data/         → /var/www/html/slims/files
│   └── config/       → /var/www/html/slims/config  (uid 33 — www-data Debian)
└── portainer/        → /data
```

`data/` est exclu du repo git (`.gitignore`).

### Persistance

| Opération | Données conservées |
|---|---|
| `docker compose restart` | ✅ |
| `docker compose down` + `up` | ✅ |
| `docker compose up --build` | ✅ |
| `docker compose down -v` | ✅ (bind mounts non affectés) |
| `rm -rf /opt/edubox/data/` | ❌ (perte définitive) |

## Scripts

### `scripts/install.sh`
Installation complète sur Pi neuf :
1. Mise à jour système
2. Installation Docker + Docker Compose
3. Clone du repo
4. Génération `.env` avec mots de passe aléatoires
5. Création des répertoires `data/` avec bons UIDs
6. `docker compose up -d --build`

Usage : `sudo bash /opt/edubox/scripts/install.sh`

### `scripts/backup.sh`
Backup périodique :
- Dump SQL MariaDB (toutes les BDD) → `mariadb_DATE.sql.gz`
- Archive tar des données applicatives hors Kolibri → `appdata_DATE.tar.gz`
- Option `--with-kolibri` pour inclure les 58 Go de channels
- Option `--dest` pour choisir le répertoire de destination
- Rotation automatique (7 derniers backups par défaut)

Usage : `sudo bash /opt/edubox/scripts/backup.sh [--with-kolibri] [--dest /path]`

### `scripts/restore.sh`
Restauration depuis un backup :
1. Arrêt du stack
2. Restauration appdata (tar)
3. Démarrage MariaDB seul
4. Restauration SQL
5. Restauration Kolibri optionnelle
6. Démarrage complet

Usage : `sudo bash /opt/edubox/scripts/restore.sh --date 20260401_1200`

### `scripts/edubox-backup.sh` (systemd timer)
Backup automatique toutes les 6h : dump SQL + archive appdata (sans Kolibri).

## Spec technique — Permissions

| Répertoire | UID:GID | Raison |
|---|---|---|
| `mariadb/` | 999:999 | Image `mariadb:11.4` standard |
| `moodle/data/`, `moodle/html/` | 82:82 | www-data sur Alpine |
| `kolibri/` | 0:0 chmod 777 | Dockerfile Kolibri |
| `koha/data/`, `koha/config/` | géré par entrypoint | `koha-create` chown dynamique |
| `pmb/`, `slims/` | 33:33 | www-data sur Debian |
| `digistorm/`, `portainer/` | 0:0 | Processus root |

## Rollback

Les anciens volumes Docker nommés (`edubox_mariadb_data`, etc.) sont conservés 48h après migration.
Pour revenir en arrière : restaurer l'ancien `docker-compose.yml` depuis git et `docker compose up -d`.

Suppression des anciens volumes (après validation) :
```bash
docker volume rm edubox_mariadb_data edubox_moodle_data edubox_moodle_html \
  edubox_kolibri_data edubox_koha_data edubox_koha_config edubox_digistorm_data \
  edubox_pmb_data edubox_pmb_config edubox_slims_data edubox_slims_config \
  edubox_portainer_data
```
