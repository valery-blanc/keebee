---
id: BUG-007
title: Koha OPAC — 404 après login ou clic (CGI OPAC routés vers staff)
status: FIXED ✓ confirmé
---

## Symptôme

La page d'accueil OPAC (`/biblio/`) s'affiche correctement, mais toute interaction
(login, clic sur un livre, recherche) produit une erreur 404.

## Reproduction

1. Accéder à `http://192.168.50.1/biblio/`
2. La page d'accueil OPAC s'affiche ✓
3. Cliquer sur "Login" ou effectuer une recherche → 404

## Cause racine

Koha génère ses liens internes comme des URLs **absolues sans préfixe**.
Par exemple, le formulaire de login pointe vers `/cgi-bin/koha/opac-user.pl`
(pas `/biblio/cgi-bin/koha/opac-user.pl`).

Dans nginx, la règle `/cgi-bin/koha/` existante routait TOUS les scripts CGI
vers le backend **staff** (`koha_staff:8081`). Les scripts OPAC (opac-user.pl,
opac-main.pl, opac-search.pl, etc.) se retrouvaient sur le VHost staff d'Apache,
qui ne les sert pas → 404.

```
Browser: GET /cgi-bin/koha/opac-user.pl
Nginx:   → match /cgi-bin/koha/ → proxy koha_staff:8081   ← MAUVAIS backend
Apache:  VHost staff n'a pas opac-user.pl → 404
```

## Fix appliqué

`nginx/conf.d/edubox.conf` — ajout d'une location regex **avant** la règle staff,
pour intercepter tous les scripts `opac-*` et les router vers `koha_opac:8080` :

```nginx
# Les règles regex ~ ont priorité sur les locations préfixe /
location ~ ^/cgi-bin/koha/opac {
    proxy_pass http://koha_opac;
    include /etc/nginx/proxy_params;
}
```

La règle `/cgi-bin/koha/` existante (staff) continue de fonctionner pour
l'interface d'administration.

## Section spec impactée

`docs/specs/specs_keebee.md` — section Koha / Nginx routing
