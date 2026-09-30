#!/bin/sh
# Restauration rapide de la base : ./deploy/restore.sh backups/db-AAAAMMJJ-HHMMSS.dump
# ⚠ Remplace intégralement la base de production. L'application est arrêtée pendant l'opération.
set -eu
[ -f "${1:-}" ] || { echo "Usage : $0 chemin/vers/db-*.dump"; exit 1; }
. ./.env
docker compose stop app worker
docker compose cp "$1" db:/tmp/restore.dump
docker compose exec -T db pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/restore.dump
docker compose exec -T db rm /tmp/restore.dump
docker compose start app worker
echo "Restauration terminée."
