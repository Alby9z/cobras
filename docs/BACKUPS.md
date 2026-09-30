# Sauvegardes

## Ce qui est sauvegardé

| Donnée | Méthode | Fréquence | Rétention |
|---|---|---|---|
| PostgreSQL (toutes les tables, dont audit et factures) | `pg_dump -Fc -Z 9`, lisibilité vérifiée par `pg_restore --list` | quotidienne (`BACKUP_CRON`, défaut 03:30 UTC) | `BACKUP_RETENTION_DAYS` en local (défaut 14) ; hors site selon la politique du bucket |
| Bucket privé (documents, factures PDF) | `rclone sync` vers le bucket de sauvegarde ; fichiers supprimés conservés dans `private-deleted/<date>` | quotidienne | selon la politique du bucket |
| Bucket public (images) | `rclone sync` | quotidienne | — |
| Redis | AOF sur volume (`redis_data`) | continue | **non sauvegardé** : la file est reconstructible (les e-mails, PDF et analyses en attente sont remis en file depuis la base par le worker) |
| Configuration | `.env` | **manuelle** | à conserver dans un coffre de mots de passe, jamais dans le dépôt |

Script : `deploy/backup.sh` (service `backup`). Échec ou absence d'exécution signalés via
`HEALTHCHECK_URL` (ex. healthchecks.io, période 1 jour).

## Recommandations

- Bucket de sauvegarde sur **un autre compte** (et idéalement une autre région UE), clé d'accès dédiée,
  verrouillage d'objets (WORM) activé si le fournisseur le permet.
- Durée de conservation hors site à définir avec l'expert-comptable (pièces comptables) et le DPO
  (données personnelles) — non fixée par le logiciel.
- Sauvegarde manuelle avant toute migration : `docker compose exec backup sh /backup.sh`.

## Vérification

Une sauvegarde non restaurée n'est pas une sauvegarde : **restaurer chaque trimestre** sur un serveur de
préproduction (procédure dans [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)) et consigner la date, la
durée et le résultat.

> La chaîne sauvegarde → restauration n'a pas pu être exécutée dans l'environnement de développement de ce
> projet (pas de Docker). Elle doit être testée lors de la mise en préproduction.
