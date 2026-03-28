# FEAT-006 — Accès distant via ZeroTier

**Statut** : DONE
**Date** : 2026-03-28

## Contexte

Le Pi sera déployé en Amérique du Sud derrière un routeur NAT sans IP fixe. Besoin d'accès SSH à distance pour maintenance et nouvelles fonctionnalités, sans ouvrir de ports sur le routeur local.

## Solution : ZeroTier

ZeroTier crée un réseau VPN mesh P2P. Le Pi se connecte vers l'extérieur (outbound) — aucun port entrant à ouvrir sur le routeur de la bibliothèque.

## Configuration

- **Network ID** : `f3797ba7a8e6a4b5` (compte Zitoon / VB)
- **Pi ZeroTier address** : `2828b2b0e1`
- **Pi ZeroTier IP** : `10.115.169.147`
- **Interface Pi** : `ztktiz2ay5`
- **Service** : `zerotier-one` activé au démarrage (`systemctl enable zerotier-one`)

## Connexion SSH à distance

```bash
ssh -i ~/.ssh/id_ed25519_pi val@10.115.169.147
```

## Prérequis

- Le Pi doit avoir accès à internet (RJ45 branché au routeur local, ou WiFi maison)
- Le WiFi Ofelia (AP) seul ne suffit pas — ZeroTier nécessite une connexion sortante
- L'ordinateur admin doit avoir ZeroTier installé et être autorisé sur le réseau `f3797ba7a8e6a4b5`

## Installation effectuée

```bash
curl -s https://install.zerotier.com | sudo bash
sudo zerotier-cli join f3797ba7a8e6a4b5
sudo systemctl enable zerotier-one
```
