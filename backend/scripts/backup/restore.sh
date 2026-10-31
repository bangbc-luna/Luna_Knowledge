#!/usr/bin/env bash
# Khôi phục từ kho backup. Mặc định KHÔNG ghi vào DB/MinIO đang chạy: phải chỉ rõ đích.
#   restore.sh list                                   xem các bản dump
#   restore.sh db <luna-…dump|latest> <DATABASE_URL đích> [--force]
#   restore.sh files <S3 endpoint đích> <access key> <secret key> [tiền tố bucket, mặc định luna-]
# DB đích phải trống (vd. container Postgres mới); --force cho phép ghi đè DB có dữ liệu.
source "$(dirname "$0")/common.sh"
load_env
require BACKUP_DEST BACKUP_PASSWORD

cmd="${1:-}"
case "$cmd" in
  list)
    rclone_run lsf "safe:db"
    echo "Lần backup thành công gần nhất: $(rclone_run cat safe:last-success.txt 2>/dev/null || echo '—')"
    ;;
  db)
    dump="${2:?Thiếu tên bản dump (hoặc latest)}"
    target="${3:?Thiếu DATABASE_URL đích}"
    [[ "$dump" == latest ]] && dump="$(rclone_run lsf "safe:db" | sort | tail -1)"
    running="$(pg_url "${DATABASE_MIGRATE_URL:-$DATABASE_URL}")"
    if [[ ( "$(pg_url "$target")" == "$running" || "$(pg_url "$target")" == "$(pg_url "${DATABASE_URL:-}")" ) && "${4:-}" != --force ]]; then
      echo "Đích trùng DB đang chạy. Thêm --force nếu thật sự muốn ghi đè." >&2; exit 1
    fi
    echo "Khôi phục $dump → $(pg_url "$target" | sed -E 's#://([^:]+):[^@]+@#://\1:***@#')"
    owner="$(sed -E 's#^[a-z]+://([^:@/]+).*#\1#' <<<"$running")"
    docker run --rm -i --network host "$PG_IMAGE" psql -q -v ON_ERROR_STOP=1 -v owner="$owner" -d "$(pg_url "$target")" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', r) FROM unnest(ARRAY['luna_app', :'owner']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
SQL
    rclone_run cat "safe:db/$dump" \
      | docker run --rm -i --network host "$PG_IMAGE" pg_restore --no-owner --clean --if-exists --exit-on-error -d "$(pg_url "$target")"
    echo "Xong."
    ;;
  files)
    RCLONE_S3_ENDPOINT="${2:?Thiếu endpoint đích}" RCLONE_S3_ACCESS_KEY="${3:?Thiếu access key}" RCLONE_S3_SECRET_KEY="${4:?Thiếu secret key}"
    export RCLONE_S3_ENDPOINT RCLONE_S3_ACCESS_KEY RCLONE_S3_SECRET_KEY
    prefix="${5:-luna-}"
    for name in originals assets; do
      echo "Khôi phục buckets/$name → $prefix$name"
      rclone_run mkdir "minio:$prefix$name"
      if ! rclone_run lsf "safe:buckets/$name" --max-depth 1 >/dev/null 2>&1; then
        echo "  (chưa có bản backup nào cho $name, bỏ qua)"; continue
      fi
      rclone_run copy "safe:buckets/$name" "minio:$prefix$name" --transfers 4 --stats-one-line --stats 0
    done
    echo "Xong. Preview/thumbnail tạo lại bằng POST /files/:id/regenerate."
    ;;
  *)
    sed -n '2,7p' "$0"; exit 1
    ;;
esac
