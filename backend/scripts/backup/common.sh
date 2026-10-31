#!/usr/bin/env bash
# Dùng chung cho backup.sh / restore.sh: đọc .env, dựng cấu hình rclone qua biến môi trường.
set -euo pipefail

RCLONE_IMAGE="rclone/rclone:1.75.1"
PG_IMAGE="postgres:16-alpine"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$BACKEND_DIR/.env}"

# Đọc KEY=VALUE từ .env (không chạy file như script; biến đã có trong môi trường thì giữ nguyên).
load_env() {
  [[ -f "$ENV_FILE" ]] || { echo "Không thấy $ENV_FILE" >&2; exit 1; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# || "$line" != *=* ]] && continue
    local key="${line%%=*}" value="${line#*=}"
    key="${key//[[:space:]]/}"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    [[ -n "${!key+x}" ]] && continue
    value="${value%\"}"; value="${value#\"}"
    export "$key=$value"
  done < "$ENV_FILE"
  DATABASE_URL="${DATABASE_URL//@postgres:/@localhost:}"
  DATABASE_MIGRATE_URL="${DATABASE_MIGRATE_URL:-$DATABASE_URL}"
  DATABASE_MIGRATE_URL="${DATABASE_MIGRATE_URL//@postgres:/@localhost:}"
  S3_ENDPOINT="${S3_ENDPOINT//\/\/minio:/\/\/localhost:}"
  export DATABASE_URL DATABASE_MIGRATE_URL S3_ENDPOINT
}

require() {
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || { echo "Thiếu biến $name (đặt trong $ENV_FILE)" >&2; exit 1; }
  done
}

# pg_dump/pg_restore không hiểu tham số ?schema= của Prisma.
pg_url() { echo "${1%%\?*}"; }

# rclone chạy trong Docker, mạng host (tới localhost:9000 của MinIO).
# Remote "minio": nguồn S3. Remote "safe": kho backup đã mã hoá (crypt) đặt trên BACKUP_DEST.
rclone_run() {
  local obscured
  obscured="$(docker run --rm "$RCLONE_IMAGE" obscure "$BACKUP_PASSWORD")"
  local mount=() remote="$BACKUP_DEST"
  if [[ "$BACKUP_DEST" == /* ]]; then
    mkdir -p "$BACKUP_DEST"
    mount=(-v "$BACKUP_DEST:/backup")
    remote="/backup"
  fi
  docker run --rm -i --network host --user "$(id -u):$(id -g)" "${mount[@]}" \
    -e RCLONE_CONFIG_MINIO_TYPE=s3 \
    -e RCLONE_CONFIG_MINIO_PROVIDER=Minio \
    -e RCLONE_CONFIG_MINIO_ENDPOINT="${RCLONE_S3_ENDPOINT:-$S3_ENDPOINT}" \
    -e RCLONE_CONFIG_MINIO_ACCESS_KEY_ID="${RCLONE_S3_ACCESS_KEY:-$S3_ACCESS_KEY}" \
    -e RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY="${RCLONE_S3_SECRET_KEY:-$S3_SECRET_KEY}" \
    -e RCLONE_CONFIG_SAFE_TYPE=crypt \
    -e RCLONE_CONFIG_SAFE_REMOTE="$remote" \
    -e RCLONE_CONFIG_SAFE_PASSWORD="$obscured" \
    $(env | grep -oE '^RCLONE_CONFIG_[A-Z0-9_]+' | grep -vE '^RCLONE_CONFIG_(MINIO|SAFE)_' | sed 's/^/-e /') \
    "$RCLONE_IMAGE" --config /dev/null --log-level ERROR "$@"
}
