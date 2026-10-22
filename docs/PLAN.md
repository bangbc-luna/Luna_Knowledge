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

- [x] Worker `video-transcode` (hàng đợi riêng, `VIDEO_TRANSCODE_CONCURRENCY`):
  - ffprobe (tính cả video quay dọc), chọn bậc 360/720/1080 theo cạnh ngắn, không phóng to vượt nguồn;
  - FFmpeg → HLS TS, segment 6 giây, khung khoá đúng mỗi 6 giây, AES-128 (khoá + IV ngẫu nhiên mỗi lần transcode);
  - poster, thumbnail 320px (hiện trong danh sách thư mục), sprite + WebVTT;
  - tiến độ (`out_time_us`) qua SSE `/nodes/:id/events` (`progress` 0–100);
  - upload HLS lên bucket `hls`, thay bản cũ (blob cũ vào GC, xoá cả thư mục); retry 3 lần, video hỏng → FAILED kèm lý do, không thử lại.
  - Encoder: `libx264` mặc định; `h264_nvenc` qua `VIDEO_ENCODER` (cần GPU NVIDIA).
- [x] Mã hóa AES key bằng `VIDEO_MASTER_KEY` (AES-256-GCM).
- [x] API: phiên xem (Redis), viết lại master/media playlist, segment chuyển hướng URL ký 2 phút, khoá có giới hạn và kiểm lại quyền, poster/sprite, progress, lượt xem, retranscode; khôi phục phiên bản video thì transcode lại.
- [x] Chặn download: không có route nào trả file gốc video cho người dùng; System Admin lấy qua `/admin/videos/:id/original-link` (nút ở trang quản trị, FE làm sau), có nhật ký.
- [x] Trang thử player `/dev/player?id=` (chỉ ở dev, hls.js, watermark tên + email + giờ).
- [x] Frontend: trình phát hls.js trên trang tệp (watermark tên + email + giờ, xem tiếp, chọn chất lượng, dải ảnh xem trước khi tua, toàn màn hình giữ watermark), tiến độ transcode qua SSE, transcode lại khi lỗi; trang `/admin/videos` có nút tải file gốc (xác nhận, ghi nhật ký).
- [x] Tests: e2e worker transcode thật bằng ffmpeg (giải mã segment bằng khoá trong DB), e2e API 9 ca bảo vệ, `tests/11-videos.http`, k6 `tests/load/playback.js`.

**DoD:** video 1 giờ 1080p transcode thành công; phát được qua hls.js; token hết hạn thì không lấy được key; user không có quyền nhận 404; test tải 50 phiên xem đồng thời (k6).

- Đã kiểm trên máy dev (i7-11800H, mốc tối thiểu): video **1 giờ 1080p transcode 18,5 phút** (0,31× thời lượng, CPU libx264, đạt NFR-2 ≤ 1,5×), HLS 1,37 GB, tua tới phút 50 phát ngay; video 2 phút 1080p upload + transcode 44 giây; phát qua hls.js tự lên 1080p; 50 phiên k6: 0 lỗi / 2201 request, 3,9 GB, API p95 424 ms, segment p95 95 ms; URL segment hết hạn sau 2 phút (200 → 403).

**Demo 4:** upload video, theo dõi tiến độ qua SSE, phát trên trang thử, chứng minh copy URL segment sang trình duyệt khác sau 10 phút thì không dùng được.

---

## Phase 5 — Tài liệu soạn thảo và collaboration

**Việc cần làm**

- [x] `packages/editor`: schema Tiptap headless dùng chung cho collab, API và FE sau này (heading, list, checklist, bảng, quote, code block, link, ảnh có `assetId`, gạch chân, highlight/màu chữ, mark comment `data-thread-id`); chuyển đổi Yjs ↔ JSON ↔ HTML/Markdown/text, đếm từ.
- [x] `apps/collab` (Hocuspocus v4):
  - `onAuthenticate`: collab token (JWT HS256 5 phút, `aud=luna-collab`), quyền luôn tính lại từ DB, VIEWER chỉ đọc;
  - lưu `yjs_state`, debounce 2 giây, maxDebounce 10 giây; mỗi lần lưu cập nhật JSON, chữ, số từ, người sửa cuối và đẩy job index;
  - phiên bản tự động khi không còn ai kết nối hoặc sau mỗi 30 phút sửa (`COLLAB_AUTO_VERSION_MIN`);
  - API publish `collab:access` khi đổi/xoá thành viên, đổi/gỡ share, khoá tài khoản, di chuyển/xoá mục; collab kiểm lại từng kết nối (đóng hoặc chuyển chỉ đọc);
  - endpoint nội bộ `snapshot`/`replace` (header `x-internal-secret`) để API lấy nội dung mới nhất và khôi phục phiên bản ngay trên tài liệu đang mở.
- [ ] Extension Redis của Hocuspocus để chạy nhiều instance (chưa cần với một server).
- [x] API documents: tạo, metadata, collab-token, export HTML/Markdown (có nhật ký), ảnh nhúng ≤ 20 MB (kiểm loại thật, bucket `assets`, URL ký mới mỗi lần đọc).
- [x] Phiên bản: liệt kê, tạo có tên, xem (JSON + HTML), diff theo từ (với phiên bản khác hoặc bản hiện tại), khôi phục tạo phiên bản mới "Khôi phục từ phiên bản N".
- [x] Comments: thread, reply (tự mở lại nếu đã resolve), sửa (tác giả), xoá (tác giả hoặc ADMIN), resolve/reopen (EDITOR hoặc người tạo); @mention chỉ nhận người xem được tài liệu, người khác trả về `ignoredMentions`.
- [x] Import DOCX → Document cùng thư mục (`mammoth` → HTML → Tiptap JSON → Yjs, ảnh vào bucket `assets`).
- [x] Notifications trong app + SSE `/me/notifications/stream`: `comment.mention`, `comment.new`, `share.added`, `video.ready`, `video.failed`.
- [x] Tests: e2e collab 8 ca (2 client hội tụ, VIEWER chỉ đọc, restart không mất dữ liệu, khôi phục khi đang sửa, thu hồi quyền, phiên bản tự động), e2e API 10 ca, worker kiểm thông báo video, `tests/12-documents.http`.
- [x] Frontend (qua skill `evon:ui-ux`): trang tài liệu `/w/:ws/doc/:id` với Tiptap + Hocuspocus (con trỏ và avatar người đang mở, trạng thái lưu/mất kết nối, chỉ xem cho VIEWER), thanh định dạng, menu nổi khi bôi chữ, ảnh nhúng (chọn, dán, kéo thả), link; khung bình luận (lề phải từ 1280px, sheet ở màn nhỏ) có @mention; lịch sử phiên bản (so với hiện tại, xem nội dung, khôi phục, lưu có tên); chuông thông báo SSE; nút Tài liệu mới trong thư mục, Chuyển thành tài liệu trên file .docx; xuất HTML/Markdown.

**DoD:** test 2 client Yjs (Node, `@hocuspocus/provider`) sửa đồng thời rồi hội tụ cùng nội dung; restart collab server không mất dữ liệu; khôi phục phiên bản khi đang có người sửa vẫn đúng.

**Demo 5:** script mô phỏng 2 người cùng gõ; tạo, xem và khôi phục phiên bản; comment và mention sinh notification.

---

## Đổi mô hình quyền và bố cục (2026-10-21)

- [x] Workspace chỉ còn vai trò Thành viên; System Admin thêm/gỡ thành viên (trang `/admin/workspaces`). Quyền trên mục: thành viên `EDITOR`, người tạo hoặc share "Được chỉnh sửa" `OWNER` (xoá, chia sẻ), share "Chỉ xem" `VIEWER` (SPEC §3.2).
- [x] Hai khu Tài liệu / Video (`nodes.section`), migration chuyển video cũ về khu Video.
- [x] Log hoạt động của mục (`GET /nodes/:id/activity`), tự lưu phiên bản khi người sửa đổi sang người khác, số từ thêm/bớt trên mỗi phiên bản.
- [x] Workspace chung `lunatech`: người mới tự vào làm thành viên; màn hướng dẫn cho người chưa thuộc workspace nào.
- [x] Frontend: sidebar (tên workspace, Tài liệu, Video, Được chia sẻ, Yêu thích, Gần đây, Thùng rác), cột thành viên bật/tắt bên phải, gắn và tạo tag trong menu của mục, sheet Hoạt động, menu "…" trên trang tệp.

---

## Mô hình kho công ty + workspace nhóm (2026-10-22)

- [x] `workspaces.kind` COMPANY/TEAM; vai trò ADMIN/MEMBER/VIEWER; mọi tài khoản là VIEWER của kho công ty (tự thêm khi đăng nhập, không gỡ được); ai cũng tạo workspace nhóm và là quản trị; thành viên xoá được (có log); quản trị khôi phục, xoá vĩnh viễn, quản lý tag và thành viên; luôn còn ít nhất một quản trị.
- [x] Frontend: chọn workspace chia nhóm Công ty / Workspace của tôi kèm vai trò, Tạo workspace, Cài đặt workspace; cột thành viên có mời, đổi vai trò, gỡ, rời; ẩn thao tác ghi với người chỉ xem.
- [x] Nội dung mẫu trong kho LunaTech (quy định, biểu mẫu, hướng dẫn, video đào tạo) trên dev.

---

## Phase 6 — Tìm kiếm

**Việc cần làm**

- [x] Index Meilisearch `nodes`: searchable `nameAscii`, `tagsAscii`, `contentAscii` (nội dung tài liệu soạn thảo hoặc chữ trích từ file, tối đa 100 000 ký tự); filterable `workspaceId`, `section`, `type`, `tagIds`, `createdById`, `updatedAt`, `acl`.
- [x] Tiếng Việt không dấu: mọi trường tìm được lưu dạng đã bỏ dấu, mỗi ký tự gốc ứng với đúng một ký tự ASCII, nên vị trí khớp ánh xạ ngược về văn bản có dấu để tô đậm; query cũng được bỏ dấu.
- [x] Indexer worker (`search-index`): `index-node`, `index-tree` (khi di chuyển, xoá, khôi phục, đổi share), `drop-workspace`; API và worker đẩy job ở mọi chỗ thay đổi tên, nội dung, tag, quyền; mục đang tải lên không được index.
- [x] API `GET /search`: filter `acl IN [ws:…, user:…]`, hậu kiểm quyền từng kết quả; trả tên tách đoạn khớp, đoạn trích có dấu, đường dẫn thư mục; lọc workspace, khu, loại, tag, người tạo, thời gian; phân trang.
- [x] Dựng lại toàn bộ hằng đêm 03:30 (index tạm rồi hoán đổi, dọn mục mồ côi), lúc khởi động nếu chỉ mục trống, và nút admin `POST /admin/search/reindex`.
- [x] Tests: unit bỏ dấu và tô đậm, e2e API 7 ca (indexer mô phỏng qua hàng đợi), e2e worker 4 ca với Meilisearch thật, `tests/13-search.http`.
- [x] Frontend: ô tìm nhanh trên thanh đầu trang (Ctrl+K hoặc `/`, gợi ý khi gõ, phạm vi workspace đang đứng hoặc mọi nơi), trang `/search` có chip loại, lọc workspace, thời gian, tag, người tạo, tô đậm chỗ khớp, đoạn trích, đường dẫn, xem thêm.

**DoD:** tìm "bao cao" ra "Báo cáo"; user không có quyền không thấy kết quả; đổi share thì kết quả tìm kiếm cập nhật trong < 5 giây.

**Demo 6:** tìm kiếm xuyên PDF, DOCX và document soạn thảo, có lọc tag/workspace.

---

## Phase 7 — Hoàn thiện backend và trình bày API

**Việc cần làm**

- [x] Rate limit (`@nestjs/throttler` + Redis) đếm theo người dùng đã đăng nhập (600/phút) hoặc theo IP khi chưa đăng nhập (120/phút) vì cả văn phòng chung một IP; Helmet; CORS chặn `*`; giới hạn body 512 KB (413/400 đúng định dạng lỗi); Swagger tắt ở production.
- [x] Audit log: API xem/lọc/xuất CSV (trang admin).
- [ ] Partition bảng `audit_logs` theo tháng (để sau, bảng còn nhỏ).
- [x] Observability: `/metrics` Prometheus ở API (thời gian request theo route, số lần bị rate limit), collab (tài liệu đang mở, kết nối), worker cổng 9464 (job theo hàng đợi và trạng thái); chỉ mạng nội bộ hoặc `METRICS_TOKEN`; Sentry bật khi có `SENTRY_DSN`. Dashboard Grafana: tuỳ chọn, chưa làm.
- [x] Backup: `pnpm backup` / `pnpm restore` (Postgres + bucket originals/assets, mã hoá rclone crypt).
- [x] Load test trên máy dev (i7-11800H, stack `pnpm dev`):
  - k6 `pnpm load:api`, 200 người dùng: CRUD p95 **49 ms**, tìm kiếm p95 **62 ms**, 0 lỗi. Lần đầu p95 1,4 giây vì pool DB của API chỉ 10 kết nối; nâng mặc định lên 30 (`DB_POOL_MAX`).
  - `pnpm load:collab`, 20 người cùng gõ 60 giây: 2 398 lần sửa tới đủ 19 người còn lại, hội tụ, độ trễ p95 **2 ms** (tối đa 16 ms).
  - Video 50 người xem cùng lúc: đã đo ở Phase 4.
- [x] Test IDOR bằng ma trận quyền tự động: 30 endpoint × 4 vai trò (quản trị, thành viên, share chỉ xem, người ngoài) + luồng xoá/khôi phục (`permissions-matrix.e2e-spec.ts`).
- [ ] Rà OWASP checklist còn lại (sau khi có bản deploy).
- [x] `backend/docker/docker-compose.prod.yml`: Traefik 3.6 (HTTPS Let's Encrypt DNS-01 qua Cloudflare, route frontend, `/api`, `/collab` WebSocket, `media.*` cho MinIO), bước `migrate` chạy migration và tạo bucket trước khi app lên, Postgres/MinIO chỉ mở `127.0.0.1` cho backup, `cloudflared` profile `remote`. Image: `backend/Dockerfile` (api, worker có ffmpeg, collab, migrate) và `frontend/Dockerfile` (Next standalone). Đã chạy thử nguyên stack trên máy dev: mọi dịch vụ healthy, frontend 200, API 401, MinIO 200, WebSocket collab 101, worker dựng chỉ mục. Hướng dẫn từng bước cho người trực: `docs/DEPLOY.md` (chuẩn bị server, split DNS, Google OAuth, secret, khởi chạy, tunnel, băng thông video từ xa, backup + thử khôi phục, nâng cấp, xử lý sự cố).
- [x] **Bộ trình bày API**: Swagger có mô tả tổng quan (xác thực, lỗi, phân trang, giới hạn, phân quyền), mô tả từng nhóm, schema lỗi chung và mã lỗi cho mọi endpoint, ví dụ request cho các thao tác chính, kiểu nội dung cho endpoint trả file/stream/playlist; `tests/flows.http` (`pnpm test:flows`) chạy các luồng nghiệp vụ từ đầu tới cuối, OpenAPI JSON nhập thẳng được vào Postman/Bruno; `docs/API_OVERVIEW.md` tóm tắt kiến trúc và các luồng chính kèm sequence diagram.

**DoD:** toàn bộ e2e xanh; load test đạt NFR; đã review xong bộ trình bày API với bạn → **chốt contract API (v1)** làm cơ sở cho FE.

---

## Phase 8 — Frontend (bản đầu) ✅ (2026-10-17)

Dựng bằng Next.js 16 trong `frontend/`, giao diện theo skill `evon:ui-ux` (brief → wireframe → dựng).

- [x] **Khu tài liệu** (phương án A + E, bỏ dải nhật ký API): đăng nhập (Google + đăng nhập nhanh ở dev), thư mục (tạo, đổi tên, di chuyển, chia sẻ, gắn tag, xoá, yêu thích, lọc, sắp xếp), thành viên, thùng rác, tag, được chia sẻ, yêu thích, gần đây. Thao tác hiện theo vai trò.
- [x] **Khu quản trị `/admin`** (phương án A, chỉ System Admin): tổng quan (số liệu + biểu đồ 7 ngày + hoạt động gần đây), người dùng (khoá/mở khoá, cấp/gỡ admin), nhật ký hoạt động (lọc theo người, hành động, workspace, thời gian; bộ lọc trên URL; panel chi tiết; xuất CSV), workspace (tạo, xem thành viên, xoá).
- [x] Backend bổ sung: ghi lượt xem mục (chống trùng 5 phút), `GET /admin/audit-logs`, `/admin/audit-logs/export`, `/admin/stats`, chủ sở hữu trong danh sách workspace. 88 e2e test; `tests/09-admin.http`.
- [x] Responsive: desktop, iPad ngang (1024), iPad dọc (768), điện thoại (375). Kịch bản Playwright chạy app thật qua mọi luồng chính, không lỗi console, không cuộn ngang; `next build` sạch.

Còn lại cho frontend (làm cùng các phase sau): tìm kiếm (Phase 6).

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
