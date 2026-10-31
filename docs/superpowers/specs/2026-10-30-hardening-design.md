# Gia cố Luna Knowledge: chịu tải, DB, bảo mật, kiến trúc

> Ngày: 2026-10-30 · Trạng thái: chờ duyệt · Tham chiếu: [SPEC.md](../../SPEC.md), [PLAN.md](../../PLAN.md), [DEPLOY.md](../../DEPLOY.md)

## 1. Vì sao làm

Hệ thống chạy trên **một server on-prem** (Docker Compose, Traefik, cloudflared), dưới 200 người dùng. Mục tiêu của chủ dự án: **server phải ổn định trong khung giờ đông người truy cập** (cả công ty xem cùng một video đào tạo, nhiều người mở và soạn tài liệu, upload hàng loạt). Không có kế hoạch chạy nhiều server.

Đợt rà soát ngày 2026-10-30 (4 mảng: kiến trúc, DB, chịu tải, bảo mật) kết luận nền tảng tốt: phân quyền gom một chỗ (`packages/db/src/access.ts`), schema nhất quán, không có lỗ hổng Critical/High. Tài liệu này gom các việc cần làm, chia **3 đợt theo thứ tự đã chốt**.

## 2. Mục tiêu, không làm, phản mục tiêu

**Mục tiêu**
- Giờ cao điểm trên prod compose (qua Traefik): ~150 người xem video + ~30 người soạn tài liệu + 1 transcode chạy cùng lúc, **0 lỗi 429/5xx do hệ thống**, API p95 < 300 ms, collab p95 < 50 ms, segment video p95 < 300 ms.
- **Chưa có server thật** (chủ dự án, 2026-10-30). Bài test chạy trên máy dev với prod compose, giả định server 8 core / 32 GB; kết quả là tham khảo. Khi có server, chạy lại cùng kịch bản (k6 trên một máy khác trong LAN) và chỉnh `cpus`/`mem_limit` theo cấu hình thật.
- Người xem lúc đông **cả trong LAN lẫn ở xa qua cloudflared** (chủ dự án). Cả hai đường đều phải không bị 429; với người ở xa, giới hạn thực tế là đường upload văn phòng (DEPLOY.md §6), nên cần hạ chất lượng mặc định cho họ thay vì chỉ trông vào server.
- Không mất dữ liệu do race trên cây thư mục.
- Biết được khi hệ thống sắp quá tải (dashboard + cảnh báo).

**Không làm**
- Chạy nhiều server, Kubernetes, tách DB ra máy riêng, pgbouncer.
- DRM thương mại, burn watermark vào video (ghi nhận ở mục 6).
- Partition `audit_logs` theo tháng (thay bằng dọn theo lô + BRIN, đủ cho quy mô này).

**Phản mục tiêu** (làm xong mà dính những điều này là thất bại)
- Đổi hành vi phân quyền hoặc API mà FE đang dùng mà không có test bảo vệ.
- Nới bảo vệ video (cho phép tải) để chữa lỗi rate limit.
- Đợt 3 (tái cấu trúc) làm hỏng test e2e hiện có hoặc thay đổi response API.

## 3. Ràng buộc

- Code không có comment (quy ước của dự án).
- Next.js 16 và Turborepo có thay đổi lớn so với kiến thức chung; đọc docs trong `node_modules` trước khi sửa cấu hình (xem `AGENTS.md`).
- Mọi thay đổi schema đi qua migration Prisma; migration phải chạy được trên DB đang có dữ liệu.
- Mỗi đợt kết thúc với: lint, typecheck, unit, e2e, `pnpm test:http` đều xanh.

## 4. Đợt 1: Ổn định giờ cao điểm

| # | Việc | Bằng chứng | Hướng sửa |
|---|---|---|---|
| 1.1 | HLS bị tính vào rate limit ẩn danh 120/phút theo IP; qua cloudflared mọi người chung một IP | `videos.controller.ts` (4 route `@Public()`), `auth.module.ts:26-29`, `throttle.guard.ts:13` | Bỏ throttle chung cho playlist/segment/key (đã có phiên `s` và giới hạn 30 key/phiên); tracker theo user của phiên playback nếu cần giới hạn. Cấu hình Traefik `forwardedHeaders.trustedIPs` cho cloudflared hoặc dùng `Cf-Connecting-IP` để `req.ip` đúng |
| 1.2 | Không giới hạn CPU/RAM cho container; ffmpeg dùng hết CPU | `docker-compose.prod.yml` (không có `cpus`/`mem_limit`), `ffmpeg.ts:199` | `cpus`/`mem_limit` cho worker, tika, gotenberg, meilisearch, redis; ffmpeg `-threads` + `nice`; Tika `-Xmx`; `MEILI_MAX_INDEXING_MEMORY/THREADS`; Redis `maxmemory`. Con số cụ thể theo cấu hình server thật (xem mục 7) |
| 1.3 | Không timeout DB pool / keep-alive | `packages/db/src/index.ts:13` | `connectionTimeoutMillis`, `statement_timeout`, `idle_in_transaction_session_timeout`; `server.keepAliveTimeout`/`headersTimeout` lớn hơn idle timeout của Traefik; Traefik `readTimeout` đủ cho part upload 16 MB ở mạng chậm |
| 1.4 | Import .docx đọc cả file vào RAM API (tối đa 500 MB) | `documents.service.ts:260-306` | Giới hạn kích thước đầu vào cho convert (khoảng 20 MB) và kiểm tra tổng dung lượng giải nén; nếu vượt thì báo lỗi rõ ràng |
| 1.5 | Collab đẩy job index mỗi lần lưu, không chống trùng | `apps/collab/src/server.ts:310` | `jobId` theo node + delay để gộp |
| 1.6 | Rich-text doc tải luôn CodeMirror + KaTeX | `document-page.tsx:34` → `latex-workspace.tsx` | `next/dynamic` cho LatexWorkspace |
| 1.7 | Có `/metrics` nhưng không ai thu thập | `metrics.service.ts` | Prometheus + Grafana + node-exporter/cAdvisor dưới compose profile `monitoring`; cảnh báo: p95, tỉ lệ 429/5xx, event-loop lag, độ dài queue, CPU/RAM/NIC host. Healthcheck cho worker, `stop_grace_period` |
| 1.8 | Băng thông: 200 người xem 1080p ≈ 1 Gbps trong LAN; người ở xa bị giới hạn bởi uplink văn phòng | DEPLOY.md §6 | hls.js `capLevelToPlayerSize: true`; người truy cập qua cloudflared (nhận biết bằng header của tunnel) mặc định trần 720p, vẫn tự chọn được; ghi khuyến nghị NIC và uplink vào DEPLOY.md |
| 1.9 | Load test cũ không còn đúng (chạy trước khi có rate limit, chạy trên dev) | PLAN.md:132 | Kịch bản k6 hỗn hợp chạy qua Traefik trên prod compose: ~150 người xem (một phần giả lập đi qua tunnel: chung một IP nguồn, có header của cloudflared) + ~30 người soạn + 1 transcode; ghi kết quả vào PLAN.md, kèm ghi chú là đo trên máy dev |

**Xong đợt 1 khi:** bài test 1.9 đạt các ngưỡng ở mục 2 trên máy dev. Việc đo lại trên server thật ghi thành một mục mở trong PLAN.md.

## 5. Đợt 2: DB và bảo mật

### 5.1 DB

| # | Việc | Hướng sửa |
|---|---|---|
| 2.1 | **Race trên cây** (Critical): di chuyển/tạo vào folder đang bị xoá → mục sống nằm dưới cha đã xoá → bị xoá vĩnh viễn khi dọn; hai lần di chuyển chéo → vòng lặp | Advisory lock theo workspace trong transaction move/trash/restore/create (trash chạy trong transaction). Trigger tính path (`content_tree/migration.sql:161-177`) đọc cha `FOR SHARE` và `RAISE` nếu cha đã xoá, không phải FOLDER, khác workspace/section. Có test e2e tái hiện race |
| 2.2 | Index `audit_logs` không khớp truy vấn | `(target_id, id DESC)`, `(workspace_id, id DESC)`, `(actor_id, id DESC)`, `(action, id DESC)`, BRIN `created_at`; bỏ 3 index `created_at` cũ |
| 2.3 | FK không có index (cascade chậm) | `favorites.node_id`, `recent_views.node_id`, `video_watch_progress.node_id`, `upload_sessions.node_id`, `file_versions.{original,preview,thumbnail}_blob_id`, `nodes(workspace_id)`, `nodes(deleted_root_id) WHERE NOT NULL` thay index ghép cũ |
| 2.4 | Thiếu FK | `videos.{hls,poster,sprite}_blob_id`, `videos.version_id`, `documents.last_edited_by`, `document_versions.restored_from_id` |
| 2.5 | Đảm bảo blob GC an toàn | Unique `blobs(provider, container, key)` |
| 2.6 | Trùng số phiên bản file | Khoá node `FOR UPDATE` trước `MAX(version_no)+1` (`file-process.processor.ts:172-181`) |
| 2.7 | Không dọn dữ liệu cũ | Job định kỳ: `audit_logs` > 1 năm (theo lô); thông báo đã đọc > 90 ngày; phiên bản tự lưu cũ hơn **30 ngày** chỉ giữ 1 bản/ngày (bản người dùng lưu tay giữ nguyên); `recent_views` giữ 50/người; workspace xoá mềm quá **30 ngày** thì xoá hẳn cùng blob. Hai mốc 30 ngày là env, mặc định 30 (chủ dự án chốt). Xoá audit log đi qua hàm `SECURITY DEFINER` để không xung đột với 2.17 (người làm chọn). `restored_from_id` để `ON DELETE SET NULL` khi phiên bản cũ bị dọn |
| 2.8 | Index thông báo không khớp | `(user_id, id DESC)` + partial `(user_id) WHERE read_at IS NULL` |
| 2.9 | Ràng buộc nhỏ | `nodes.path NOT NULL`, `comments.mentions NOT NULL`, CHECK số không âm, `RESOLVED ⇔ resolved_at`; restore lấy `siblingKeys` trong transaction; dọn node UPLOADING khi tạo multipart lỗi |

### 5.2 Bảo mật

| # | Mức | Việc | Hướng sửa |
|---|---|---|---|
| 2.10 | M | App dùng root MinIO, S3 mở ra internet | User MinIO riêng với policy chỉ trên các bucket của app; root chỉ dùng cho `infra:init`; Traefik chỉ cho GET/PUT/HEAD trên media host |
| 2.11 | M | FE không có CSP, frame-ancestors, nosniff, HSTS | Header trong Next `headers()` (hoặc middleware Traefik): CSP chặt, `frame-ancestors 'none'`, nosniff, HSTS, Referrer-Policy |
| 2.12 | M | Tika/Gotenberg chung mạng với Redis/Postgres (SSRF) | Mạng riêng chỉ worker vào được, không ra internet; Redis `requirepass`; pin version Tika |
| 2.13 | L | Logout không đóng collab/SSE/phiên playback | Phát `accessChanged({userId})` khi logout/thu hồi phiên; gắn sessionId vào phiên `pb:` |
| 2.14 | L | `/metrics`, `/internal/*` của collab lộ qua Traefik | Bắt buộc `METRICS_TOKEN` ở production; chặn các path này ở Traefik |
| 2.15 | L | Sanitizer HTML phiên bản tài liệu kiểu blocklist | DOMPurify |
| 2.16 | L | Token playback lọt vào access log | Bỏ query string khỏi access log Traefik |
| 2.17 | L | Audit log append-only chỉ bằng trigger, app là owner | Role DB riêng cho app (không phải owner), REVOKE UPDATE/DELETE/TRUNCATE trên `audit_logs`, trigger `BEFORE TRUNCATE` |
| 2.18 | L | Vệ sinh hạ tầng | Image migrate không chạy root; ffmpeg `-protocol_whitelist file`; CSV escape `\t`/`\r` |

**Xong đợt 2 khi:** test e2e mới cho race 2.1, test quyền DB của app role, kiểm tra header bằng request thật, và mọi test cũ xanh.

## 6. Ghi nhận: giới hạn bảo vệ video

HLS chỉ ngăn tải trực tiếp, không ngăn được người có quyền xem dùng công cụ (yt-dlp) với chính phiên của mình; watermark là lớp phủ trên player, không nằm trong video. Đúng với SPEC §3.4 ("mục tiêu là chặn tải trực tiếp và truy vết"). Không thay đổi trong đợt này.

## 7. Đợt 3: Tái cấu trúc kiến trúc

Không đổi hành vi, không đổi response API. Mỗi việc là một thay đổi riêng, test e2e hiện có là lưới an toàn.

| # | Việc | Hướng |
|---|---|---|
| 3.1 | Logic tạo mục lặp ở 4 nơi, đã lệch (`documents.service.ts:385` thiếu `section`) | Module `NodeTree` sâu: `create(user, {workspaceId, parentId, section, type, name, autoRename?, extra})` và `placeAt(nodeId, parentId, {autoRename})` gom kiểm tra container, chuẩn hoá tên, xử lý trùng, audit, index; dùng ở nodes, documents, uploads, trash restore. Kết hợp với lock của 2.1 |
| 3.2 | Payload queue không có kiểu chung; collab dùng chuỗi `'index-node'` | Map `JobPayloads` trong `@luna/shared` + hàm enqueue dùng chung; processor switch có kiểu |
| 3.3 | Collab tự ghi audit, tên action là chuỗi tự do | Hàm ghi audit + union `AuditAction` trong `packages/db`; API `AuditService` chỉ thêm request context |
| 3.4 | Seam `BlobStorage` chỉ có một adapter và bị bỏ qua bằng `s3.send` trực tiếp | Bỏ abstraction provider, coi S3 API là interface (MinIO/R2/S3 đều nói S3); một `ObjectStore` dùng chung cho api và worker |
| 3.5 | Kiểu dữ liệu FE chép tay (`frontend/src/lib/types.ts`) | Sinh kiểu từ OpenAPI sẵn có (`openapi-typescript`); gom lời gọi API theo domain như `lib/documents.ts` |
| 3.6 | Nhỏ | `requireNode(..., {types})` thay 3 hàm bọc; helper `mapUnique`; tách `DocumentAssets`, `HlsSession`; gộp kiểm tra `users.status` vào `accessColumns` |

Giữ nguyên (đã tốt): `ContentAccessService` + `access.ts`, schema env dùng chung, `CollabClient`, `GoogleIdentityProvider` với fake, cách test e2e qua HTTP.

## 8. Để lại cho người làm

- Con số `cpus`/`mem_limit` cụ thể: chưa có server, giả định 8 core / 32 GB và ghi rõ trong DEPLOY.md.
- Media host (2.10) vẫn cho OPTIONS để CORS preflight hoạt động.
- Chọn Traefik middleware hay Next `headers()` cho security header.
- Chi tiết dashboard Grafana.
- Thứ tự việc trong cùng một đợt.
