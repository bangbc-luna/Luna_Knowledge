#!/usr/bin/env bash
# Backup hằng đêm (SPEC §5.6): dump Postgres + bucket originals, assets → BACKUP_DEST, mã hoá bằng BACKUP_PASSWORD.
#   pnpm backup            (hoặc: bash scripts/backup/backup.sh)
# Lịch chạy: cron/systemd trên máy chủ, ví dụ `30 2 * * * cd /opt/luna/backend && pnpm backup >> /var/log/luna-backup.log 2>&1`
#
# Bố cục trong kho (tên tệp được mã hoá, nhìn từ ngoài không đọc được):
#   db/luna-<thời điểm>.dump      pg_dump -Fc, giữ BACKUP_KEEP_DAYS ngày
#   buckets/originals, assets     bản đồng bộ mới nhất
#   history/<thời điểm>/…         tệp bị xoá/ghi đè ở lần đồng bộ đó, giữ BACKUP_KEEP_DAYS ngày
# preview/thumbnail/hls không backup: tạo lại được từ file gốc.
source "$(dirname "$0")/common.sh"
load_env
require DATABASE_URL S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET_ORIGINALS S3_BUCKET_ASSETS BACKUP_DEST BACKUP_PASSWORD
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
log() { echo "[$(date '+%F %T')] $*"; }

log "Backup $STAMP → $BACKUP_DEST"

log "Dump Postgres"
docker run --rm --network host "$PG_IMAGE" pg_dump --format=custom --no-owner "$(pg_url "$DATABASE_URL")" \
  | rclone_run rcat "safe:db/luna-$STAMP.dump"

# Thư mục trong kho mang tên cố định (originals, assets), không theo tên bucket: restore.sh tìm đúng
# dù bucket ở máy khác đặt tên khác.
for pair in "originals:$S3_BUCKET_ORIGINALS" "assets:$S3_BUCKET_ASSETS"; do
  name="${pair%%:*}" bucket="${pair#*:}"
  log "Đồng bộ bucket $bucket"
  rclone_run mkdir "safe:buckets/$name"
  rclone_run sync "minio:$bucket" "safe:buckets/$name" --backup-dir "safe:history/$STAMP/$name" --transfers 4 --stats-one-line --stats 0
done

log "Dọn bản cũ hơn $KEEP_DAYS ngày"
rclone_run delete --min-age "${KEEP_DAYS}d" "safe:db"
rclone_run delete --min-age "${KEEP_DAYS}d" "safe:history" --rmdirs 2>/dev/null || true

echo "$STAMP" | rclone_run rcat "safe:last-success.txt"
log "Xong. Các bản dump hiện có:"
rclone_run lsf "safe:db"
