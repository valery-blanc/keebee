---
id: BUG-006
title: Moodle cassé ou très lent avec une IP différente de celle codée en dur
status: FIXED
---

## Symptôme

Moodle ne fonctionnait pas ou était très lent selon l'IP/nom d'hôte utilisé pour accéder au portail. Le site se chargeait avec des ressources statiques manquantes (CSS/JS) pointant vers une ancienne IP.

## Reproduction

1. Accéder à Moodle via `http://192.168.50.1/moodle/` (WiFi AP)
2. Accéder à Moodle via `http://192.168.0.147/moodle/` (réseau local)
3. L'un des deux contextes retournait des pages cassées ou très lentes

## Cause racine

La directive `sub_filter` dans nginx remplaçait `http://localhost` par une URL avec l'IP **codée en dur** dans le fichier de configuration :

```nginx
# Ancienne config (bug) — IP codée en dur
sub_filter 'http://localhost' 'http://192.168.50.1/moodle';
```

Si l'utilisateur accédait depuis un autre réseau (ex: `192.168.0.147` en RJ45), les URLs générées par Moodle pointaient toujours vers `192.168.50.1`.

Aggravé lors du changement d'IP du Pi de `.149` à `.147`.

## Fix appliqué

`nginx/conf.d/edubox.conf` — remplacement par la variable dynamique `$host` :

```nginx
# Fix — dynamique, fonctionne sur toutes les IPs/noms d'hôte
proxy_redirect http://localhost/ /moodle/;
sub_filter 'http://localhost' 'http://$host/moodle';
sub_filter_once off;
sub_filter_types text/html text/css application/javascript text/javascript application/json;
```

La variable `$host` nginx contient l'en-tête `Host` de la requête entrante — elle s'adapte automatiquement à toutes les IPs et noms d'hôte (`192.168.50.1`, `192.168.0.147`, `ofelia`, `libofelia`).

## Section spec impactée

`docs/specs/specs_keebee.md` — section Nginx / Moodle proxy
