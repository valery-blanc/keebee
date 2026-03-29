---
id: BUG-005
title: Koha shows Apache default page after container recreation
status: FIXED
---

## Symptôme

Après une recréation du container Koha (ex: `docker compose up -d` suite à un changement d'image ou de config), `http://<IP>/biblio/` affichait la page par défaut d'Apache Debian au lieu de l'OPAC Koha.

## Reproduction

1. `docker compose down koha` puis `docker compose up -d koha`
2. Accéder à `http://192.168.0.147/biblio/`
3. → Page "Apache2 Debian Default Page"

## Cause racine

Le fichier de configuration Apache du site Koha (`/etc/apache2/sites-available/edubox.conf`) n'est **pas** dans un volume Docker — il est généré par `koha-create` lors du premier démarrage. Lors d'une recréation du container, le volume `koha_config:/etc/koha` persiste le fichier `koha-conf.xml`, mais **pas** la config Apache.

L'entrypoint skipait `koha-create` si `/etc/koha/sites/edubox/koha-conf.xml` existait déjà — ce qui était vrai (volume persisté) — mais la config Apache était absente.

## Fix appliqué

`koha/entrypoint.sh` — condition de `koha-create` étendue pour vérifier aussi la config Apache :

```bash
# Avant (bug)
if [ ! -f "/etc/koha/sites/$INSTANCE/koha-conf.xml" ]; then

# Après (fix)
if [ ! -f "/etc/koha/sites/$INSTANCE/koha-conf.xml" ] || [ ! -f "/etc/apache2/sites-available/$INSTANCE.conf" ]; then
```

Si l'un des deux fichiers est manquant, `koha-create --use-db` est relancé. Il détecte la DB existante et régénère uniquement les configs manquantes.

## Section spec impactée

`docs/specs/specs_keebee.md` — section Koha / Architecture de démarrage
