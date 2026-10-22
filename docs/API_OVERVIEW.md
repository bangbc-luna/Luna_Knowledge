# Luna Knowledge API: tổng quan

Tài liệu cho người tích hợp với API (frontend, công cụ nội bộ) và cho buổi trình bày hệ thống. Chi tiết từng endpoint xem Swagger; tài liệu này giải thích các luồng nghiệp vụ và cách các thành phần phối hợp.

| Tài liệu | Ở đâu |
|---|---|
| Swagger UI | `http://localhost:4000/api/docs` (dev); production bật bằng `SWAGGER_ENABLED=true` |
| OpenAPI JSON | `/api/docs-json`, nhập được vào Postman, Bruno, Insomnia |
| Bộ request theo luồng | `backend/tests/flows.http`, chạy `pnpm test:flows` |
| Bộ kiểm thử đầy đủ | `backend/tests/[0-9]*.http`, chạy `pnpm test:http` |
| Đặc tả | `docs/SPEC.md` |

## 1. Thành phần

```mermaid
flowchart LR
  B[Trình duyệt] -->|HTTPS| T[Traefik]
  T --> FE[Frontend Next.js]
  T -->|/api| API[API NestJS]
  T -->|/collab wss| C[Collab Hocuspocus]
  T -->|media.*| S3[(MinIO)]
  API --> PG[(PostgreSQL)]
  API --> R[(Redis)]
  API --> MS[(Meilisearch)]
  API --> S3
  C --> PG
  C --> R
  R -->|BullMQ| W[Worker]
  W --> PG
  W --> S3
  W --> MS
  W --> TK[Tika]
  W --> GB[Gotenberg]
```

- **API**: mọi nghiệp vụ, kiểm quyền, ghi nhật ký. Không giữ file lớn: upload và tải video đi thẳng giữa trình duyệt và MinIO qua URL ký sẵn.
- **Collab**: đồng bộ tài liệu soạn thảo theo thời gian thực (Yjs), tự lưu và tạo phiên bản.
- **Worker**: việc nặng chạy nền: trích chữ (Tika), tạo preview PDF (Gotenberg), thumbnail, transcode video HLS, đánh chỉ mục tìm kiếm.

## 2. Quy ước chung

- Base URL `/api/v1`. ID là UUID, thời gian là ISO 8601 UTC.
- Xác thực: `Authorization: Bearer <accessToken>`.
- Lỗi luôn có dạng `{ "error": { "code", "message", "details?", "requestId" } }`. Khi báo lỗi, gửi kèm `requestId` (cũng có ở header `x-request-id`).

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body/query sai; `details` liệt kê từng trường |
| 401 | `UNAUTHENTICATED`, `SESSION_EXPIRED` | Thiếu token, token hết hạn, phiên bị thu hồi |
| 403 | `FORBIDDEN` | Thấy được mục nhưng không đủ quyền thao tác |
| 404 | `NOT_FOUND` | Không tồn tại, đã xoá, **hoặc không có quyền xem** (không lộ sự tồn tại) |
| 409 | `CONFLICT` | Trùng tên trong cùng thư mục, trùng slug |
| 413 | `TOO_LARGE` | Body > 512 KB, file vượt giới hạn |
| 415 | `UNSUPPORTED_TYPE` | Đuôi file không được phép |
| 429 | `RATE_LIMITED` | Vượt 600 request/phút (người dùng) hoặc 120/phút (IP chưa đăng nhập); xem `Retry-After` |

- Phân trang: gửi `limit` và `cursor`, nhận `{ items, nextCursor }`. Hết dữ liệu khi `nextCursor` là `null`.
- Xoá là xoá mềm: mục vào thùng rác cùng cả nhánh, khôi phục được cho tới khi quản trị dọn.

## 3. Phân quyền

Mỗi tài khoản `@lunatech.vn` tự động là **VIEWER** của workspace công ty *LunaTech* ngay lần đăng nhập đầu. Nội dung công ty do System Admin và những người được giao vai trò MEMBER/ADMIN đăng. Ai cũng tạo được workspace nhóm và là ADMIN của nó.

```mermaid
flowchart LR
  subgraph Vai trò workspace
    A[ADMIN] --> O[OWNER]
    M[MEMBER] --> E[EDITOR]
    V[VIEWER] --> VV[VIEWER]
  end
  subgraph Share từng mục
    SE[Được chỉnh sửa] --> O
    SV[Chỉ xem] --> VV
  end
  O & E & VV --> R{{Quyền thực tế = mức cao nhất}}
```

| Quyền nội dung | Được làm |
|---|---|
| VIEWER | Xem, tải, comment, tìm kiếm |
| EDITOR | + tạo, sửa, upload, di chuyển, xoá vào thùng rác, tạo tag |
| OWNER | + share, xem hoạt động, xoá vĩnh viễn, sửa/xoá tag, quản lý thành viên |

Workspace luôn phải còn ít nhất một ADMIN. Mọi thao tác thay đổi đều ghi `audit_logs`; System Admin xem và xuất CSV ở `/admin/audit-logs`.

## 4. Đăng nhập

```mermaid
sequenceDiagram
  autonumber
  participant B as Trình duyệt
  participant API
  participant G as Google
  B->>API: GET /auth/google
  API-->>B: 302 tới Google, cookie state
  B->>G: Đăng nhập tài khoản công ty
  G-->>B: 302 /auth/google/callback?code=...
  B->>API: GET /auth/google/callback
  API->>G: Đổi code lấy id_token, kiểm tra domain lunatech.vn
  API->>API: Tạo user nếu mới, thêm vào workspace công ty (VIEWER)
  API-->>B: 302 về frontend, cookie luna_rt (HttpOnly)
  B->>API: POST /auth/refresh (cookie)
  API-->>B: { accessToken } 15 phút, cookie mới
  Note over B,API: Khi gặp 401 SESSION_EXPIRED: gọi refresh rồi thử lại.<br/>Phiên hết sau 60 phút không hoạt động hoặc 12 giờ.
```

Refresh token xoay vòng mỗi lần dùng; dùng lại token cũ sẽ thu hồi cả phiên (chống đánh cắp cookie). Lỗi đăng nhập trả về frontend qua `?error=` (`DOMAIN_NOT_ALLOWED`, `ACCOUNT_DISABLED`…).

## 5. Upload file

```mermaid
sequenceDiagram
  autonumber
  participant B as Trình duyệt
  participant API
  participant S3 as MinIO
  participant W as Worker
  B->>API: POST /workspaces/{ws}/uploads {fileName, size, mime, parentId}
  API->>S3: Tạo multipart upload
  API-->>B: { uploadId, nodeId, partSize 16 MB, parts[{partNumber, url}] }
  loop Mỗi part (song song)
    B->>S3: PUT url (ký sẵn 1 giờ)
  end
  B->>API: POST /uploads/{id}/complete
  API->>S3: Ghép các part
  API-->>B: { status: COMPLETED }
  API->>W: Job xử lý file
  B->>API: GET /nodes/{nodeId}/events (SSE)
  W->>S3: Đọc file gốc
  W->>W: Trích chữ (Tika), preview (Gotenberg), thumbnail
  W->>API: Trạng thái READY (qua Redis)
  API-->>B: event: status {status: READY}
```

- Rớt mạng giữa chừng: `GET /uploads/{id}` trả các part đã nhận, `GET /uploads/{id}/parts` lấy URL mới cho phần còn thiếu. Upload chưa hoàn tất bị huỷ sau 24 giờ.
- Tải phiên bản mới cho file có sẵn: gửi `replaceNodeId` thay vì `parentId`.
- Tải về: `GET /files/{id}/download` (stream qua API, có ghi nhật ký) hoặc `POST /files/{id}/download-link` lấy link dùng một lần trong 60 giây.

## 6. Xem video

Video được transcode sang HLS nhiều bậc chất lượng, mã hoá AES-128. File gốc chỉ System Admin tải được.

```mermaid
sequenceDiagram
  autonumber
  participant P as Trình phát (hls.js)
  participant API
  participant S3 as MinIO
  P->>API: POST /videos/{id}/playback (Bearer)
  API-->>P: { token, masterUrl, watermark, resumeAt }
  P->>API: GET masterUrl (?s=token)
  API-->>P: Master playlist các bậc 360p/720p/1080p
  P->>API: GET /hls/{bậc}/index.m3u8?s=token
  API-->>P: Media playlist, khoá trỏ về /key
  P->>API: GET /videos/{id}/key?s=token
  API-->>P: 16 byte khoá (tối đa 30 lần mỗi phiên)
  loop Mỗi segment
    P->>API: GET /hls/{bậc}/seg_N.ts?s=token
    API-->>P: 302 URL ký sẵn 2 phút
    P->>S3: Tải segment
  end
  P->>API: PUT /videos/{id}/progress {positionSec}
```

Phiên xem hết hạn sau 15 phút không dùng, tối đa 8 giờ. Watermark (email người xem) hiển thị chồng lên video.

## 7. Soạn tài liệu cùng nhau

```mermaid
sequenceDiagram
  autonumber
  participant B as Trình soạn thảo (Tiptap)
  participant API
  participant C as Collab
  participant DB as PostgreSQL
  B->>API: GET /documents/{id}
  API-->>B: Nội dung JSON, hiện ngay
  B->>API: GET /documents/{id}/collab-token
  API-->>B: { url, documentName, token 5 phút, readOnly }
  B->>C: WebSocket, gửi token
  C->>C: Kiểm token, tính lại quyền (VIEWER → chỉ đọc)
  C->>DB: Nạp trạng thái Yjs
  C-->>B: Đồng bộ
  loop Khi gõ
    B->>C: Cập nhật Yjs
    C-->>B: Phát cho người khác cùng mở
  end
  C->>DB: Lưu định kỳ, tạo phiên bản tự động khi đổi người sửa hoặc đủ thời gian
  C->>C: Job đánh chỉ mục tìm kiếm
```

- Phiên bản: `POST /documents/{id}/versions` lưu bản có tên; `GET .../versions/{vid}/diff` so sánh theo từ; `POST .../restore` khôi phục (collab đẩy nội dung cũ tới mọi người đang mở).
- Comment: `POST /documents/{id}/threads` với `mentions` để @nhắc; người được nhắc nhận thông báo.
- Ảnh nhúng: `POST /documents/{id}/assets`. Xuất: `GET /documents/{id}/export?format=html|md`. Import Word: `POST /files/{id}/convert-to-document`.

## 8. Tìm kiếm

```mermaid
sequenceDiagram
  autonumber
  participant B as Trình duyệt
  participant API
  participant MS as Meilisearch
  participant W as Worker
  Note over API,W: Mỗi lần tạo/sửa/di chuyển/share/xoá: API đẩy job index-node hoặc index-tree
  W->>MS: Cập nhật tài liệu: tên, tag, nội dung, chữ trích từ file, danh sách người được xem
  B->>API: GET /search?q=quy trinh&workspaceId=...
  API->>MS: Truy vấn kèm bộ lọc quyền của người hỏi
  MS-->>API: Kết quả + vị trí khớp
  API->>API: Kiểm lại quyền từng mục, cắt đoạn trích quanh chỗ khớp
  API-->>B: { items[{node, name[], snippet[]}], total, nextCursor }
```

Gõ không dấu vẫn tìm được có dấu ("quy trinh" khớp "Quy trình"); kết quả trả về các đoạn `{text, match}` để tô sáng. Chỉ mục được dựng lại lúc 03:30 hằng đêm, hoặc System Admin gọi `POST /admin/search/reindex`.

## 9. Chia sẻ và thông báo

```mermaid
sequenceDiagram
  autonumber
  participant A as Quản trị workspace
  participant API
  participant R as Redis
  participant U as Người được share
  A->>API: POST /nodes/{id}/shares {email, role: VIEWER|EDITOR}
  API->>API: Tạo user nếu chưa từng đăng nhập, ghi share và nhật ký
  API->>R: Phát thông báo share.added
  R-->>API: (mọi instance API)
  API-->>U: SSE /me/notifications/stream: event notification
  U->>API: GET /shared-with-me
  API-->>U: Mục được share, quyền áp dụng cho cả nhánh con
```

Các loại thông báo: `share.added`, `comment.new`, `comment.mention`, `video.ready`, `video.failed`. Danh sách ở `GET /me/notifications`, đánh dấu đã đọc bằng `POST /me/notifications/read`.

## 10. Vận hành

- `GET /health` (Postgres, Redis, MinIO) và `GET /health/live` cho Docker/Traefik.
- `/metrics` (Prometheus) ở API, collab và worker; chỉ mở trong mạng nội bộ hoặc kèm `METRICS_TOKEN`.
- Kết quả tải thử: 200 người dùng đồng thời, thao tác thường p95 49 ms, tìm kiếm p95 62 ms; 20 người cùng sửa một tài liệu, độ trễ đồng bộ p95 2 ms.
- Triển khai, backup, khôi phục: `docs/DEPLOY.md`.
