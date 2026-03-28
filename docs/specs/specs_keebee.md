# SPEC_EDUBOX.md — Serveur éducatif et bibliothèque hors-ligne sur Raspberry Pi 5

> **Version** : 1.2 (FEAT-002 / FEAT-003 / FEAT-004 / FEAT-005)
> **Date** : 2026-03-28
> **Auteur** : Val (spécification), Claude Code (implémentation)  
> **Inspiration** : Beekee Box (beekee.ch), MoodleBox, Kolibri RPi

---

## 1. Vue d'ensemble du projet

### 1.1 Objectif

Déployer sur un Raspberry Pi 5 un serveur tout-en-un, fonctionnel **avec ou sans internet**, qui :

- Crée un réseau WiFi local (hotspot) auquel des tablettes et smartphones se connectent
- Sert trois applications via un portail captif :
  - **Moodle** — plateforme LMS (cours pré-installés)
  - **Kolibri** — plateforme éducative hors-ligne (Khan Academy, Wikipedia, etc.)
  - **Koha** — système intégré de gestion de bibliothèque (SIGB) avec support scanner USB et RFID/EM
- Offre un **monitoring à distance** quand le Pi a accès à internet (via Tailscale)
- **Résiste aux coupures d'électricité** intempestives (protection logicielle + recommandation UPS)

### 1.2 Contextes de déploiement cibles

| Contexte | Caractéristiques |
|---|---|
| Bibliothèque communautaire en pays en développement (Afrique, Amérique du Sud) | Électricité instable, pas d'internet permanent, chaleur, poussière |
| Bibliothèque de quartier en Suisse | Électricité stable, internet disponible, usage mixte éducation + prêt de livres |

### 1.3 Nom du projet

**Ofelia** (ex-EduBox)

---

## 2. Matériel cible

### 2.1 Configuration de base (requise)

| Composant | Spécification |
|---|---|
| SBC | Raspberry Pi 5, 4 Go RAM |
| Stockage | microSD 512 Go (classe A2/V30 minimum, ex: Samsung EVO Plus, SanDisk Extreme) |
| Alimentation | USB-C 5V/5A officielle Raspberry Pi 5 (27W) |
| Réseau filaire | Câble RJ45 vers routeur/switch pour accès internet (quand disponible) |
| Réseau sans fil | WiFi intégré du Pi 5 (802.11ac) — utilisé comme point d'accès |
| Boîtier | Boîtier avec ventilation passive ou active (ex: Argon ONE, Flirc, ou boîtier imprimé 3D type Beekee) |

### 2.2 Périphériques bibliothèque (optionnels)

| Composant | Spécification | Connexion |
|---|---|---|
| Scanner codes-barres | Tout scanner USB en mode HID (émulation clavier), ex: Honeywell Voyager, Zebra DS2208 | USB-A |
| Lecteur RFID | Tout lecteur compatible SIP2 ou lecteur USB HID pour tags ISO 15693/14443 | USB-A ou réseau (SIP2) |
| Portiques antivol EM/RFID | Portiques communiquant via SIP2 avec Koha (3M/Bibliotheca/NEDAP) | Réseau local (SIP2 sur TCP) |

### 2.3 Recommandation UPS (fortement conseillé)

Pour les déploiements en pays en développement :

| Option | Prix approx. | Autonomie |
|---|---|---|
| **Waveshare UPS HAT (C)** pour Pi 5 | ~25 USD | 15-30 min (shutdown propre) |
| **Power bank USB-C PD avec pass-through** (ex: Anker 20000 mAh) | ~40 USD | 2-4 heures |
| **Mini onduleur USB-C** (ex: UUGEAR Zero2Go Omini) | ~30 USD | 15-60 min |

L'objectif de l'UPS est de donner au système le temps d'effectuer un **shutdown propre** des bases de données.

---

## 3. Architecture système

### 3.1 Diagramme d'architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     RASPBERRY PI 5 (4 Go)                       │
│                                                                 │
│  ┌─────────┐    ┌──────────────────────────────────────────┐   │
│  │ eth0    │────│  Internet (quand disponible)              │   │
│  │ (RJ45)  │    │  → apt, Docker pull, Tailscale, sync     │   │
│  └─────────┘    └──────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────┐    ┌──────────────────────────────────────────┐   │
│  │ wlan0   │────│  Hotspot WiFi "Ofelia"                   │   │
│  │ (WiFi)  │    │  → DHCP: 192.168.50.10-192.168.50.200   │   │
│  │ AP mode │    │  → DNS: toutes requêtes → 192.168.50.1  │   │
│  └─────────┘    └──────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────── HOST (Raspberry Pi OS Lite 64-bit) ──┐  │
│  │                                                           │  │
│  │  systemd services :                                       │  │
│  │  ├── NetworkManager  (gère hostapd + dnsmasq via nmcli AP) │  │
│  │  ├── tailscaled     (VPN mesh pour monitoring distant)    │  │
│  │  └── docker         (moteur de conteneurs)                │  │
│  │                                                           │  │
│  │  ┌────────────── Docker Compose Stack ─────────────────┐ │  │
│  │  │                                                     │ │  │
│  │  │  nginx-proxy    :80/:443  (reverse proxy + portail) │ │  │
│  │  │  ┌─────────────────────────────────────────────┐    │ │  │
│  │  │  │  mariadb      :3306  (BD partagée)          │    │ │  │
│  │  │  └─────────────────────────────────────────────┘    │ │  │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │ │  │
│  │  │  │ moodle   │ │ kolibri  │ │ koha             │    │ │  │
│  │  │  │ :8081    │ │ :8082    │ │ :8083 (staff)    │    │ │  │
│  │  │  │          │ │          │ │ :8084 (OPAC)     │    │ │  │
│  │  │  │          │ │          │ │ :6001 (SIP2)     │    │ │  │
│  │  │  └──────────┘ └──────────┘ └──────────────────┘    │ │  │
│  │  │  ┌──────────────────────────────────────────────┐   │ │  │
│  │  │  │  portainer  :9443  (gestion containers)      │   │ │  │
│  │  │  │  healthcheck :8090 (dashboard status custom)  │   │ │  │
│  │  │  └──────────────────────────────────────────────┘   │ │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  USB :  ┌──────────┐  ┌──────────────┐                         │
│         │ Scanner   │  │ Lecteur RFID │  (optionnels)           │
│         │ barcode   │  │              │                         │
│         └──────────┘  └──────────────┘                         │
└─────────────────────────────────────────────────────────────────┘

        ▼ WiFi "Ofelia" ▼

   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ Tablette │  │ Tablette │  │ Téléphone│  ... (10-20 clients)
   │ Android  │  │ iPad     │  │ Android  │
   └──────────┘  └──────────┘  └──────────┘

   Navigateur → http://192.168.50.1 ou http://ofelia (DoH désactivé)
   → Portail d'accueil avec choix : Moodle | Kolibri | Bibliothèque
```

### 3.2 Allocation mémoire cible (4 Go)

| Service | RAM max allouée | Notes |
|---|---|---|
| Système (RPi OS Lite + hostapd + dnsmasq) | 300 Mo | Pas de GUI |
| MariaDB (partagée Moodle + Koha) | 512 Mo | `innodb_buffer_pool_size=256M` |
| Moodle (PHP-FPM + Nginx) | 700 Mo | `memory_limit=128M` par worker, 4 workers max |
| Kolibri (Python/Django + SQLite) | 500 Mo | Base de données SQLite propre, pas MariaDB |
| Koha (Perl/Plack + Zebra/ES) | 700 Mo | Mode Zebra (pas Elasticsearch, trop lourd) |
| Nginx reverse proxy | 50 Mo | |
| Portainer | 100 Mo | |
| Healthcheck dashboard | 30 Mo | Container Alpine minimal |
| Tailscale | 50 Mo | Daemon léger |
| **Headroom libre** | **~150 Mo** | Pour swap et pics |

Un swap de **1 Go** sur la SD sera configuré comme filet de sécurité (avec `vm.swappiness=10` pour limiter l'usure de la SD).

---

## 4. Module 1 — Réseau WiFi et portail captif

### 4.1 Point d'accès WiFi (hostapd)

**Exécution** : directement sur l'hôte (pas Docker — nécessite accès matériel direct à wlan0).

**Configuration hostapd** :

```
interface=wlan0
driver=nl80211
ssid=EduBox
hw_mode=a          # 5 GHz préféré pour débit (fallback 2.4 GHz si incompatible)
channel=36
ieee80211n=1
ieee80211ac=1
wmm_enabled=1
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
# Pas de mot de passe par défaut (open) pour faciliter l'accès
# Option WPA2 commentée, activable :
# wpa=2
# wpa_passphrase=EduBox2024
# wpa_key_mgmt=WPA-PSK
# rsn_pairwise=CCMP
```

**Justification réseau ouvert** : dans un contexte éducatif/bibliothèque, la friction doit être minimale. Le mot de passe WPA2 est commenté et activable via un script de configuration.

**Fallback 2.4 GHz** : si les tablettes ne supportent pas le 5 GHz, un script de détection basculera `hw_mode=g` et `channel=7`.

### 4.2 DHCP et DNS (dnsmasq)

```
# Interface du hotspot uniquement
interface=wlan0
bind-interfaces

# Ne pas utiliser le DNS upstream (mode offline)
no-resolv
no-poll

# Plage DHCP
dhcp-range=192.168.50.10,192.168.50.200,255.255.255.0,24h
dhcp-option=option:router,192.168.50.1
dhcp-option=option:dns-server,192.168.50.1

# Résolution locale
address=/edubox.local/192.168.50.1
address=/moodle.edubox.local/192.168.50.1
address=/kolibri.edubox.local/192.168.50.1
address=/biblio.edubox.local/192.168.50.1

# Captive portal : rediriger TOUTES les requêtes DNS vers le Pi
address=/#/192.168.50.1
```

### 4.3 Configuration réseau de l'hôte

```
# /etc/network/interfaces.d/edubox

# eth0 : DHCP pour accès internet
auto eth0
iface eth0 inet dhcp

# wlan0 : IP statique pour le hotspot
auto wlan0
iface wlan0 inet static
    address 192.168.50.1
    netmask 255.255.255.0
    network 192.168.50.0
    broadcast 192.168.50.255
```

**iptables / nftables** :

```bash
# NAT pour partager internet (eth0) avec les clients WiFi (quand disponible)
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
iptables -A FORWARD -i wlan0 -o eth0 -j ACCEPT
iptables -A FORWARD -i eth0 -o wlan0 -m state --state RELATED,ESTABLISHED -j ACCEPT

# Rediriger HTTP vers le portail pour le captive portal detection
iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 80 -j DNAT --to-destination 192.168.50.1:80
iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 443 -j DNAT --to-destination 192.168.50.1:443
```

### 4.4 Portail captif (page d'accueil)

Le reverse proxy Nginx sert une **page d'accueil HTML statique** responsive qui :

1. Détecte les requêtes de captive portal Android (`/generate_204`, `/gen_204`) et renvoie HTTP 204 (évite le popup "pas d'internet")
2. Affiche trois grosses tuiles cliquables :
   - **Moodle** → `/moodle/`
   - **Kolibri** → `/kolibri/`
   - **Bibliothèque (Koha OPAC)** → `/biblio/`
3. Affiche le statut de chaque service (vert/rouge) via `/api/status`
4. Fonctionne à 100% offline, pas de CDN externe, tout embarqué

**Internationalisation (FEAT-005)** : le portail est disponible en 6 langues — FR, EN, ES, PT, IT, DE.
Un sélecteur de langue (barre de boutons `flex-wrap`) permet de changer la langue à la volée.
Le choix est persisté dans `localStorage` (clé `ofelia-lang`) et restauré au prochain chargement.
Éléments traduits : tagline, descriptions des apps, nom Bibliothèque/Library/Bibliothek, statuts (En ligne / Offline…), footer.

Moodle language packs installés : `es`, `pt`, `it`, `de` (FR = défaut, EN = langue de base Moodle).

**Design** : responsive, gros boutons tactiles, icônes SVG inline, multilingue (FR/EN/ES sélectionnable).

**Technologies** : HTML5 + CSS3 + vanilla JS. Pas de framework. Fichiers servis par Nginx.

### 4.5 Détection automatique de connectivité internet

Un script systemd timer (toutes les 30 secondes) :

```bash
#!/bin/bash
# /usr/local/bin/edubox-connectivity-check.sh
if ping -c1 -W2 8.8.8.8 &>/dev/null; then
    touch /run/edubox/internet-available
    # Activer le NAT forwarding
    iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || \
        iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
else
    rm -f /run/edubox/internet-available
fi
```

Les applications peuvent vérifier `/run/edubox/internet-available` pour adapter leur comportement.

---

## 5. Module 2 — Moodle (LMS)

### 5.1 Image Docker

**Image** : `erseco/alpine-moodle` (multi-arch dont arm64, maintenue activement, Alpine-based = léger)

**Version Moodle** : 4.5.x (dernière LTS)

**Alternative de fallback** : `bitnami/moodle` (plus lourd mais très stable)

### 5.2 docker-compose (extrait)

```yaml
moodle:
    image: erseco/alpine-moodle:latest
    container_name: edubox-moodle
    restart: unless-stopped
    depends_on:
      mariadb:
        condition: service_healthy
    environment:
      - DB_HOST=mariadb
      - DB_NAME=moodle
      - DB_USER=moodle
      - DB_PASS=${MOODLE_DB_PASS}
      - MOODLE_URL=http://moodle.edubox.local
      - MOODLE_LANGUAGE=fr
      - MOODLE_USERNAME=admin
      - MOODLE_PASSWORD=${MOODLE_ADMIN_PASS}
      - MOODLE_SITE_NAME=EduBox Moodle
    volumes:
      - moodle_data:/var/www/moodledata
      - moodle_html:/var/www/html
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 700M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/login/index.php"]
      interval: 60s
      timeout: 10s
      retries: 3
```

### 5.3 Cours pré-installés

Après le premier déploiement, un script `edubox-moodle-setup.sh` :

1. Active les packs de langue **français**, **anglais**, **espagnol**, **portugais**, **italien**, **allemand**
2. Importe des cours .mbz pré-packagés depuis `/opt/edubox/moodle-courses/` :
   - **Alphabétisation numérique** (Digital Literacy basics)
   - **Mathématiques fondamentales** (niveaux primaire/secondaire)
   - **Sciences** (biologie, physique de base)
   - **Langues** (français, anglais, espagnol — niveaux débutant)
3. Configure les paramètres de performance pour Pi :
   - `cachestore` → fichier (pas Redis, économie de RAM)
   - `session_handler` → fichier
   - `cron` via container dédié (toutes les 60s)

### 5.4 Optimisations Pi 5 / 4 Go

- `PHP memory_limit = 128M`
- `PHP max_execution_time = 300`
- `PHP opcache.memory_consumption = 64`
- `PHP pm.max_children = 4` (PHP-FPM)
- Désactiver les plugins non essentiels (analytics, badges complexes)
- Désactiver le calcul MathJax côté serveur (utiliser client-side)

---

## 6. Module 3 — Kolibri (éducation hors-ligne)

### 6.1 Approche d'installation

**Pas d'image Docker officielle** pour Kolibri. Deux options :

- **Option A (recommandée)** : Dockerfile custom basé sur `python:3.11-slim-bookworm` pour arm64
- **Option B** : Installation native sur l'hôte via le `.deb` officiel

On choisit l'**Option A** pour garder toute la stack dans Docker Compose.

### 6.2 Dockerfile Kolibri

```dockerfile
FROM python:3.11-slim-bookworm

ARG KOLIBRI_VERSION=0.18.1

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    pip install --no-cache-dir kolibri==${KOLIBRI_VERSION} && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV KOLIBRI_HOME=/kolibri_data
ENV KOLIBRI_HTTP_PORT=8080
ENV KOLIBRI_LISTEN_PORT=8080

VOLUME /kolibri_data

EXPOSE 8080

CMD ["kolibri", "start", "--foreground", "--port=8080"]
```

### 6.3 docker-compose (extrait)

```yaml
kolibri:
    build:
      context: ./kolibri
      dockerfile: Dockerfile
    container_name: edubox-kolibri
    restart: unless-stopped
    environment:
      - KOLIBRI_HOME=/kolibri_data
    volumes:
      - kolibri_data:/kolibri_data
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 500M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/api/public/info/"]
      interval: 60s
      timeout: 10s
      retries: 3
```

### 6.4 Channels de contenu pré-chargés

Un script `edubox-kolibri-setup.sh` importe les channels suivants après le premier boot (nécessite internet une seule fois) :

| Channel | ID | Langues | Taille approx. |
|---|---|---|---|
| Khan Academy (sélection) | `1ceff53605e55bef987d88e0908658c5` | FR, EN, ES | ~15 Go (sélection) |
| Wikipedia (articles sélectionnés) | `2e969a23e8af58d196662a24f5fe1b0c` | FR, EN, ES | ~5 Go |
| African Storybook | `f9d3e0e46ea25789bbed672ff6a399ed` | FR, EN, Multi | ~500 Mo |
| CK-12 Foundation | `63f7e82e20fa5b74a462901be4d4e2f0` | EN | ~2 Go |
| Pratham Books (StoryWeaver) | `d15e83ba24b85b05a9a5a8e3e53f12f2` | Multi | ~1 Go |
| Blockly Games (programmation) | `e625c30276c05be1bf70736e2c85d27f` | Multi | ~50 Mo |

**Total estimé** : ~25 Go (largement dans les 512 Go)

**Mécanisme de pré-chargement** :

```bash
#!/bin/bash
# edubox-kolibri-import.sh
# À exécuter une fois avec internet

CHANNELS=(
    "1ceff53605e55bef987d88e0908658c5"  # Khan Academy
    "2e969a23e8af58d196662a24f5fe1b0c"  # Wikipedia
    "f9d3e0e46ea25789bbed672ff6a399ed"  # African Storybook
)

for channel_id in "${CHANNELS[@]}"; do
    docker exec edubox-kolibri kolibri manage importchannel network "$channel_id"
    docker exec edubox-kolibri kolibri manage importcontent network "$channel_id"
done
```

**Alternative USB offline** : les channels peuvent être importés depuis une clé USB via `kolibri manage importcontent disk`.

### 6.5 Configuration multilingue

```bash
docker exec edubox-kolibri kolibri manage provisiondevice \
    --facility "EduBox" \
    --preset "formal" \
    --language_id "fr"
```

Les interfaces FR, EN, ES sont toutes disponibles nativement dans Kolibri.

---

## 7. Module 4 — Koha (gestion de bibliothèque)

### 7.1 Image Docker

**Image** : Dockerfile custom basé sur le package Koha officiel Debian, car les images Docker existantes pour Koha ne supportent pas toutes arm64 nativement.

**Version Koha** : dernière stable (24.11.x)

**Composants** :
- Koha (Perl/Plack) : interface staff + OPAC
- Zebra : moteur d'indexation (pas Elasticsearch — trop gourmand pour 4 Go)
- MariaDB : BD partagée avec Moodle (base `koha` séparée)
- Memcached : cache de sessions (léger, ~30 Mo)
- SIP2 server : communication avec scanners/portiques RFID

### 7.2 Dockerfile Koha

```dockerfile
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV KOHA_INSTANCE=edubox

# Ajouter le dépôt Koha
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        wget gnupg2 ca-certificates && \
    echo "deb http://debian.koha-community.org/koha stable main" \
        > /etc/apt/sources.list.d/koha.list && \
    wget -qO- https://debian.koha-community.org/koha/gpg.asc | \
        gpg --dearmor > /etc/apt/trusted.gpg.d/koha.gpg && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        koha-common \
        apache2 \
        memcached \
        supervisor && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY koha-sites.conf /etc/koha/koha-sites.conf

EXPOSE 8080 8081 6001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
```

### 7.3 docker-compose (extrait)

```yaml
koha:
    build:
      context: ./koha
      dockerfile: Dockerfile
    container_name: edubox-koha
    restart: unless-stopped
    depends_on:
      mariadb:
        condition: service_healthy
      memcached:
        condition: service_started
    environment:
      - KOHA_INSTANCE=edubox
      - KOHA_DB_HOST=mariadb
      - KOHA_DB_NAME=koha
      - KOHA_DB_USER=koha
      - KOHA_DB_PASS=${KOHA_DB_PASS}
      - MEMCACHED_SERVER=memcached:11211
    volumes:
      - koha_data:/var/lib/koha
      - koha_config:/etc/koha
    ports:
      - "6001:6001"    # SIP2 — exposé sur l'hôte pour les portiques
    devices:
      - /dev/bus/usb:/dev/bus/usb  # Accès USB pour scanners
    privileged: false
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 700M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/"]
      interval: 60s
      timeout: 10s
      retries: 3

memcached:
    image: memcached:1.6-alpine
    container_name: edubox-memcached
    restart: unless-stopped
    command: memcached -m 32
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 48M
```

### 7.4 Scanner de codes-barres USB

**Principe** : la majorité des scanners USB fonctionnent en mode **HID Keyboard Emulation**. Ils envoient les caractères du code-barres comme des frappes clavier, terminées par Enter.

**Intégration avec Koha** :

1. Le scanner est branché sur un port USB du Pi
2. Le container Koha accède au device USB (`/dev/bus/usb`)
3. **Cas d'usage principal** : le bibliothécaire utilise l'interface web Koha (staff) sur une tablette ou un petit écran connecté au Pi. Il place le curseur dans le champ "Code-barres" de Koha et scanne. Le code est injecté dans le champ.
4. **Cas d'usage alternatif** : un petit service `evdev` écoute le scanner USB et injecte le code-barres via l'API Koha REST ou SIP2

**Script d'écoute scanner (optionnel, pour mode kiosque sans clavier)** :

```python
#!/usr/bin/env python3
"""
edubox-barcode-bridge.py
Écoute un scanner USB HID et transmet les codes-barres
au serveur SIP2 de Koha ou à l'API REST.
"""
import evdev
import requests

SCANNER_VENDOR_ID = None  # Auto-détection
KOHA_API_URL = "http://localhost:8083/api/v1"
```

### 7.5 SIP2 — Communication avec portiques et automates

Koha intègre nativement un **serveur SIP2** (Standard Interchange Protocol v2).

**Configuration SIP2** (`SIPconfig.xml` dans le container Koha) :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<acsconfig xmlns="http://openncip.org/acs-config/1.0/">
  <error-detect enabled="true" />

  <listeners>
    <service
      port="6001"
      transport="RAW"
      protocol="SIP/2.00"
      timeout="60" />
  </listeners>

  <accounts>
    <!-- Compte pour portique antivol -->
    <login id="gate_user"
           password="${SIP2_GATE_PASS}"
           delimiter="|"
           error-detect="enabled"
           institution="edubox"
           encoding="utf8" />

    <!-- Compte pour borne self-service -->
    <login id="selfcheck_user"
           password="${SIP2_SELFCHECK_PASS}"
           delimiter="|"
           error-detect="enabled"
           institution="edubox"
           encoding="utf8" />
  </accounts>

  <institutions>
    <institution id="edubox"
                 implementation="ILS">
      <policy checkin="true"
              checkout="true"
              renewal="true"
              status_update="true"
              offline="false"
              timeout="100"
              retries="5" />
    </institution>
  </institutions>
</acsconfig>
```

**Matrice de compatibilité portiques** :

| Fabricant | Protocole | Port | Notes |
|---|---|---|---|
| 3M / Bibliotheca | SIP2 sur TCP | 6001 | Standard, bien testé avec Koha |
| NEDAP | SIP2 sur TCP | 6001 | Nécessite config côté portique |
| Feig Electronic | SIP2 ou API REST | 6001 / HTTP | Dépend du modèle |
| TagSys | SIP2 | 6001 | |

**Messages SIP2 utilisés pour la sécurité** :

| Code | Message | Usage |
|---|---|---|
| 09/10 | Checkin | Retour livre → désactive l'alarme RFID |
| 11/12 | Checkout | Prêt livre → désactive l'alarme RFID |
| 17/18 | Item Information | Portique vérifie si un livre est emprunté |
| 23/24 | Patron Status | Vérification carte lecteur |

### 7.6 Configuration initiale Koha

Le script `edubox-koha-setup.sh` :

1. Crée l'instance Koha "edubox"
2. Exécute le web installer (ou l'automatise via SQL)
3. Configure les langues : FR, EN, ES
4. Crée la bibliothèque par défaut "EduBox Library"
5. Configure les types de documents (livres, DVD, périodiques)
6. Active le module de circulation
7. Configure SIP2 avec les comptes gate et selfcheck
8. Active l'OPAC public (interface usager)

---

## 8. Module 5 — Reverse Proxy et portail (Nginx)

### 8.1 Configuration Nginx

```nginx
# /etc/nginx/conf.d/edubox.conf

# Upstream definitions
upstream moodle   { server edubox-moodle:8080; }
upstream kolibri  { server edubox-kolibri:8080; }
upstream koha_opac { server edubox-koha:8080; }
upstream koha_staff { server edubox-koha:8081; }

server {
    listen 80 default_server;
    server_name edubox.local _;

    # Captive portal detection endpoints
    # Android
    location /generate_204 { return 302 http://edubox.local/; }
    location /gen_204 { return 302 http://edubox.local/; }
    location /connectivitycheck.gstatic.com { return 302 http://edubox.local/; }

    # iOS / macOS
    location /hotspot-detect.html {
        return 200 '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>';
        add_header Content-Type text/html;
    }

    # Windows
    location /connecttest.txt { return 302 http://edubox.local/; }
    location /ncsi.txt {
        return 200 'Microsoft NCSI';
        add_header Content-Type text/plain;
    }

    # Page d'accueil / portail
    location = / {
        root /var/www/edubox-portal;
        index index.html;
    }
    location /portal/ {
        alias /var/www/edubox-portal/;
    }
    location /portal/api/status {
        proxy_pass http://healthcheck:8090/api/status;
    }

    # Moodle
    location /moodle/ {
        proxy_pass http://moodle/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 200M;
        proxy_read_timeout 300;
    }

    # Kolibri
    location /kolibri/ {
        proxy_pass http://kolibri/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;  # Streaming content
    }

    # Koha OPAC (public)
    location /biblio/ {
        proxy_pass http://koha_opac/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Koha Staff (admin, protégé)
    location /biblio-admin/ {
        proxy_pass http://koha_staff/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Accès limité au réseau local
        allow 192.168.50.0/24;
        deny all;
    }
}

# Subdomains (alternative plus propre si DNS fonctionne)
server {
    listen 80;
    server_name moodle.edubox.local;
    location / { proxy_pass http://moodle/; include /etc/nginx/proxy_params; }
}

server {
    listen 80;
    server_name kolibri.edubox.local;
    location / { proxy_pass http://kolibri/; include /etc/nginx/proxy_params; }
}

server {
    listen 80;
    server_name biblio.edubox.local;
    location / { proxy_pass http://koha_opac/; include /etc/nginx/proxy_params; }
}
```

### 8.2 docker-compose (extrait Nginx)

```yaml
nginx-proxy:
    image: nginx:1.27-alpine
    container_name: edubox-nginx
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/proxy_params:/etc/nginx/proxy_params:ro
      - ./portal:/var/www/edubox-portal:ro
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 64M
    healthcheck:
      test: ["CMD", "nginx", "-t"]
      interval: 60s
      timeout: 5s
```

---

## 9. Module 6 — Monitoring et accès distant

### 9.1 Monitoring local — Healthcheck Dashboard

Un micro-service custom (Go ou Python/Flask en Alpine) qui :

- Interroge les healthchecks Docker de chaque container toutes les 30s
- Collecte : CPU, RAM, disque, température du Pi, nombre de clients WiFi
- Expose une API JSON : `GET /api/status`
- Sert un mini dashboard HTML accessible sur `http://192.168.50.1:8090/`

**Container** :

```yaml
healthcheck:
    build:
      context: ./healthcheck
      dockerfile: Dockerfile
    container_name: edubox-healthcheck
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /sys/class/thermal:/sys/class/thermal:ro
      - /proc/stat:/host/proc/stat:ro
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 48M
```

### 9.2 Monitoring distant — Tailscale

**Tailscale** installé sur l'hôte (pas Docker) car il nécessite un accès réseau complet.

```bash
# Installation
curl -fsSL https://tailscale.com/install.sh | sh

# Configuration (une seule fois, avec internet)
tailscale up --ssh --hostname=edubox-001 --advertise-tags=tag:edubox
```

**Accès distant quand internet disponible** :

| Service | URL Tailscale |
|---|---|
| Dashboard status | `http://edubox-001:8090/` |
| Portainer | `https://edubox-001:9443/` |
| SSH | `ssh edubox-001` (via Tailscale SSH) |
| Moodle admin | `http://edubox-001/moodle/` |
| Koha staff | `http://edubox-001/biblio-admin/` |

**Sécurité Tailscale** :

- ACL restrictives : seuls les comptes admin Tailscale accèdent aux EduBox
- Tags : `tag:edubox` pour regrouper toutes les box
- SSH via Tailscale (pas de port 22 ouvert sur internet)

### 9.3 Portainer (gestion des containers)

```yaml
portainer:
    image: portainer/portainer-ce:lts-alpine
    container_name: edubox-portainer
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer_data:/data
    ports:
      - "9443:9443"
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 128M
```

**Accès** : uniquement via Tailscale (port 9443 non exposé sur wlan0, seulement sur l'interface Tailscale).

---

## 10. Module 7 — Résilience aux coupures d'électricité

### 10.1 Protection logicielle (toujours active)

| Mesure | Détail |
|---|---|
| **Système de fichiers** | ext4 avec journaling activé (défaut) |
| **Docker volumes** | Tous les volumes nommés, stockage sur la SD avec `fsync` |
| **MariaDB** | `innodb_flush_log_at_trx_commit=1` (flush à chaque transaction) |
| **MariaDB** | `innodb_doublewrite=1` (protection corruption) |
| **MariaDB** | `sync_binlog=1` |
| **Kolibri** | SQLite en mode `WAL` (Write-Ahead Logging) |
| **Swap** | 1 Go, `vm.swappiness=10` (économie SD) |
| **Docker restart policy** | `unless-stopped` sur tous les containers |
| **Watchdog** | systemd watchdog hardware du Pi 5 activé (`RuntimeWatchdogSec=30`) |
| **SD card** | Réduction des écritures : `noatime` dans fstab, tmpfs pour /tmp et /var/log |

### 10.2 Script de sauvegarde périodique

```bash
#!/bin/bash
# /usr/local/bin/edubox-backup.sh
# Exécuté toutes les 6 heures via systemd timer

BACKUP_DIR="/var/backups/edubox"
DATE=$(date +%Y%m%d_%H%M)

mkdir -p "$BACKUP_DIR"

# Dump MariaDB
docker exec edubox-mariadb mysqldump --all-databases --single-transaction \
    -u root -p"${MARIADB_ROOT_PASS}" > "$BACKUP_DIR/mariadb_$DATE.sql"

# Compress
gzip "$BACKUP_DIR/mariadb_$DATE.sql"

# Rotation : garder les 7 derniers backups
ls -tp "$BACKUP_DIR"/mariadb_*.sql.gz | tail -n +8 | xargs -I {} rm -- {}

echo "Backup completed: $DATE"
```

### 10.3 Détection de shutdown d'urgence (avec UPS optionnel)

Si un UPS est détecté (ex: via GPIO ou USB HID), un service écoute le signal "batterie faible" :

```bash
#!/bin/bash
# /usr/local/bin/edubox-ups-monitor.sh
# Pour UPS communiquant via GPIO ou NUT

while true; do
    if [[ -f /run/edubox/ups-low-battery ]]; then
        logger "EduBox: UPS low battery, initiating safe shutdown"
        # Backup rapide
        /usr/local/bin/edubox-backup.sh
        # Arrêt propre des containers
        docker compose -f /opt/edubox/docker-compose.yml stop
        # Shutdown système
        shutdown -h now "EduBox: UPS battery low"
    fi
    sleep 5
done
```

### 10.4 Démarrage automatique après coupure

```ini
# /etc/systemd/system/edubox-startup.service
[Unit]
Description=EduBox Auto-start
After=docker.service network.target hostapd.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/usr/local/bin/edubox-fsck-check.sh
ExecStart=/usr/bin/docker compose -f /opt/edubox/docker-compose.yml up -d
ExecStop=/usr/bin/docker compose -f /opt/edubox/docker-compose.yml stop

[Install]
WantedBy=multi-user.target
```

---

## 11. Docker Compose complet

### 11.1 Fichier `docker-compose.yml`

```yaml
version: "3.8"

services:

  # === BASE DE DONNÉES PARTAGÉE ===
  mariadb:
    image: mariadb:11.4
    container_name: edubox-mariadb
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PASS}
      MARIADB_DATABASE: moodle
      MARIADB_USER: moodle
      MARIADB_PASSWORD: ${MOODLE_DB_PASS}
    volumes:
      - mariadb_data:/var/lib/mysql
      - ./mariadb/init:/docker-entrypoint-initdb.d:ro
      - ./mariadb/conf.d:/etc/mysql/conf.d:ro
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 512M
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 30s
      timeout: 10s
      retries: 5
    command: >
      --innodb-buffer-pool-size=256M
      --innodb-log-file-size=32M
      --innodb-flush-log-at-trx-commit=1
      --innodb-doublewrite=1
      --max-connections=50
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_unicode_ci

  # === MEMCACHED (pour Koha) ===
  memcached:
    image: memcached:1.6-alpine
    container_name: edubox-memcached
    restart: unless-stopped
    command: memcached -m 32 -c 64
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 48M

  # === MOODLE ===
  moodle:
    image: erseco/alpine-moodle:latest
    container_name: edubox-moodle
    restart: unless-stopped
    depends_on:
      mariadb:
        condition: service_healthy
    environment:
      DB_HOST: mariadb
      DB_NAME: moodle
      DB_USER: moodle
      DB_PASS: ${MOODLE_DB_PASS}
      MOODLE_URL: http://edubox.local/moodle
      MOODLE_LANGUAGE: fr
      MOODLE_USERNAME: admin
      MOODLE_PASSWORD: ${MOODLE_ADMIN_PASS}
      MOODLE_SITE_NAME: "EduBox Moodle"
    volumes:
      - moodle_data:/var/www/moodledata
      - moodle_html:/var/www/html
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 700M
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8080/login/index.php"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 120s

  # === KOLIBRI ===
  kolibri:
    build:
      context: ./kolibri
      dockerfile: Dockerfile
    container_name: edubox-kolibri
    restart: unless-stopped
    environment:
      KOLIBRI_HOME: /kolibri_data
      KOLIBRI_LISTEN_PORT: "8080"
    volumes:
      - kolibri_data:/kolibri_data
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 500M
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8080/api/public/info/"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 60s

  # === KOHA ===
  koha:
    build:
      context: ./koha
      dockerfile: Dockerfile
    container_name: edubox-koha
    restart: unless-stopped
    depends_on:
      mariadb:
        condition: service_healthy
      memcached:
        condition: service_started
    environment:
      KOHA_INSTANCE: edubox
      KOHA_DB_HOST: mariadb
      KOHA_DB_NAME: koha
      KOHA_DB_USER: koha
      KOHA_DB_PASS: ${KOHA_DB_PASS}
      MEMCACHED_SERVER: memcached:11211
    volumes:
      - koha_data:/var/lib/koha
      - koha_config:/etc/koha
    ports:
      - "6001:6001"
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 700M
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8080/"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 120s

  # === REVERSE PROXY + PORTAIL ===
  nginx-proxy:
    image: nginx:1.27-alpine
    container_name: edubox-nginx
    restart: unless-stopped
    depends_on:
      - moodle
      - kolibri
      - koha
    ports:
      - "80:80"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/proxy_params:/etc/nginx/proxy_params:ro
      - ./portal:/var/www/edubox-portal:ro
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 64M

  # === MONITORING ===
  healthcheck-dashboard:
    build:
      context: ./healthcheck
      dockerfile: Dockerfile
    container_name: edubox-healthcheck
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    ports:
      - "8090:8090"
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 48M

  # === PORTAINER ===
  portainer:
    image: portainer/portainer-ce:lts-alpine
    container_name: edubox-portainer
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer_data:/data
    ports:
      - "127.0.0.1:9443:9443"
    networks:
      - edubox-net
    deploy:
      resources:
        limits:
          memory: 128M

networks:
  edubox-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  mariadb_data:
  moodle_data:
  moodle_html:
  kolibri_data:
  koha_data:
  koha_config:
  portainer_data:
```

### 11.2 Fichier `.env`

```bash
# /opt/edubox/.env
# CHANGER TOUS CES MOTS DE PASSE AVANT DÉPLOIEMENT

MARIADB_ROOT_PASS=edubox_root_2024_CHANGE_ME
MOODLE_DB_PASS=moodle_db_2024_CHANGE_ME
MOODLE_ADMIN_PASS=MoodleAdmin2024!
KOHA_DB_PASS=koha_db_2024_CHANGE_ME
SIP2_GATE_PASS=gate_2024_CHANGE_ME
SIP2_SELFCHECK_PASS=selfcheck_2024_CHANGE_ME
```

### 11.3 Script d'initialisation MariaDB (bases multiples)

```sql
-- /opt/edubox/mariadb/init/01-create-koha-db.sql
CREATE DATABASE IF NOT EXISTS koha
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'koha'@'%'
    IDENTIFIED BY '${KOHA_DB_PASS}';

GRANT ALL PRIVILEGES ON koha.* TO 'koha'@'%';
FLUSH PRIVILEGES;
```

---

## 12. Script de déploiement principal

### 12.1 Prérequis

- Raspberry Pi 5 (4 Go) avec Raspberry Pi OS Lite 64-bit (Bookworm) installé
- Connecté en RJ45 à internet
- Accès SSH activé
- SD card 512 Go insérée

### 12.2 Script `edubox-install.sh`

Ce script est le point d'entrée unique que Claude Code exécutera :

```bash
#!/bin/bash
set -euo pipefail

# ========================================================
# EduBox Installer v1.0
# Déploiement automatique sur Raspberry Pi 5
# ========================================================

EDUBOX_DIR="/opt/edubox"
LOG_FILE="/var/log/edubox-install.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "=== EduBox Installation Started ==="

# --- 1. Mise à jour système ---
log "Step 1/12: System update"
apt-get update && apt-get upgrade -y
apt-get install -y \
    git curl wget ca-certificates \
    hostapd dnsmasq \
    iptables-persistent \
    ntp \
    python3 python3-pip python3-evdev \
    usbutils

# --- 2. Configuration réseau (WiFi AP) ---
log "Step 2/12: WiFi Access Point setup"
systemctl stop hostapd dnsmasq || true
systemctl unmask hostapd

# hostapd config
cat > /etc/hostapd/hostapd.conf << 'HOSTAPD'
interface=wlan0
driver=nl80211
ssid=EduBox
hw_mode=g
channel=7
ieee80211n=1
wmm_enabled=1
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
country_code=CH
HOSTAPD

echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' > /etc/default/hostapd

# dnsmasq config
mv /etc/dnsmasq.conf /etc/dnsmasq.conf.orig 2>/dev/null || true
cat > /etc/dnsmasq.conf << 'DNSMASQ'
interface=wlan0
bind-interfaces
no-resolv
no-poll
dhcp-range=192.168.50.10,192.168.50.200,255.255.255.0,24h
dhcp-option=option:router,192.168.50.1
dhcp-option=option:dns-server,192.168.50.1
address=/edubox.local/192.168.50.1
address=/moodle.edubox.local/192.168.50.1
address=/kolibri.edubox.local/192.168.50.1
address=/biblio.edubox.local/192.168.50.1
address=/#/192.168.50.1
DNSMASQ

# Static IP for wlan0
cat >> /etc/dhcpcd.conf << 'DHCPCD'

# EduBox WiFi AP
interface wlan0
    static ip_address=192.168.50.1/24
    nohook wpa_supplicant
DHCPCD

# --- 3. IP Forwarding & NAT ---
log "Step 3/12: Network forwarding"
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/90-edubox.conf
sysctl -p /etc/sysctl.d/90-edubox.conf

iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
iptables -A FORWARD -i wlan0 -o eth0 -j ACCEPT
iptables -A FORWARD -i eth0 -o wlan0 -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 80 \
    -d '!' 192.168.50.1 -j DNAT --to-destination 192.168.50.1:80
netfilter-persistent save

# --- 4. Installer Docker ---
log "Step 4/12: Docker installation"
curl -fsSL https://get.docker.com | sh
usermod -aG docker pi 2>/dev/null || usermod -aG docker $(logname) 2>/dev/null || true
systemctl enable docker

# Docker Compose plugin
apt-get install -y docker-compose-plugin

# --- 5. Installer Tailscale ---
log "Step 5/12: Tailscale installation"
curl -fsSL https://tailscale.com/install.sh | sh
systemctl enable tailscaled
log "NOTE: Run 'tailscale up --ssh --hostname=edubox-001' manually after install"

# --- 6. Configurer le swap ---
log "Step 6/12: Swap configuration"
dphys-swapfile swapoff || true
sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
dphys-swapfile setup
dphys-swapfile swapon
echo "vm.swappiness=10" >> /etc/sysctl.d/90-edubox.conf
sysctl -p /etc/sysctl.d/90-edubox.conf

# --- 7. Optimisations SD card ---
log "Step 7/12: SD card optimizations"
# noatime
sed -i 's/defaults/defaults,noatime/' /etc/fstab
# tmpfs pour réduire les écritures
echo "tmpfs /tmp tmpfs defaults,noatime,nosuid,size=100m 0 0" >> /etc/fstab
echo "tmpfs /var/log tmpfs defaults,noatime,nosuid,size=50m 0 0" >> /etc/fstab

# --- 8. Watchdog hardware ---
log "Step 8/12: Hardware watchdog"
sed -i 's/#RuntimeWatchdogSec=.*/RuntimeWatchdogSec=30/' /etc/systemd/system.conf
sed -i 's/#ShutdownWatchdogSec=.*/ShutdownWatchdogSec=5min/' /etc/systemd/system.conf

# --- 9. Créer la structure EduBox ---
log "Step 9/12: EduBox directory structure"
mkdir -p "$EDUBOX_DIR"/{nginx/conf.d,portal,kolibri,koha,healthcheck,mariadb/{init,conf.d},scripts,moodle-courses}

# Copier les fichiers de configuration
# (Les fichiers seront créés par Claude Code dans les étapes suivantes)

# --- 10. Déployer Docker Compose ---
log "Step 10/12: Docker Compose deployment"
cd "$EDUBOX_DIR"
docker compose pull
docker compose build
docker compose up -d

# --- 11. Attendre le démarrage et configurer ---
log "Step 11/12: Post-deployment configuration"
log "Waiting for services to start (this may take 5-10 minutes on first run)..."
sleep 120

# Vérifier les services
for svc in edubox-mariadb edubox-moodle edubox-kolibri edubox-koha edubox-nginx; do
    if docker ps --format '{{.Names}}' | grep -q "$svc"; then
        log "✓ $svc is running"
    else
        log "✗ $svc FAILED to start"
    fi
done

# --- 12. Activer les services au boot ---
log "Step 12/12: Enable services at boot"
systemctl enable hostapd
systemctl enable dnsmasq
systemctl start hostapd
systemctl start dnsmasq

# Créer le service systemd EduBox
cat > /etc/systemd/system/edubox.service << 'SYSTEMD'
[Unit]
Description=EduBox Docker Stack
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/edubox
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose stop
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable edubox.service

log "=== EduBox Installation Complete ==="
log ""
log "NEXT STEPS:"
log "  1. Reboot: sudo reboot"
log "  2. Connect to WiFi 'EduBox' from a tablet"
log "  3. Open http://edubox.local/ or http://192.168.50.1/"
log "  4. For remote monitoring: sudo tailscale up --ssh --hostname=edubox-001"
log "  5. Import Kolibri content: /opt/edubox/scripts/edubox-kolibri-import.sh"
log ""
log "Default credentials:"
log "  Moodle admin: admin / ${MOODLE_ADMIN_PASS}"
log "  Koha staff: koha_library / (see web installer)"
log "  Portainer: https://localhost:9443 (create admin on first access)"
```

---

## 13. Structure des fichiers du projet

```
/opt/edubox/
├── docker-compose.yml
├── .env                          # Mots de passe (non versionné)
├── README.md
│
├── nginx/
│   ├── conf.d/
│   │   └── edubox.conf           # Config reverse proxy
│   └── proxy_params              # Headers proxy communs
│
├── portal/
│   ├── index.html                # Page d'accueil responsive (FR/EN/ES/PT/IT/DE)
│   ├── style.css                 # Styles inline-friendly
│   ├── script.js                 # Status check + i18n
│   └── assets/
│       ├── moodle-icon.svg
│       ├── kolibri-icon.svg
│       ├── koha-icon.svg
│       └── edubox-logo.svg
│
├── kolibri/
│   └── Dockerfile                # Image Kolibri arm64
│
├── koha/
│   ├── Dockerfile                # Image Koha arm64
│   ├── entrypoint.sh             # Init Koha instance
│   ├── supervisord.conf          # Process manager interne
│   ├── koha-sites.conf           # Config sites Koha
│   └── SIPconfig.xml             # Config SIP2
│
├── healthcheck/
│   ├── Dockerfile                # Dashboard status (Python/Flask)
│   ├── app.py                    # API + mini dashboard
│   └── templates/
│       └── dashboard.html
│
├── mariadb/
│   ├── init/
│   │   └── 01-create-koha-db.sql # Création BD Koha
│   └── conf.d/
│       └── edubox.cnf            # Tuning MariaDB pour Pi
│
├── scripts/
│   ├── edubox-install.sh         # Installateur principal
│   ├── edubox-kolibri-import.sh  # Import channels Kolibri
│   ├── edubox-moodle-setup.sh    # Import cours Moodle
│   ├── edubox-koha-setup.sh      # Config initiale Koha
│   ├── edubox-backup.sh          # Backup périodique
│   ├── edubox-connectivity.sh    # Check internet
│   ├── edubox-ups-monitor.sh     # Surveillance UPS (optionnel)
│   └── edubox-barcode-bridge.py  # Pont scanner USB → SIP2/API
│
└── moodle-courses/               # Fichiers .mbz pré-packagés
    ├── digital-literacy-fr.mbz
    ├── basic-math-fr.mbz
    └── english-beginners-fr.mbz
```

---

## 14. Plan d'exécution pour Claude Code

### Phase 1 — Infrastructure (estimé : 1h)

| Étape | Tâche | Validation |
|---|---|---|
| 1.1 | Se connecter au Pi via SSH | `ssh pi@<IP>` fonctionne |
| 1.2 | Exécuter la mise à jour système | `apt upgrade` terminé sans erreur |
| 1.3 | Installer Docker + Docker Compose | `docker --version` et `docker compose version` OK |
| 1.4 | Configurer hostapd + dnsmasq + réseau | WiFi "Ofelia" visible, DHCP fonctionnel |
| 1.5 | Configurer iptables / NAT | Forwarding internet fonctionnel (si connecté) |
| 1.6 | Installer Tailscale | `tailscale status` OK |
| 1.7 | Configurer swap + optimisations SD | `swapon --show` montre 1 Go |
| 1.8 | Activer watchdog | `cat /etc/systemd/system.conf` contient RuntimeWatchdogSec |

### Phase 2 — Construction des images Docker (estimé : 2h)

| Étape | Tâche | Validation |
|---|---|---|
| 2.1 | Créer l'arborescence `/opt/edubox/` | `tree /opt/edubox/` correct |
| 2.2 | Créer le `.env` avec mots de passe générés | Fichier existe, permissions 600 |
| 2.3 | Écrire le Dockerfile Kolibri | `docker build` OK |
| 2.4 | Écrire le Dockerfile Koha | `docker build` OK |
| 2.5 | Écrire la config MariaDB | Fichier `.cnf` en place |
| 2.6 | Écrire le `docker-compose.yml` complet | `docker compose config` valide |
| 2.7 | `docker compose build` | Toutes les images construites |
| 2.8 | `docker compose pull` (images officielles) | Images téléchargées |

### Phase 3 — Portail et Nginx (estimé : 30min)

| Étape | Tâche | Validation |
|---|---|---|
| 3.1 | Créer la page HTML du portail (FR/EN/ES) | Fichier `index.html` en place |
| 3.2 | Créer la config Nginx reverse proxy | `nginx -t` OK dans le container |
| 3.3 | Tester le captive portal | Connexion WiFi → redirection vers portail |

### Phase 4 — Démarrage et configuration (estimé : 1h)

| Étape | Tâche | Validation |
|---|---|---|
| 4.1 | `docker compose up -d` | Tous containers running |
| 4.2 | Vérifier MariaDB | `docker exec edubox-mariadb mysql -e "SHOW DATABASES"` |
| 4.3 | Vérifier Moodle | `curl http://localhost/moodle/` retourne HTTP 200 |
| 4.4 | Vérifier Kolibri | `curl http://localhost/kolibri/` retourne HTTP 200 |
| 4.5 | Vérifier Koha OPAC | `curl http://localhost/biblio/` retourne HTTP 200 |
| 4.6 | Vérifier Koha Staff | `curl http://localhost/biblio-admin/` retourne HTTP 200 |
| 4.7 | Vérifier SIP2 | `telnet localhost 6001` répond |

### Phase 5 — Import de contenu (estimé : 2h, dépend de la bande passante)

| Étape | Tâche | Validation |
|---|---|---|
| 5.1 | Lancer l'import Kolibri channels | Channels visibles dans Kolibri |
| 5.2 | Configurer Moodle (langues, cours) | Cours visibles dans Moodle |
| 5.3 | Configurer Koha (bibliothèque, types) | Interface staff accessible |
| 5.4 | Tester le scanner USB (si branché) | Code-barres scanné visible dans Koha |

### Phase 6 — Monitoring et finalisation (estimé : 30min)

| Étape | Tâche | Validation |
|---|---|---|
| 6.1 | Déployer le healthcheck dashboard | `curl http://localhost:8090/` retourne le dashboard |
| 6.2 | Configurer Tailscale | `tailscale up` + accès distant confirmé |
| 6.3 | Configurer les backups automatiques | systemd timer actif |
| 6.4 | Créer le service systemd EduBox | `systemctl status edubox` OK |
| 6.5 | **Reboot test** | Après reboot, tout redémarre automatiquement |
| 6.6 | **Test coupure électrique** | Débrancher/rebrancher → tout revient |

---

## 15. Tests d'acceptance finaux

| # | Test | Résultat attendu |
|---|---|---|
| T1 | Connecter une tablette au WiFi "Ofelia" | Connexion OK, portail captif s'affiche |
| T2 | Ouvrir Moodle depuis le portail | Page de login Moodle s'affiche |
| T3 | Ouvrir Kolibri depuis le portail | Page d'accueil Kolibri avec contenu |
| T4 | Ouvrir Koha OPAC depuis le portail | Catalogue bibliothèque s'affiche |
| T5 | Scanner un code-barres dans Koha staff | Code-barres apparaît dans le champ |
| T6 | Débrancher le câble RJ45 | WiFi et apps continuent de fonctionner |
| T7 | Rebrancher le câble RJ45 | Internet partagé aux tablettes + Tailscale reconnecte |
| T8 | Débrancher l'alimentation et rebrancher | Tout redémarre automatiquement, pas de corruption |
| T9 | Accéder au dashboard status depuis Tailscale | Dashboard accessible à distance |
| T10 | 15 tablettes connectées simultanément | Toutes accèdent aux 3 services |

---

## 16. Maintenance et opérations

### 16.1 Commandes utiles

```bash
# Voir l'état de tous les containers
docker compose -f /opt/edubox/docker-compose.yml ps

# Logs d'un service
docker logs edubox-moodle --tail 100 -f

# Redémarrer un service
docker compose -f /opt/edubox/docker-compose.yml restart moodle

# Backup manuel
/opt/edubox/scripts/edubox-backup.sh

# Voir les clients WiFi connectés
iw dev wlan0 station dump

# Vérifier la température du Pi
vcgencmd measure_temp

# Espace disque
df -h /
docker system df
```

### 16.2 Mise à jour des services

```bash
cd /opt/edubox
docker compose pull          # Mettre à jour les images officielles
docker compose build --pull  # Reconstruire les images custom
docker compose up -d         # Redéployer
docker image prune -f        # Nettoyer les anciennes images
```

---

## 17. Limitations connues et compromis

| Limitation | Raison | Mitigation |
|---|---|---|
| WiFi intégré limité à ~15-20 clients | Antenne Pi 5 faible | AP USB externe recommandé pour 20+ clients |
| 4 Go RAM serré pour 3 apps + DB | Contrainte matériel | Limites mémoire strictes par container, swap 1 Go |
| microSD plus lent qu'un SSD | Choix utilisateur | `noatime`, tmpfs, write minimization |
| Koha lent au premier chargement | Perl + Zebra indexing | Cache Memcached, Plack pre-fork |
| Pas de HTTPS sur le réseau local | Certificats impossibles sans DNS public | HTTP OK car réseau fermé et local |
| Import Kolibri nécessite internet (une fois) | Channels téléchargés depuis le cloud | Alternative : import USB offline |

---

## 18. Évolutions futures possibles

- **Kiwix** (Wikipedia complète hors-ligne) en complément de Kolibri
- **Nextcloud** pour le partage de fichiers entre tablettes
- **LLM local** (type Ollama + petit modèle) pour assistance IA offline (cf. travaux Beekee avec LBD)
- **Réplication multi-box** : synchroniser Moodle et Koha entre plusieurs EduBox
- **AP WiFi externe** USB (ex: TP-Link AC600) pour supporter 40+ clients
- **SSD NVMe** via HAT M.2 pour performances et durabilité accrues
