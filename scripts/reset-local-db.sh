#!/bin/sh
# Développement local uniquement : recrée une base vide et applique toutes les migrations.
set -eu
DB=${1:?nom de base}
[ "${APP_ENV:-development}" = "production" ] && { echo "Refusé en production"; exit 1; }
psql "${ADMIN_DATABASE_URL:?}" -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER ${DB_OWNER:-reptile}"
for f in prisma/migrations/*/migration.sql; do psql "${ADMIN_DATABASE_URL%/*}/$DB" -q -v ON_ERROR_STOP=1 -f "$f"; done
