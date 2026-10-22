# Luna Knowledge · Backend

Hệ thống lưu trữ tài liệu và video nội bộ của Lunatech: chia theo workspace, soạn thảo real-time, xem video HLS (chỉ xem, không tải).

- Đặc tả: [../docs/SPEC.md](../docs/SPEC.md)
- Kế hoạch: [../docs/PLAN.md](../docs/PLAN.md)

Mọi lệnh bên dưới chạy trong thư mục `backend/`.

## Cấu trúc

```
apps/
  api/        NestJS REST API          → http://localhost:4000 (Swagger: /api/docs)
  worker/     BullMQ worker            (transcode, preview, index…)
  collab/     Hocuspocus WebSocket     → ws://localhost:4001
packages/
  db/         Prisma schema, migration, seed, PrismaClient
  shared/     Env schema (zod), hằng số, S3 helpers
  tsconfig/   tsconfig dùng chung
scripts/      Script vận hành (infra:init, admin:grant…)
tests/        File .http test từng nhóm API (httpYac, có assertion)
docker/       docker-compose cho môi trường dev
```

## Yêu cầu

- Node.js ≥ 22.12, pnpm 9
- Docker + Docker Compose

## Chạy môi trường dev

```bash
pnpm install
cp .env.example .env          # sửa nếu cần
pnpm infra:up                 # Postgres, Redis, MinIO, Meilisearch, Tika, Gotenberg
pnpm infra:init               # tạo bucket S3 (chạy lại nhiều lần vẫn an toàn)
pnpm db:migrate               # áp migration
pnpm db:seed                  # admin@lunatech.vn + 2 workspace mẫu
pnpm admin:grant <email>      # cấp quyền System Admin cho email @lunatech.vn của bạn
pnpm upload <file> [--ws slug] [--parent folderId] [--replace nodeId]
                              # upload từ dòng lệnh đúng luồng multipart của trình duyệt (dev)
pnpm dev                      # tự bật hạ tầng (nếu đang tắt) rồi chạy api + worker + collab
```

Các container hạ tầng có `restart: unless-stopped` nên tự chạy lại sau khi khởi động lại máy. Nếu API trả `503 SERVICE_UNAVAILABLE`, nghĩa là Postgres/Redis/MinIO chưa chạy: dùng `pnpm infra:up` và kiểm tra `curl localhost:4000/health` (trường `details` cho biết dịch vụ nào đang down).

Kiểm tra: `curl localhost:4000/health` phải trả `database`, `redis`, `storage` đều `up`.

| Dịch vụ                    | Địa chỉ                                        |
| -------------------------- | ---------------------------------------------- |
| API / Swagger              | http://localhost:4000/api/docs                 |
| Thử đăng nhập Google (dev) | http://localhost:4000/dev/login                |
| Collab health              | http://localhost:4001/health                   |
| MinIO console              | http://localhost:9001 (user/pass trong `.env`) |
| Meilisearch                | http://localhost:7700                          |
| Prisma Studio              | `pnpm db:studio`                               |

## Kiểm thử

```bash
pnpm lint
pnpm typecheck
pnpm test        # unit test (Vitest)
pnpm test:e2e    # e2e; tự dựng Postgres/Redis/MinIO bằng Testcontainers (cần Docker)
pnpm test:http   # chạy các file tests/*.http (httpYac) với API dev đang chạy, xem tests/README.md
pnpm test:flows  # chạy tests/flows.http: các luồng nghiệp vụ chính từ đầu tới cuối, dùng để trình bày API
```

## Docker image

```bash
docker build --target api -t luna-api .      # hoặc worker | collab
```

## Ghi chú

- **MinIO**: MinIO đã ngừng phát hành image chính thức, nên môi trường dev dùng bản fork `pgsty/minio` (cùng mã nguồn, có version cố định). Code chỉ dùng S3 API, nên có thể đổi sang RustFS, Garage, R2… mà không phải sửa code. Lựa chọn cho production sẽ chốt ở Phase 7.
- Cổng mặc định 4000/4001 để tránh trùng với các app Next.js hay chạy ở 3000/3001.

## Backup và khôi phục

File gốc chỉ nằm trên MinIO nên backup là bắt buộc (SPEC §5.6). Đặt trong `.env`:

```bash
BACKUP_DEST=/mnt/luna-backup   # ổ ngoài, hoặc remote rclone (vd. b2:luna-backup + RCLONE_CONFIG_B2_*)
BACKUP_PASSWORD=...            # mã hoá kho backup; mất mật khẩu là mất backup, cất ngoài máy chủ
BACKUP_KEEP_DAYS=30
```

```bash
pnpm backup                                    # dump Postgres + bucket originals, assets (mã hoá, rclone trong Docker)
pnpm restore list                              # các bản dump, lần backup thành công gần nhất
pnpm restore db latest <DATABASE_URL đích>     # khôi phục vào DB trống; trùng DB đang chạy thì cần --force
pnpm restore files <endpoint> <key> <secret>   # chép file gốc về một MinIO/S3
```

Lịch chạy trên máy chủ (cron): `30 2 * * * cd /opt/luna/backend && pnpm backup >> /var/log/luna-backup.log 2>&1`.
Preview, thumbnail, HLS không backup; sau khi khôi phục tạo lại bằng `POST /files/:id/regenerate`.
Nên thử khôi phục định kỳ vào máy khác để chắc backup dùng được.
