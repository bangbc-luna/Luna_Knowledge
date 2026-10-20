# Luna Knowledge — Kế hoạch thực hiện (PLAN)

> Tham chiếu: [SPEC.md](SPEC.md) · Thứ tự: **Backend API trước → demo/trình bày API → Frontend**

Nguyên tắc làm việc:

- Mỗi phase kết thúc bằng một **mốc demo**: API chạy được, có test e2e và hiển thị trên Swagger UI.
- Chuẩn bị sẵn **Postman/Bruno collection** để trình bày từng phase mà không cần FE.
- Phase sau chỉ bắt đầu khi phase trước đạt Definition of Done (DoD).

---

## Phase 0 — Khung dự án và hạ tầng dev ✅ (2026-10-13)

**Việc cần làm**

- [x] Monorepo pnpm + Turborepo: `apps/api`, `apps/collab`, `apps/worker`, `packages/db` (Prisma), `packages/shared` (env zod, hằng số, S3), `packages/tsconfig`, `scripts/`. Lint bằng oxlint.
- [x] `docker/docker-compose.dev.yml`: postgres 16, redis 7, MinIO (fork `pgsty/minio`, xem ghi chú), meilisearch, tika, gotenberg. Bucket tạo bằng `pnpm infra:init` qua S3 API, kèm lifecycle tự xóa bucket tmp sau 2 ngày.
- [x] NestJS 12 API: config validate bằng zod, logger pino + `x-request-id`, filter lỗi chuẩn `{ error: { code, message, details?, requestId } }`, `ZodValidationPipe`, Swagger `/api/docs`, `/health` (DB, Redis, mọi bucket) và `/health/live`.
- [x] Prisma 7: schema khởi tạo (`users`, `sessions`, `refresh_tokens`, `workspaces`, `workspace_members`, `audit_logs`), migration `init` có bật `ltree`, seed (admin + 2 user demo + 2 workspace).
- [x] Worker: NestJS standalone + BullMQ 6, queue `system` với job `ping`.
- [x] Collab: Hocuspocus 4, có `/health`, mặc định **từ chối mọi kết nối** cho tới khi làm xác thực ở Phase 5.
- [x] Test: Vitest + Supertest + Testcontainers (Postgres, Redis, MinIO). Hiện có 8 unit test và 9 e2e test. (Helper sinh JWT test chuyển sang Phase 1, khi có auth.)
- [x] Dockerfile multi-stage (target `api` | `worker` | `collab`) + GitHub Actions (lint, build, typecheck, unit, e2e, build image).

**DoD:** `pnpm dev` chạy được cả 3 app; `/health` báo database, redis, storage đều up; lint, typecheck và mọi test đều xanh ở máy local. CI chưa chạy vì repo chưa có remote GitHub.

**Ghi chú phát sinh**

- NestJS 12 chỉ hỗ trợ ESM và mặc định dùng Vitest, nên test dùng Vitest thay cho Jest như trong bản plan đầu.
- MinIO đã ngừng phát hành Docker image chính thức. Dev dùng bản fork `pgsty/minio`. Code chỉ gọi S3 API nên đổi server khác được mà không sửa code; chọn server cho production ở Phase 7 (MinIO fork, RustFS hoặc Garage).
- Cổng mặc định: API 4000, collab 4001, để tránh trùng với các app Next.js hay chạy ở 3000/3001.

---

## Phase 1 — Xác thực, user, workspace ✅ code xong (2026-10-13) · ⏳ chờ thử đăng nhập Google thật

**Việc cần làm**

- [x] Google OIDC bằng `openid-client` v6: PKCE S256 + state (lưu Redis, dùng một lần, gắn cookie SameSite=Lax) + nonce; `prompt=select_account`; chỉ nhận tài khoản có cả đuôi email lẫn claim `hd` thuộc `ALLOWED_GOOGLE_DOMAINS`; email phải verified; tự tạo user lần đầu.
  - [x] OAuth client (Internal) đã tạo cho dev, redirect `http://localhost:4000/api/v1/auth/google/callback`.
  - [ ] Thêm redirect URI cho `knowledge.lunatech.vn` khi triển khai (Phase 7).
- [x] Access JWT (HS256, 15 phút) + refresh token xoay vòng (DB lưu SHA-256) trong session cookie `luna_rt` (httpOnly, SameSite=Strict, Path=/api/v1/auth, không có hạn → đóng trình duyệt là mất). Dùng lại token đã xoay (ngoài grace 10 giây cho nhiều tab) → thu hồi cả phiên.
- [x] Idle timeout 60 phút (tính theo request thật, refresh không tính) và absolute timeout 12 giờ → `401 SESSION_EXPIRED` kèm `reason`.
- [x] `AuthGuard` toàn cục (mặc định bắt buộc đăng nhập, `@Public()` để mở), `@CurrentUser()`, `@SystemAdmin()`.
- [x] `/me`, `/users?q=`, `/admin/users` (phân trang cursor), khóa/mở khóa user (khóa → thu hồi mọi phiên ngay), cấp/gỡ System Admin (không áp dụng cho chính mình).
- [x] CRUD workspace (xóa mềm, giải phóng slug), thành viên (thêm theo email, tạo trước user chưa từng đăng nhập), chuyển owner.
- [x] `AuditService`: ghi thẳng vào DB (thay vì qua hàng đợi như dự kiến: lượng log nhỏ, dễ kiểm thử). Ghi các sự kiện login/login_failed/logout/session_revoked, user.update, workspace.*.
- [x] `pnpm admin:grant <email>`: cấp System Admin từ dòng lệnh.
- [x] Trang thử `/dev/login` (chỉ ở development) để đăng nhập Google và lấy access token dán vào Swagger khi chưa có FE.

**DoD:** 52 e2e test xanh, gồm: user ngoài domain hoặc sai `hd` bị từ chối, state giả mạo hoặc phát lại bị từ chối, PKCE được kiểm tra, idle/absolute timeout, refresh token reuse thu hồi cả phiên, hai tab refresh cùng lúc không bị coi là tấn công, ADMIN không tự nâng lên OWNER, khóa user thu hồi phiên ngay. Còn lại: thử đăng nhập Google thật trên trình duyệt.

**Quyết định phát sinh**

- System Admin có quyền quản trị (sửa, xóa, quản lý thành viên) mọi workspace kể cả khi không phải thành viên. Quyền xem nội dung của System Admin sẽ chốt ở Phase 2.
- Người được thêm vào workspace trước khi đăng nhập lần nào sẽ được tạo sẵn tài khoản theo email, tên lấy từ phần trước `@`. Khi đăng nhập Google lần đầu, tên và ảnh thật sẽ được cập nhật.

**Demo 1:** mở `http://localhost:4000/dev/login` → đăng nhập Google → copy access token → Swagger `Authorize` → tạo workspace, thêm thành viên.

---

## Phase 2 — Cây nội dung, phân quyền, share, thùng rác ✅ (2026-10-14)

**Việc cần làm**

- [x] Bảng `nodes` với đường dẫn `ltree`. **Trigger trong PostgreSQL** tự tính `path` khi tạo và khi đổi `parent_id`, rồi cập nhật cả cây con bằng một câu lệnh. App không ghi `path`, nên cây không thể bị lệch.
- [x] Chặn trùng tên trong cùng folder bằng partial unique index (bỏ qua mục trong thùng rác), so trùng không phân biệt hoa thường và chuẩn hóa NFC. Trùng tên → 409 kèm `details.suggestion` ("Tên (1)", giữ đuôi file).
- [x] Tạo folder, liệt kê (folder trước, sắp theo tên/ngày, phân trang, lọc loại), chi tiết, đổi tên, di chuyển (khóa dòng + kiểm tra vòng lặp), breadcrumb.
- [x] **Permission engine** `ContentAccessService`: quyền = max(vai trò workspace, share trên node hoặc tổ tiên), tính bằng một truy vấn dùng GiST index. Không xem được → 404, thiếu quyền → 403.
- [x] Share CRUD (chỉ ADMIN/OWNER workspace), share cho người ngoài workspace theo email, danh sách share trực tiếp + kế thừa, `/shared-with-me`. Người chỉ có share không thấy gốc workspace và breadcrumb chỉ bắt đầu từ folder được share.
- [x] Thùng rác: xóa cả nhánh (EDITOR chỉ xóa mục mình tạo), khôi phục theo mục gốc của mỗi lần xóa (về gốc nếu cha đã bị xóa, tự đổi tên nếu trùng; EDITOR chỉ khôi phục mục mình xóa), xóa vĩnh viễn và dọn sạch (OWNER).
- [x] Job `purge-trash` trong worker: hằng ngày 03:00 (Asia/Ho_Chi_Minh), xóa mục quá 30 ngày.
- [x] Tag (EDITOR tạo, ADMIN sửa/xóa, gán theo danh sách), yêu thích, mở gần đây (ghi khi mở tài liệu/file/video, không ghi với folder). Các danh sách chỉ trả mục user còn quyền xem.
- [x] File test `tests/05…08-*.http`.

**DoD:** 84 e2e test (32 test mới cho Phase 2) và 158 request trong `pnpm test:http` đều xanh.

**Quyết định / thay đổi so với plan**

- System Admin **không** tự có quyền xem nội dung workspace; muốn xem phải là thành viên (chốt 2026-10-14).
- Permission engine đặt trong API (chưa tách sang `packages/shared`); collab server ở Phase 5 sẽ dùng lại qua package chung khi cần.
- Chưa cache quyền trong Redis: một truy vấn dùng index ~1 ms là đủ ở quy mô <200 user, và tránh rủi ro quyền bị cache sai sau khi thu hồi share. Sẽ thêm nếu đo thấy chậm.
- SSE `/nodes/:id/events` dời sang Phase 3, vì chỉ có ý nghĩa khi có xử lý file/video.
- Xóa vĩnh viễn hiện chỉ xóa dữ liệu trong DB; dọn file trên MinIO được thêm ở Phase 3.

---

## Phase 3 — Lớp lưu trữ, upload, file tài liệu

**Việc cần làm**

- [x] SSE `/nodes/:id/events` (chuyển từ Phase 2): trạng thái xử lý qua Redis pub/sub, ping 25 giây.
- [x] Interface `BlobStorage` + `S3BlobStorage` (AWS SDK v3, `forcePathStyle` cho MinIO, file lớn tự chia multipart).
- [~] ~~`GoogleDriveStorage`~~: bỏ (2026-10-20). Tổ chức chặn tạo key service account (`iam.managed.disableServiceAccountKeyCreation`); file gốc lưu ở bucket MinIO `luna-originals`, bù lại bằng backup ngoài server (Phase 8).
- [x] Upload multipart (SPEC §7.7): init, presign các part, resume, complete, abort; job dọn upload bỏ dở quá 24 giờ (mỗi giờ).
- [x] Worker `file-process`: sniff MIME (`file-type`), sha256, lưu file gốc, preview (Gotenberg cho Office, `sharp` cho ảnh), trích text bằng Tika.
- [x] API files: chi tiết, preview, thumbnail, download (stream qua API + audit `file.download`), link tải dùng một lần, phiên bản và khôi phục.
- [x] Dọn object khi xóa vĩnh viễn/purge: trigger `blobs_enqueue_gc` ghi vào `blob_gc`, job maintenance xóa object (ngay sau khi xóa và mỗi 10 phút).
- [x] Thống kê dung lượng theo workspace (`GET /workspaces/:wsId/storage`).
- [x] Tạo lại preview/thumbnail/chữ trích từ file gốc (`POST /files/:id/regenerate`). HLS thêm ở Phase 4.
- [x] CLI `pnpm upload <file>`, `tests/10-uploads.http`, e2e API (multipart + resume) và e2e worker (Gotenberg/Tika thật).

**DoD:** e2e upload file 1 GB chia part, mô phỏng mất kết nối rồi resume; DOCX/XLSX/PPTX có preview PDF; file `.exe` đổi đuôi thành `.pdf` bị từ chối.

- Đã kiểm: CLI upload 1 GB (65 part) lên stack dev; e2e mất kết nối sau part 1 rồi tải tiếp; DOCX/XLSX ra preview PDF; `.exe` đổi đuôi bị từ chối và mục chuyển FAILED.

**Demo 3:** upload PDF/DOCX/XLSX bằng script CLI nhỏ (`scripts/upload.ts`), xem preview và tải về, kiểm tra file nằm trong bucket `luna-originals`.

---

## Phase 4 — Video pipeline và phát bảo vệ

**Việc cần làm**

- [ ] Worker `video-transcode` (hàng đợi riêng, concurrency cấu hình được):
  - ffprobe, chọn ladder 360/720/1080 theo độ phân giải nguồn;
  - FFmpeg → HLS fMP4 hoặc TS, segment 6 giây, AES-128 (sinh key + keyinfo);
  - poster, sprite + WebVTT thumbnails;
  - báo tiến độ (parse `out_time_ms`) qua Redis pub/sub;
  - upload HLS lên S3, dọn tmp; retry tối đa 3 lần.
- [ ] Mã hóa AES key bằng master key (AES-256-GCM, lấy từ env/KMS).
- [ ] API playback: sinh playback token, viết lại master/media playlist (presign từng segment), endpoint cấp key có rate limit, poster/sprite, progress, retranscode.
- [ ] Chặn download: không có route nào trả file gốc video; với S3 đặt `Content-Disposition: inline`, cấu hình CORS chỉ cho origin của FE.
- [ ] Trang thử player tối giản (`apps/api/static/player-test.html` dùng hls.js) chỉ dùng để demo trong phase này, chưa phải FE.

**DoD:** video 1 giờ 1080p transcode thành công; phát được qua hls.js; token hết hạn thì không lấy được key; user không có quyền nhận 404; test tải 50 phiên xem đồng thời (k6).

**Demo 4:** upload video, theo dõi tiến độ qua SSE, phát trên trang thử, chứng minh copy URL segment sang trình duyệt khác sau 10 phút thì không dùng được.

---

## Phase 5 — Tài liệu soạn thảo và collaboration

**Việc cần làm**

- [ ] `apps/collab` (Hocuspocus v4):
  - `onAuthenticate` dùng collab token + permission engine, VIEWER chỉ đọc;
  - extension Database (persist `yjs_state`), debounce 2 giây, maxDebounce 10 giây;
  - `onStoreDocument`: chuyển sang JSON/HTML/text bằng `@tiptap/html` + schema Tiptap headless dùng chung trong `packages/shared/editor-schema`, rồi enqueue job index;
  - auto-version khi không còn kết nối hoặc sau mỗi 30 phút;
  - extension Redis (để scale), ngắt kết nối khi quyền bị thu hồi.
- [ ] API documents: tạo, metadata, collab-token, export HTML/Markdown, upload asset.
- [ ] Phiên bản: liệt kê, tạo có tên, xem, diff (so sánh trên JSON/text), khôi phục (gọi collab server qua Redis để áp transaction Yjs).
- [ ] Comments: thread, reply, resolve, mention → notification.
- [ ] Import DOCX → Document (`mammoth` → HTML → Tiptap JSON → Yjs).
- [ ] Notifications + SSE stream.

**DoD:** test 2 client Yjs (Node, `@hocuspocus/provider`) sửa đồng thời rồi hội tụ cùng nội dung; restart collab server không mất dữ liệu; khôi phục phiên bản khi đang có người sửa vẫn đúng.

**Demo 5:** script mô phỏng 2 người cùng gõ; tạo, xem và khôi phục phiên bản; comment và mention sinh notification.

---

## Phase 6 — Tìm kiếm

**Việc cần làm**

- [ ] Index Meilisearch `nodes`: cấu hình searchable (name, contentText, tags), filterable (workspaceId, type, tagIds, createdBy, updatedAt, acl), highlight.
- [ ] Hỗ trợ tiếng Việt không dấu: lưu thêm trường đã bỏ dấu (`name_ascii`, `content_ascii`), và chuẩn hóa query trước khi tìm.
- [ ] Indexer worker: lắng nghe sự kiện tạo/sửa/xóa node, tài liệu cập nhật, text trích xong, quyền thay đổi (cập nhật acl cho cây con).
- [ ] API `/search` dùng filter `acl IN [ws:…, user:…]` và hậu kiểm quyền.
- [ ] Job reindex toàn bộ + reconcile hằng đêm.

**DoD:** tìm "bao cao" ra "Báo cáo"; user không có quyền không thấy kết quả; đổi share thì kết quả tìm kiếm cập nhật trong < 5 giây.

**Demo 6:** tìm kiếm xuyên PDF, DOCX và document soạn thảo, có lọc tag/workspace.

---

## Phase 7 — Hoàn thiện backend và trình bày API

**Việc cần làm**

- [ ] Rate limit (`@nestjs/throttler` + Redis), Helmet, kiểm tra CORS, giới hạn body.
- [ ] Audit log: API xem/lọc/xuất CSV; partition bảng theo tháng.
- [ ] Observability: metrics Prometheus, Sentry, dashboard cơ bản (Grafana, tùy chọn).
- [ ] Backup: `pg_dump`/WAL-G cho Postgres, versioning cho bucket; tài liệu khôi phục.
- [ ] Load test (k6): CRUD, search, video, collab theo NFR-1..3.
- [ ] Security review: OWASP checklist, test IDOR toàn bộ endpoint bằng ma trận quyền tự động.
- [ ] `docker-compose.prod.yml` cho server văn phòng: Traefik + Let's Encrypt DNS-01, MinIO có hostname riêng, `cloudflared` cho truy cập từ xa (Cloudflare Access tùy chọn); đo băng thông upload văn phòng khi xem video từ xa; hướng dẫn split DNS, UPS/RAID, backup hằng đêm có mã hóa ra ngoài server: Postgres + bucket `originals` + `assets` (restic/rclone tới ổ ngoài và kho S3 cloud), kèm hướng dẫn thử khôi phục (`docs/DEPLOY.md`).
- [ ] **Bộ trình bày API**: Swagger hoàn chỉnh (mô tả + ví dụ), Postman/Bruno collection theo từng luồng nghiệp vụ, `docs/API_OVERVIEW.md` tóm tắt luồng chính kèm sequence diagram.

**DoD:** toàn bộ e2e xanh; load test đạt NFR; đã review xong bộ trình bày API với bạn → **chốt contract API (v1)** làm cơ sở cho FE.

---

## Phase 8 — Frontend (bản đầu) ✅ (2026-10-17)

Dựng bằng Next.js 16 trong `frontend/`, giao diện theo skill `evon:ui-ux` (brief → wireframe → dựng).

- [x] **Khu tài liệu** (phương án A + E, bỏ dải nhật ký API): đăng nhập (Google + đăng nhập nhanh ở dev), thư mục (tạo, đổi tên, di chuyển, chia sẻ, gắn tag, xoá, yêu thích, lọc, sắp xếp), thành viên, thùng rác, tag, được chia sẻ, yêu thích, gần đây. Thao tác hiện theo vai trò.
- [x] **Khu quản trị `/admin`** (phương án A, chỉ System Admin): tổng quan (số liệu + biểu đồ 7 ngày + hoạt động gần đây), người dùng (khoá/mở khoá, cấp/gỡ admin), nhật ký hoạt động (lọc theo người, hành động, workspace, thời gian; bộ lọc trên URL; panel chi tiết; xuất CSV), workspace (tạo, xem thành viên, xoá).
- [x] Backend bổ sung: ghi lượt xem mục (chống trùng 5 phút), `GET /admin/audit-logs`, `/admin/audit-logs/export`, `/admin/stats`, chủ sở hữu trong danh sách workspace. 88 e2e test; `tests/09-admin.http`.
- [x] Responsive: desktop, iPad ngang (1024), iPad dọc (768), điện thoại (375). Kịch bản Playwright chạy app thật qua mọi luồng chính, không lỗi console, không cuộn ngang; `next build` sạch.

Còn lại cho frontend (làm cùng các phase sau): trình xem tài liệu/video, upload (Phase 3–4), editor Tiptap (Phase 5), tìm kiếm (Phase 6).

---

## Phụ lục — Cấu trúc thư mục dự kiến

```
Luna_Knowledge/
├── apps/
│   ├── api/            # NestJS REST API
│   │   └── src/modules/{auth,users,workspaces,nodes,shares,trash,uploads,
│   │                    files,videos,documents,comments,search,tags,
│   │                    notifications,audit,admin}
│   ├── collab/         # Hocuspocus server
│   └── worker/         # BullMQ processors: file-process, video-transcode,
│                       # index, purge, version, reconcile
├── packages/
│   ├── shared/         # prisma, permissions, editor-schema, dto, constants
│   └── config/
├── docker/             # compose dev/prod, nginx, init scripts
├── scripts/            # upload CLI, collab simulator, seed
└── docs/               # SPEC.md, PLAN.md, API_OVERVIEW.md, DEPLOY.md
```
