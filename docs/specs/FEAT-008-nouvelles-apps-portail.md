---
id: FEAT-008
title: Nouvelles apps (Digistorm, PMB, SLiMS) + refonte tuiles portail
status: IN PROGRESS
---

## Contexte

Ajout de trois nouvelles applications et refonte du portail :
- **Digistorm** — sondages, remue-méninges, quiz en temps réel
- **PMB v8.1** — système intégré de gestion de bibliothèque (SIGB) PHP
- **SLiMS v9.7.2** — Senayan Library Management System (PHP)

Refonte des tuiles :
- Remplacement des SVG emoji par les vrais logos officiels
- Suppression de la tuile Wikipedia générique `/wiki/`
- Ajout de 2 tuiles Kiwix distinctes : Wikipedia ES + Wikisource ES

## Comportement

### Portail
- Tuile **Koha** : logo `KOHA_logo.jpg`, nom "Koha", sous-titre "Gestion de bibliothèque"
- Tuile **PMB** : logo `PMB_logo.png`, nom "PMB", sous-titre "Gestion de bibliothèque" → `/pmb/`
- Tuile **SLiMS** : logo `SLIMS_logo.png`, nom "SLiMS", sous-titre "Gestion de bibliothèque" → `/slims/`
- Tuile **Digistorm** : logo `DIGISTORM_logo.png`, href construit dynamiquement via JS → `http://${hostname}:3000/`
- Tuile **Wikipedia Offline** : logo `Wikipedia-logo-v2-es.svg.png` → `/wiki/viewer#wikipedia_es/Wikipedia%3AOffline`
- Tuile **Wikisource Offline** : logo `Wikisource-logo.svg.png` → `/wiki/viewer#wikisource_es/Portada`

### Digistorm
- Stack : Node.js 20, Vue3/Vike SSR, Socket.IO, Redis
- Port : **3000** (exposé directement via nginx server block, pas de sous-chemin possible)
- URL : `http://<ip>:3000/`
- Pas de support natif de sous-chemin URL (aucune option `base` dans vite.config.js)
- Données persistées : volume `digistorm_data` → `/app/static/fichiers`

### PMB v8.1.0.6
- Stack : PHP 8.2 + Apache, MariaDB partagé
- URL : `/pmb/` → `http://pmb:80/pmb/` (PMB s'installe dans un sous-dossier `pmb/`)
- Premier démarrage : accéder à `/pmb/tables/install.php` pour l'installeur web
- DB : `pmb` sur MariaDB partagé, user `pmb`
- Données persistées : volume `pmb_data` → `/var/www/html/pmb/temp`

### SLiMS v9.7.2
- Stack : PHP 8.2 + Apache, MariaDB partagé
- URL : `/slims/` → `http://slims:80/slims/`
- Premier démarrage : accéder à `/slims/install.php` pour l'installeur web
- DB : `slims` sur MariaDB partagé, user `slims`
- Données persistées : volumes `slims_data` + `slims_config`

## Spec technique

### Nginx
```nginx
# PMB
location /pmb/ { proxy_pass http://pmb/pmb/; }

# SLiMS
location /slims/ { proxy_pass http://slims/slims/; }

# Digistorm — server block port 3000 (WebSocket)
server {
    listen 3000;
    location / {
        proxy_pass http://digistorm/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Images ARM64
- Digistorm : `node:20-alpine` (ARM64 natif), build depuis source Codeberg
- PMB : `php:8.2-apache` (ARM64 natif), source téléchargée de forge.sigb.net
- SLiMS : `php:8.2-apache` (ARM64 natif), source téléchargée de GitHub

### Raison du port dédié pour Digistorm
Digistorm (Vue3/Vike) ne supporte pas les sous-chemins URL : `vite.config.js` n'a pas
d'option `base`, et le serveur Express n'a pas de `mountpath`. Solution : nginx server block
sur port 3000, lien dans le portail construit dynamiquement via `window.location.hostname`.

## Étapes

- [x] Portail : logos copiés dans `portal/assets/`, tuiles mises à jour (6 langues)
- [x] Digistorm : Dockerfile, service docker-compose, nginx server block port 3000
- [x] PMB : Dockerfile, service docker-compose, nginx `/pmb/`
- [x] SLiMS : Dockerfile, service docker-compose, nginx `/slims/`
- [x] MariaDB : DB + users créés pour PMB et SLiMS
- [x] Variables .env ajoutées sur le Pi (REDIS_PASS, DIGISTORM_SESSION_KEY, PMB_DB_PASS, SLIMS_DB_PASS)
- [ ] Build images sur le Pi (en cours)
- [ ] Démarrage et test
- [ ] Installeurs web PMB et SLiMS
