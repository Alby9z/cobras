#!/bin/sh
# Exécuté UNE SEULE FOIS par l'image postgres, à l'initialisation d'un volume vide.
# Sépare les privilèges :
#   - POSTGRES_USER (propriétaire du schéma) : migrations uniquement ;
#   - APP_DB_USER : rôle d'exécution de l'application et du worker, limité au DML.
# Le rôle d'exécution n'est ni superutilisateur, ni propriétaire des tables, ni BYPASSRLS :
# il ne peut ni désactiver les déclencheurs d'immuabilité (audit, factures, mouvements de stock),
# ni contourner la Row Level Security, ni faire de TRUNCATE / DROP.
set -eu
: "${APP_DB_USER:?APP_DB_USER manquant}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD manquant}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" -v owner="$POSTGRES_USER" -v dbname="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
-- Privilèges appliqués automatiquement aux objets créés ensuite par les migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
-- Au cas où des tables existeraient déjà (restauration) :
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
SQL
