#!/bin/sh
# Sauvegarde quotidienne : base PostgreSQL (dump compressé), rotation locale,
# copie hors site et synchronisation des fichiers (images, documents, factures).
set -eu
STAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="/backups/db-$STAMP.dump"
fail() { echo "[backup] ÉCHEC : $1"; [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "$HEALTHCHECK_URL/fail" >/dev/null || true; exit 1; }

pg_dump -Fc -Z 9 -f "$FILE" || fail "pg_dump"
pg_restore --list "$FILE" >/dev/null || fail "dump illisible"
find /backups -name 'db-*.dump' -mtime +${BACKUP_RETENTION_DAYS:-14} -delete

# Copie hors site (bucket S3/R2 dédié aux sauvegardes, idéalement autre compte/région)
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  export RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=${BACKUP_S3_PROVIDER:-Cloudflare} \
    RCLONE_CONFIG_BK_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" RCLONE_CONFIG_BK_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
    RCLONE_CONFIG_BK_ENDPOINT="${BACKUP_S3_ENDPOINT:-}" RCLONE_CONFIG_BK_REGION="${BACKUP_S3_REGION:-auto}"
  export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=${BACKUP_S3_PROVIDER:-Cloudflare} \
    RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
    RCLONE_CONFIG_SRC_ENDPOINT="${S3_ENDPOINT:-}" RCLONE_CONFIG_SRC_REGION="${S3_REGION:-auto}"
  rclone copy "$FILE" "bk:$BACKUP_S3_BUCKET/database/" || fail "envoi du dump"
  rclone sync "src:$S3_BUCKET_PRIVATE" "bk:$BACKUP_S3_BUCKET/private/" --backup-dir "bk:$BACKUP_S3_BUCKET/private-deleted/$STAMP" || fail "sync documents"
  rclone sync "src:$S3_BUCKET_PUBLIC" "bk:$BACKUP_S3_BUCKET/public/" || fail "sync images"
fi

[ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "$HEALTHCHECK_URL" >/dev/null || true
echo "[backup] OK $FILE"
