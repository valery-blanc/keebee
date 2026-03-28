# FEAT-005 — Internationalisation portail (6 langues)

**Statut** : DONE
**Date** : 2026-03-28

## Contexte

Le portail Ofelia était uniquement disponible en français (avec FR/EN/ES dans le i18n mais seulement 3 boutons). Besoin : interface complète en 6 langues avec sélecteur persistant.

## Implémentation

### Portail (portal/index.html)
- 6 langues : FR, EN, ES, PT, IT, DE
- Barre de langue avec `flex-wrap: wrap` pour le mobile (6 boutons sans débordement)
- `data-lang` attribute sur chaque bouton pour `setLang()` / toggle `.active`
- `localStorage.setItem('ofelia-lang', lang)` — persistance inter-sessions
- Restauration au chargement : `const saved = localStorage.getItem('ofelia-lang')`
- Éléments traduits : tagline, desc-moodle, desc-kolibri, name-koha, desc-koha, footer, running/stopped/checking

### Moodle — paquetages langue
- Langues installées via PHP CLI (`\tool_langimport\controller::install_languagepacks`)
- Packs installés : `es` (Español), `pt` (Português), `it` (Italiano), `de` (Deutsch)
- FR déjà installé par défaut dans Moodle
- EN = langue de base Moodle

## Traductions portail

| ID | FR | EN | ES | PT | IT | DE |
|----|----|----|----|----|----|----|
| tagline | Bibliothèque éducative hors-ligne | Offline educational library | Biblioteca educativa sin conexión | Biblioteca educativa offline | Biblioteca educativa offline | Offline-Bildungsbibliothek |
| name-koha | Bibliothèque | Library | Biblioteca | Biblioteca | Biblioteca | Bibliothek |
| footer | Ofelia — Serveur éducatif local | Ofelia — Local educational server | Ofelia — Servidor educativo local | Ofelia — Servidor educativo local | Ofelia — Server educativo locale | Ofelia — Lokaler Bildungsserver |
