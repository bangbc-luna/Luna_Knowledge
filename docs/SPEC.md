# Luna Knowledge — Đặc tả hệ thống (SPEC)

> Phiên bản: 0.1 · Ngày: 2026-10-13 · Phạm vi tài liệu: Backend API (FE làm sau khi BE hoàn thành)

## 1. Tổng quan

Luna Knowledge là hệ thống lưu trữ và chia sẻ tri thức nội bộ của công ty. Các team được chia theo **workspace**, cùng lưu trữ và dùng chung:

- **Tài liệu soạn thảo** (rich-text): soạn và sửa trực tiếp trên web, nhiều người sửa cùng lúc (real-time), có lịch sử phiên bản và comment.
- **File văn phòng** (Word, PDF, Excel, PowerPoint…): upload, xem trước trên web, tải về; riêng Word có thể import thành tài liệu soạn thảo được.
- **Video**: upload, tự động transcode sang HLS nhiều mức chất lượng, xem trực tiếp trên web. **Chỉ được xem, không được tải về** (video là tài sản công ty).

### 1.1 Bối cảnh và ràng buộc

| Hạng mục | Quyết định |
|---|---|
| Người dùng | Nội bộ 1 công ty, dưới 200 user |
| Đăng nhập | Google Workspace SSO, chỉ cho phép domain **`lunatech.vn`** |
| Editor | Tiptap (ProseMirror) + Yjs, server collab là Hocuspocus (tự host) |
| Lưu trữ | Toàn bộ trên **MinIO** tự host (S3 API): file gốc, HLS, preview, thumbnail, asset, file tạm. Sau này có thể đổi sang R2/S3 mà không phải sửa code. Không dùng Google Drive (quyết định 2026-10-20: tổ chức chặn tạo key service account) |
| Triển khai | **On-premise tại văn phòng**: 1 server chạy Docker Compose |
| Quota | Không giới hạn dung lượng theo workspace ở MVP (chỉ thống kê) |
| Tech stack | TypeScript toàn bộ: NestJS (API), Hocuspocus (collab), BullMQ worker, Next.js (FE, làm sau) |
| Thứ tự làm | Backend API trước → demo API → Frontend |

### 1.2 Ngoài phạm vi MVP

- Phụ đề / chapter video
- DRM thương mại cho video (Widevine/FairPlay)
- Multi-tenant (nhiều công ty)
- Ứng dụng mobile native
- Sửa trực tiếp file Excel/PowerPoint trên web (chỉ xem trước)

---

## 2. Thuật ngữ

| Thuật ngữ | Ý nghĩa |
|---|---|
| Workspace | Không gian của một team, chứa cây thư mục và nội dung |
| Node | Một phần tử trong cây: `FOLDER`, `DOCUMENT`, `FILE`, `VIDEO` |
| Document | Tài liệu soạn thảo bằng editor (nội dung lưu dạng Yjs) |
| File | File upload thông thường (PDF, DOCX, XLSX, ảnh…) |
| Share | Quyền cấp riêng trên một folder hoặc node cho một user |
| Effective role | Quyền thực tế của user trên một node, sau khi gộp quyền workspace và các share được kế thừa |

---

## 3. Vai trò và phân quyền

### 3.1 Vai trò hệ thống

- **System Admin**: quản lý user, tạo/xóa workspace, xem audit log toàn hệ thống, cấu hình. System Admin có quyền quản trị mọi workspace (sửa, xóa, quản lý thành viên) kể cả khi không phải thành viên, nhưng **không** tự có quyền xem nội dung: muốn xem tài liệu/video phải tự thêm mình làm thành viên (được ghi audit log).
- **User**: người dùng thông thường, được tự động tạo ở lần đăng nhập Google đầu tiên. Có thể được thêm vào workspace trước khi đăng nhập lần nào: hệ thống tạo sẵn tài khoản theo email công ty.

### 3.2 Vai trò trong workspace

| Quyền | OWNER | ADMIN | EDITOR | VIEWER |
|---|:-:|:-:|:-:|:-:|
| Xem nội dung, xem video, comment | ✓ | ✓ | ✓ | ✓ |
| Tải file tài liệu (không áp dụng cho video) | ✓ | ✓ | ✓ | ✓ |
| Tạo/sửa/di chuyển/upload | ✓ | ✓ | ✓ | |
| Xóa (vào thùng rác), khôi phục | ✓ | ✓ | ✓ (nội dung của mình) | |
| Share folder/node | ✓ | ✓ | | |
| Quản lý thành viên workspace | ✓ | ✓ | | |
| Xóa vĩnh viễn, đổi tên/xóa workspace, chuyển owner | ✓ | | | |

### 3.3 Share theo folder/node

- OWNER/ADMIN có thể cấp quyền `EDITOR` hoặc `VIEWER` trên một folder hay node cho **bất kỳ user nào trong công ty**, kể cả người không thuộc workspace.
- Quyền share **được kế thừa** xuống toàn bộ cây con.
- **Effective role** = quyền cao nhất trong các nguồn: (a) vai trò ở workspace, (b) các share trên node đó và trên các node tổ tiên.
- MVP chỉ cho phép share **cộng thêm quyền**, chưa hỗ trợ "folder hạn chế" (chặn bớt quyền). Tính năng này để ở bản sau.
- Người chỉ có share (không thuộc workspace) chỉ nhìn thấy các nhánh được share, qua mục "Được chia sẻ với tôi".

### 3.4 Quy tắc với video

- **Không có API tải video** cho bất kỳ vai trò nào, kể cả OWNER. File gốc chỉ System Admin truy cập được, qua công cụ quản trị, và mọi lượt truy cập đều ghi audit log.
- Các biện pháp bảo vệ: HLS mã hóa AES-128, khóa giải mã chỉ cấp qua API có xác thực, URL segment hết hạn ngắn, watermark động (email + thời gian) phủ lên player ở FE.
- Lưu ý: không biện pháp nào chặn được 100% việc quay màn hình. Mục tiêu là chặn tải trực tiếp và truy vết được người làm rò rỉ.

---

## 4. Yêu cầu chức năng

### 4.1 Xác thực (AUTH)

- AUTH-1: Đăng nhập bằng Google OAuth 2.0 / OIDC, chỉ chấp nhận email thuộc domain `lunatech.vn` (kiểm tra claim `hd` và đuôi email; danh sách domain để trong env `ALLOWED_GOOGLE_DOMAINS` để mở rộng sau).
- AUTH-2: Tự tạo user ở lần đăng nhập đầu tiên (lấy tên và avatar từ Google).
- AUTH-3: **Không ghi nhớ đăng nhập**: mỗi lần mở lại hệ thống (đóng trình duyệt rồi mở lại, hoặc hết phiên) đều phải đăng nhập lại bằng Google.
  - Access token JWT (15 phút) + refresh token rotate (lưu hash trong DB) đặt trong **session cookie** (httpOnly, Secure, SameSite=Strict, không có `Expires`/`Max-Age`), nên cookie bị xóa khi đóng trình duyệt.
  - Phiên hết hạn khi **không thao tác 60 phút** (idle timeout) hoặc **tối đa 12 giờ** kể từ lúc đăng nhập (absolute timeout), dù trình duyệt vẫn mở. Hai giá trị này cấu hình qua env.
  - Mỗi lần đăng nhập đều gửi `prompt=select_account` sang Google để người dùng chủ động chọn tài khoản `@lunatech.vn`, không tự động đăng nhập ngầm.
  - Việc Google có bắt nhập lại mật khẩu hay không do **Google Workspace** quyết định. Muốn bắt nhập mật khẩu/2FA thường xuyên hơn, admin đặt thời lượng phiên Google (Admin console → Security → Google session control) và bật xác minh 2 bước.
- AUTH-4: Đăng xuất thu hồi refresh token và đóng mọi kết nối collab/SSE của phiên đó. Admin có thể khóa (disable) user, và user bị khóa không refresh được token.

### 4.2 Workspace (WS)

- WS-1: System Admin tạo workspace và chỉ định OWNER.
- WS-2: OWNER/ADMIN thêm/xóa thành viên và đổi vai trò.
- WS-3: Liệt kê các workspace mà user là thành viên, kèm vai trò.
- WS-4: Thống kê dung lượng theo workspace (tổng file gốc, tổng HLS).

### 4.3 Cây nội dung (NODE)

- NODE-1: Tạo folder lồng nhau không giới hạn cấp.
- NODE-2: Liệt kê con của một folder, có phân trang, sắp xếp (tên, ngày sửa, kích thước) và lọc theo loại.
- NODE-3: Đổi tên, di chuyển trong cùng workspace (sang workspace khác: bản sau), sao chép (chỉ áp dụng cho document).
- NODE-4: Breadcrumb: trả về đường dẫn từ gốc tới node.
- NODE-5: Xóa mềm vào thùng rác. Khôi phục về vị trí cũ, hoặc về gốc nếu folder cha đã bị xóa.
- NODE-6: Job tự xóa vĩnh viễn các mục trong thùng rác quá 30 ngày, đồng thời dọn file trên MinIO.
- NODE-7: Tên node không được trùng trong cùng folder cha (không phân biệt hoa thường). API trả 409 kèm gợi ý tên mới.

### 4.4 Upload file (UPLOAD)

- UPLOAD-1: Upload resumable, chia nhiều phần (multipart), tối đa **10 GB cho video** và **500 MB cho file khác**.
- UPLOAD-2: Luồng xử lý: client xin phiên upload, nhận presigned URL cho từng part, upload thẳng lên S3 (bucket `tmp`) rồi gọi `complete`. Sau đó worker kiểm tra, lưu file gốc vào bucket `originals` và tạo bản xem trước.
- UPLOAD-3: Kiểm tra định dạng bằng magic bytes, không chỉ dựa vào đuôi file. Giới hạn MIME theo whitelist.
- UPLOAD-4: Tính checksum SHA-256 và lưu lại để phát hiện file trùng (chỉ cảnh báo, không chặn).
- UPLOAD-5: Trạng thái xử lý của node: `UPLOADING → PROCESSING → READY | FAILED`. Client theo dõi qua SSE hoặc polling.
- UPLOAD-6: Tải lên phiên bản mới cho một file: giữ lịch sử phiên bản file (tối đa 20 bản).

### 4.5 Xem và tải file tài liệu (FILE)

- FILE-1: PDF: trả URL stream có hạn ngắn, FE hiển thị bằng pdf.js.
- FILE-2: Word/Excel/PowerPoint: worker convert sang PDF (qua Gotenberg/LibreOffice) để xem trước và lưu bản PDF preview trên S3.
- FILE-3: Ảnh: tạo thumbnail và bản preview kích thước vừa.
- FILE-4: Tải file gốc: API stream từ MinIO qua backend (không lộ vị trí lưu trữ) và ghi audit log.
- FILE-5: Import `.docx` thành Document soạn thảo được (docx → HTML → Tiptap JSON → Yjs).

### 4.6 Video (VIDEO)

- VIDEO-1: Sau khi upload xong, worker dùng FFmpeg để:
  - đọc metadata (thời lượng, độ phân giải, codec);
  - transcode H.264/AAC sang HLS với các mức **360p, 720p, 1080p** (không upscale vượt độ phân giải gốc), segment 6 giây;
  - mã hóa AES-128, mỗi video một khóa riêng; khóa lưu trong DB (được mã hóa bằng master key);
  - tạo thumbnail (poster) và sprite ảnh xem trước khi rê thanh tua (seek preview);
  - upload HLS lên S3 (`hls/{videoId}/…`); file gốc đã nằm ở bucket `originals`; xóa file tạm.
- VIDEO-2: Báo tiến độ transcode (%) và cho phép retry khi thất bại (tối đa 3 lần tự động).
- VIDEO-3: API `playback` trả về: URL master playlist, đã ký, hết hạn 10 phút; playback token để lấy khóa; thông tin watermark.
- VIDEO-4: API cấp khóa AES: kiểm tra playback token và quyền của user, có rate limit.
- VIDEO-5: Ghi lại tiến độ xem (vị trí đang xem) để xem tiếp, và đếm lượt xem.
- VIDEO-6: Không có endpoint download. Header `Content-Disposition` không cho phép tải. Segment trên S3 để private, chỉ truy cập qua URL đã ký.

### 4.7 Tài liệu soạn thảo (DOC)

- DOC-1: Tạo document trống hoặc từ template (template: bản sau).
- DOC-2: Soạn thảo real-time qua WebSocket (Hocuspocus). Xác thực bằng access token; VIEWER được kết nối ở chế độ chỉ đọc.
- DOC-3: Hiển thị con trỏ và tên những người đang cùng sửa (awareness).
- DOC-4: Persist trạng thái Yjs vào PostgreSQL (debounce 2 giây, tối đa 10 giây). Mỗi lần persist cập nhật luôn bản snapshot JSON/HTML và plain text để tìm kiếm.
- DOC-5: Lịch sử phiên bản:
  - tự động tạo phiên bản khi phiên sửa kết thúc (không còn ai kết nối) hoặc sau mỗi 30 phút có thay đổi;
  - người dùng có thể tạo phiên bản có đặt tên;
  - xem nội dung một phiên bản, so sánh (diff) giữa 2 phiên bản, khôi phục một phiên bản (khôi phục tạo ra phiên bản mới, không ghi đè lịch sử).
- DOC-6: Comment:
  - comment gắn vào một đoạn văn bản (anchor dùng Yjs relative position, lưu dạng mark `commentId` trong tài liệu);
  - trả lời theo luồng (thread), resolve/reopen, sửa/xóa comment của chính mình;
  - @mention người dùng, tạo notification.
- DOC-7: Upload ảnh và file đính kèm trong tài liệu: lưu trên S3 (bucket `assets`), trả URL có ký.
- DOC-8: Xuất tài liệu ra PDF/DOCX (bản sau; MVP chỉ có HTML/Markdown).

### 4.8 Tìm kiếm (SEARCH)

- SEARCH-1: Tìm toàn văn theo tên, nội dung document, nội dung file (PDF/DOCX/XLSX/PPTX được trích text bằng Apache Tika) và tiêu đề/mô tả video.
- SEARCH-2: Lọc theo workspace, loại node, tag, người tạo, khoảng thời gian.
- SEARCH-3: Kết quả chỉ chứa node mà user có quyền xem. Mỗi bản ghi trong index có trường `acl` (ví dụ `ws:{id}`, `user:{id}`). Khi quyền thay đổi, hệ thống cập nhật lại `acl` cho cả cây con.
- SEARCH-4: Highlight đoạn khớp, chịu được lỗi gõ (typo-tolerant), hỗ trợ tiếng Việt có dấu và không dấu.

### 4.9 Tiện ích (UTIL)

- UTIL-1: Tag do workspace định nghĩa (tên, màu), gắn nhiều tag cho một node.
- UTIL-2: Đánh dấu yêu thích (star) theo từng user.
- UTIL-3: Danh sách mở gần đây (50 mục gần nhất).
- UTIL-4: Notification trong ứng dụng: được mention, được share, comment mới trên tài liệu mình tạo, video xử lý xong hoặc lỗi.

### 4.10 Audit log (AUDIT)

- AUDIT-1: Ghi lại các hành động: đăng nhập, tạo/sửa/xóa/khôi phục/di chuyển node, đổi quyền, share, tải file, xem video (bắt đầu phiên xem), truy cập file gốc video, đổi thành viên. Lượt mở thư mục/tài liệu ghi là `node.view`; cùng một người mở lại cùng một mục trong 5 phút chỉ tính một lần.
- AUDIT-2: Mỗi bản ghi gồm: actor, action, target, workspace, metadata (JSON), IP, user-agent, thời điểm.
- AUDIT-3: OWNER/ADMIN xem log của workspace mình; System Admin xem toàn hệ thống. Có lọc và xuất CSV.
- AUDIT-4: Bảng log chỉ cho phép ghi thêm (append-only), lưu tối thiểu 1 năm.

---

## 5. Kiến trúc

```
                    ┌──────────────┐
  Browser (Next.js) │   Nginx/     │
  ─────────────────►│   Traefik    │
                    └──┬────────┬──┘
              REST /api│        │ WebSocket /collab
                ┌──────▼──┐  ┌──▼──────────┐
                │ API     │  │ Collab      │
                │ NestJS  │  │ Hocuspocus  │
                └┬──┬──┬──┘  └──┬───────┬──┘
                 │  │  │        │       │
     ┌───────────┘  │  └────┐   │       │
     ▼              ▼       ▼   ▼       ▼
 ┌────────┐   ┌────────┐  ┌──────────────┐
 │ Redis  │   │Meili-  │  │ PostgreSQL   │
 │ BullMQ │   │search  │  └──────────────┘
 └───┬────┘   └────────┘
     │ jobs
 ┌───▼──────────────────────────┐
 │ Worker (NestJS standalone)   │
 │ FFmpeg · Tika · Gotenberg    │
 └───┬──────────────────────────┘
     ▼
 ┌──────────────────────────────┐      ┌──────────────────┐
 │ MinIO (S3 API, on-premise)   │─────►│ Backup ngoài     │
 │ originals/ · tmp/ · hls/ ·   │ đêm  │ server (mã hóa)  │
 │ previews/ · thumbnails/ ·    │      └──────────────────┘
 │ assets/                      │
 └──────────────────────────────┘
```

### 5.1 Các thành phần

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| `apps/api` | NestJS 12 (ESM), Prisma 7, PostgreSQL 16 | REST API, auth, phân quyền, nghiệp vụ |
| `apps/collab` | Hocuspocus v4, Yjs | WebSocket soạn thảo real-time, persist tài liệu |
| `apps/worker` | NestJS standalone + BullMQ | Transcode, convert, trích text, index, dọn rác |
| `packages/shared` | TypeScript | Prisma client, permission engine, DTO, hằng số dùng chung |
| PostgreSQL | 16 | Dữ liệu chính, trạng thái Yjs |
| Redis | 7 | Hàng đợi BullMQ, cache quyền, pub/sub giữa các instance Hocuspocus |
| Meilisearch | 1.x | Tìm kiếm toàn văn |
| Apache Tika | server (Docker) | Trích text từ PDF/Office |
| Gotenberg | 8 | Convert Office sang PDF để xem trước |
| FFmpeg | 6+ | Transcode HLS, thumbnail |
| MinIO | S3 API, on-premise | File gốc, HLS, preview, thumbnail, asset, file tạm. MinIO đã ngừng phát hành image chính thức nên dev dùng fork `pgsty/minio`; chọn server cho production ở Phase 7 |

### 5.2 Lớp lưu trữ (Storage abstraction)

Interface `BlobStorage` (`putFile`, `getStream`, `delete`) có một adapter `S3BlobStorage` (AWS SDK v3, `forcePathStyle` cho MinIO, file lớn tự chia multipart). Các bucket:

| Bucket | Nội dung | Mất thì sao |
|---|---|---|
| `originals` | File gốc, key `ws/{workspaceId}/{nodeId}/{versionId}` | **Mất dữ liệu**, phải có backup ngoài server |
| `assets` | Ảnh/file nhúng trong tài liệu (Phase 5) | **Mất dữ liệu**, phải có backup |
| `previews`, `thumbnails`, `hls` | Bản dẫn xuất | Tạo lại được từ `originals` (`POST /files/:id/regenerate`) |
| `tmp` | Part upload đang dở | Tự hết hạn sau 2 ngày |

Bảng `blobs` lưu vị trí thực của mỗi file (`provider`, `container`, `key`, `size`, `sha256`, `mime`), nên sau này có thể đổi nơi lưu (R2, AWS S3, MinIO cụm) mà không đụng đến nghiệp vụ. Xóa dòng `blobs` (kể cả xóa dây chuyền từ node) thì trigger ghi object vào `blob_gc`, worker xóa object sau.

### 5.3 Luồng upload và xử lý

```
Client                API                  S3(tmp)        Worker               S3
  │ POST /uploads      │                      │              │                     │
  │───────────────────►│ tạo node(UPLOADING)  │              │                     │
  │                    │ CreateMultipartUpload│              │                     │
  │◄─ uploadId, parts ─│─────────────────────►│              │                     │
  │ PUT part (presign) ─────────────────────► │              │                     │
  │ POST /uploads/:id/complete                │              │                     │
  │───────────────────►│ CompleteMultipart    │              │                     │
  │                    │ node→PROCESSING, enqueue job ──────►│                     │
  │                    │                      │◄── read ─────│ sniff mime, sha256  │
  │                    │                      │              │ VIDEO: ffmpeg→HLS ─►│ S3 hls/
  │                    │                      │              │ DOC: gotenberg→pdf ►│ S3 previews/
  │                    │                      │              │ tika→text → Meili   │
  │                    │                      │              │ original ──────────►│ S3 originals/
  │                    │◄──────── node READY / FAILED (event)│                     │
  │◄── SSE event ──────│                      │              │                     │
```

### 5.4 Luồng phát video

1. `GET /videos/:id/playback`: API kiểm tra quyền, ghi audit log, sinh `playbackToken` (JWT 10 phút, chứa userId, videoId, sessionId).
2. API trả `masterUrl`. Đây là endpoint của API, playlist được viết lại động như sau:
   - URL segment `.ts`/`.m4s` được thay bằng presigned URL của S3 (hết hạn 10 phút);
   - dòng `#EXT-X-KEY` trỏ về `/videos/:id/key?t={playbackToken}`.
3. Player (hls.js) lấy khóa từ API. API xác thực token, trả 16 byte khóa, và giới hạn số request theo session.
4. FE phủ watermark (email + thời gian) lên video, vị trí thay đổi ngẫu nhiên định kỳ.

### 5.5 Collab server

- Extension `onAuthenticate`: xác minh JWT, tính effective role trên document (cache Redis 60 giây), VIEWER thì đặt `connection.readOnly = true`.
- Extension `Database`: `fetch` và `store` cột `yjs_state` (bytea) trong bảng `documents`.
- Hook `onStoreDocument` cập nhật snapshot JSON, plain text và `updated_at`, rồi đẩy job index vào hàng đợi.
- Hook `onDisconnect`: khi document không còn kết nối nào thì đẩy job tạo phiên bản.
- Extension Redis để chạy nhiều instance khi cần mở rộng.
- Khi quyền bị thu hồi, API publish sự kiện, collab server ngắt kết nối của user đó.

### 5.6 Triển khai on-premise tại văn phòng

- **Domain và HTTPS**: Google OAuth không chấp nhận redirect URI là IP nội bộ, nên cần dùng một subdomain thật, ví dụ `knowledge.lunatech.vn`:
  - DNS nội bộ (split DNS) trỏ subdomain này về IP LAN của server;
  - cấp chứng chỉ Let's Encrypt bằng DNS-01 challenge (không cần mở port ra Internet);
  - đăng ký redirect URI `https://knowledge.lunatech.vn/api/v1/auth/google/callback` trong Google Cloud Console.
- **MinIO cũng cần HTTPS** và một hostname (ví dụ `media.knowledge.lunatech.vn`), vì trình duyệt tải trực tiếp part upload và segment HLS từ MinIO qua presigned URL.
- **Kết nối ra Internet**: server cần outbound tới Google (OAuth) và tới nơi giữ backup.
- **Truy cập từ ngoài văn phòng (có hỗ trợ)**: dùng **Cloudflare Tunnel** (`cloudflared` chạy trên server, kết nối ra ngoài), không mở port router và không cần IP tĩnh.
  - Người dùng mở `https://knowledge.lunatech.vn` từ bất kỳ đâu. Trong văn phòng, split DNS cho đi thẳng qua LAN; ngoài văn phòng thì đi qua tunnel.
  - Lớp bảo vệ bắt buộc là đăng nhập Google của chính hệ thống (chỉ `@lunatech.vn`, AUTH-1..4).
  - Lớp bảo vệ thêm (tùy chọn): **Cloudflare Access** đặt trước tunnel, cũng chỉ cho Google `@lunatech.vn`. Gói Zero Trust miễn phí giới hạn 50 user, trên 50 user phải trả phí theo user; nếu chưa dùng thì hệ thống vẫn an toàn nhờ lớp đăng nhập của app.
  - **Băng thông**: người xem video từ ngoài sẽ dùng **băng thông upload** của mạng văn phòng (ví dụ 20 người xem 720p ≈ 60 Mbps). Cần kiểm tra gói Internet văn phòng; player tự hạ chất lượng khi mạng yếu.
  - **Lưu ý điều khoản Cloudflare**: gói miễn phí không dành cho việc phân phối lượng lớn video. Với quy mô nội bộ thì rủi ro thấp, nhưng nếu lượng xem video từ xa lớn thì chuyển phần media sang VPN (Tailscale/WireGuard) hoặc IP tĩnh + mở cổng 443 qua reverse proxy.
- **Backup**:
  - File gốc chỉ nằm trên MinIO nên **backup là bắt buộc**, không phải tùy chọn.
  - Hằng đêm: dump Postgres + đồng bộ bucket `originals` và `assets` ra ngoài server, có mã hóa (ví dụ restic/rclone tới ổ ngoài và một kho S3 ở cloud như Backblaze B2 hoặc Cloudflare R2). Giữ nhiều bản theo ngày/tuần.
  - Không cần backup `previews`, `thumbnails`, `hls`: tạo lại được từ `originals`.
  - Định kỳ thử khôi phục trên máy khác để chắc backup dùng được.

---

## 6. Mô hình dữ liệu (PostgreSQL)

```
users(id, email UK, name, avatar_url, is_system_admin, status[ACTIVE|DISABLED],
      last_login_at, created_at)

refresh_tokens(id, user_id FK, token_hash, expires_at, revoked_at, user_agent, ip)

workspaces(id, name, slug UK, description, icon,
           storage_target_id FK, created_by, created_at, deleted_at)

workspace_members(workspace_id FK, user_id FK, role[OWNER|ADMIN|EDITOR|VIEWER],
                  added_by, created_at, PK(workspace_id,user_id))

nodes(id, workspace_id FK, parent_id FK NULL, type[FOLDER|DOCUMENT|FILE|VIDEO],
      name, name_normalized, path LTREE,           -- path để truy vấn cây con/tổ tiên
      status[UPLOADING|PROCESSING|READY|FAILED],
      created_by, updated_by, created_at, updated_at,
      deleted_at NULL, deleted_by NULL, original_parent_id NULL)
  UNIQUE(parent_id, name_normalized) WHERE deleted_at IS NULL
  INDEX GIST(path)

node_shares(id, node_id FK, user_id FK, role[EDITOR|VIEWER], granted_by, created_at,
            UNIQUE(node_id,user_id))

blobs(id, provider[S3; GDRIVE còn trong enum nhưng không dùng], container, key, size_bytes, mime, sha256, created_at)

files(node_id PK/FK, current_version_id FK, preview_blob_id FK NULL,
      thumbnail_blob_id FK NULL, extracted_text_status)
file_versions(id, node_id FK, version_no, blob_id FK, uploaded_by, created_at)

videos(node_id PK/FK, original_blob_id FK, duration_sec, width, height,
       renditions JSONB, hls_prefix, aes_key_encrypted, poster_blob_id,
       sprite_blob_id, transcode_progress, error_message, view_count)
video_watch_progress(user_id, node_id, position_sec, updated_at, PK(user_id,node_id))

documents(node_id PK/FK, yjs_state BYTEA, content_json JSONB, content_text TEXT,
          word_count, last_edited_at)
document_versions(id, node_id FK, version_no, name NULL, yjs_snapshot BYTEA,
                  content_json JSONB, created_by, created_at, is_auto)
comment_threads(id, node_id FK, anchor_id, quoted_text, status[OPEN|RESOLVED],
                created_by, created_at, resolved_by, resolved_at)
comments(id, thread_id FK, author_id FK, body, mentions UUID[], edited_at,
         created_at, deleted_at)

upload_sessions(id, node_id FK, s3_upload_id, tmp_key, size_bytes, part_size,
                mime_declared, status, expires_at, created_by)

tags(id, workspace_id FK, name, color, UNIQUE(workspace_id,name))
node_tags(node_id, tag_id, PK)
favorites(user_id, node_id, created_at, PK)
recent_views(user_id, node_id, viewed_at, PK(user_id,node_id))
notifications(id, user_id, type, payload JSONB, read_at, created_at)

audit_logs(id BIGSERIAL, actor_id, action, target_type, target_id, workspace_id,
           metadata JSONB, ip, user_agent, created_at)   -- partition theo tháng

blob_gc(id, provider, container, key, attempts, last_error, created_at)  -- hàng đợi dọn object
```

**Thuật toán effective role** (đặt trong `packages/shared/permissions`):

```
role(user, node) = max(
  workspace_members[node.workspace_id, user].role,
  max(node_shares.role WHERE node_id IN ancestors(node) ∪ {node} AND user_id = user)
)
```

`ancestors` lấy được bằng một truy vấn `path @>` trên ltree. Kết quả cache trong Redis theo khóa `perm:{userId}:{nodeId}` (TTL 60 giây), và bị xóa khi share hoặc membership thay đổi.

---

## 7. Đặc tả API (REST, `/api/v1`)

Quy ước chung:

- JSON, camelCase. Xác thực bằng `Authorization: Bearer <accessToken>`.
- Phân trang theo cursor: `?cursor=&limit=` (mặc định 50, tối đa 200), response trả `{ items, nextCursor }`.
- Lỗi theo dạng `{ error: { code, message, details?, requestId } }`; `requestId` trùng với header `x-request-id`. Các mã: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND` (cũng dùng khi user không có quyền xem, để không lộ sự tồn tại của tài nguyên), `409 CONFLICT`, `413 TOO_LARGE`, `422 UNSUPPORTED_TYPE`, `429 RATE_LIMITED`.
- Tài liệu OpenAPI sinh tự động tại `/api/docs` (Swagger UI).
- Cột "Quyền" ghi quyền tối thiểu trên node hoặc workspace liên quan.

### 7.1 Auth

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/auth/google` | Redirect sang Google OAuth | public |
| GET | `/auth/google/callback` | Xử lý callback, set refresh cookie, redirect về FE | public |
| POST | `/auth/refresh` | Đổi refresh token lấy access token mới (rotate) | cookie |
| POST | `/auth/logout` | Thu hồi refresh token | user |
| GET | `/me` | Thông tin user hiện tại + danh sách workspace và vai trò | user |

### 7.2 Users (admin)

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/users?q=` | Tìm user (phục vụ share/mention) | user |
| GET | `/admin/users` | Danh sách user | system admin |
| PATCH | `/admin/users/:id` | Khóa/mở khóa, cấp quyền system admin | system admin |

### 7.3 Workspaces

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/workspaces` | Workspace của tôi | user |
| POST | `/workspaces` | Tạo workspace `{name, slug, ownerId}` | system admin |
| GET | `/workspaces/:wsId` | Chi tiết + thống kê dung lượng | VIEWER |
| PATCH | `/workspaces/:wsId` | Sửa tên, mô tả, icon | OWNER |
| DELETE | `/workspaces/:wsId` | Xóa mềm workspace | OWNER |
| GET | `/workspaces/:wsId/members` | Danh sách thành viên | VIEWER |
| POST | `/workspaces/:wsId/members` | Thêm `{userId|email, role}` | ADMIN |
| PATCH | `/workspaces/:wsId/members/:userId` | Đổi vai trò | ADMIN (không được tự nâng mình lên OWNER) |
| DELETE | `/workspaces/:wsId/members/:userId` | Xóa thành viên | ADMIN |
| POST | `/workspaces/:wsId/transfer-ownership` | Chuyển owner | OWNER |

### 7.4 Nodes (cây nội dung)

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/workspaces/:wsId/nodes?parentId=&type=&sort=&cursor=` | Liệt kê con (parentId rỗng = gốc) | VIEWER |
| POST | `/workspaces/:wsId/folders` | Tạo folder `{parentId, name}` | EDITOR |
| POST | `/workspaces/:wsId/documents` | Tạo document `{parentId, name}` | EDITOR |
| GET | `/nodes/:id` | Chi tiết node (kèm effective role, tags, isFavorite, chi tiết theo loại) | VIEWER |
| GET | `/nodes/:id/breadcrumb` | Đường dẫn từ gốc tới node | VIEWER |
| PATCH | `/nodes/:id` | Đổi tên `{name}` | EDITOR |
| POST | `/nodes/:id/move` | Di chuyển `{targetParentId}` (chặn di chuyển vào chính cây con của nó) | EDITOR ở cả nguồn và đích |
| POST | `/nodes/:id/copy` | Sao chép (chỉ DOCUMENT) | EDITOR |
| DELETE | `/nodes/:id` | Đưa vào thùng rác (kéo theo cây con) | EDITOR |
| GET | `/nodes/:id/events` | SSE: trạng thái xử lý, tiến độ transcode | VIEWER |
| GET | `/shared-with-me` | Các node được share trực tiếp cho tôi | user |

### 7.5 Shares

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/nodes/:id/shares` | Danh sách share trực tiếp và kế thừa | ADMIN |
| POST | `/nodes/:id/shares` | Thêm `{userId, role}` | ADMIN |
| PATCH | `/nodes/:id/shares/:shareId` | Đổi role | ADMIN |
| DELETE | `/nodes/:id/shares/:shareId` | Thu hồi share | ADMIN |

### 7.6 Trash

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/workspaces/:wsId/trash` | Các mục đã xóa (chỉ mục gốc của mỗi lần xóa) | EDITOR |
| POST | `/nodes/:id/restore` | Khôi phục | EDITOR |
| DELETE | `/nodes/:id/permanent` | Xóa vĩnh viễn | OWNER |
| DELETE | `/workspaces/:wsId/trash` | Dọn sạch thùng rác | OWNER |

### 7.7 Uploads

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| POST | `/workspaces/:wsId/uploads` | Khởi tạo `{parentId, fileName, size, mime, kind: FILE|VIDEO, replaceNodeId?}`, trả `{uploadId, nodeId, partSize, parts:[{partNumber,url}]}` | EDITOR |
| GET | `/uploads/:uploadId/parts?from=&to=` | Lấy thêm presigned URL (khi URL cũ hết hạn hoặc resume) | owner của upload |
| GET | `/uploads/:uploadId` | Trạng thái, các part đã nhận (để resume) | owner của upload |
| POST | `/uploads/:uploadId/complete` | Hoàn tất `{parts:[{partNumber, etag}]}` | owner của upload |
| DELETE | `/uploads/:uploadId` | Hủy upload | owner của upload |

### 7.8 Files

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/files/:id` | Chi tiết: phiên bản hiện tại, trạng thái xử lý, `canDownload` | VIEWER |
| GET | `/files/:id/preview?version=` | `{kind: pdf|image|text|none, url, expiresAt}`, URL ký (10 phút) tới bản preview trên MinIO | VIEWER |
| GET | `/files/:id/thumbnail` | Redirect tới thumbnail (ảnh) | VIEWER |
| GET | `/files/:id/download?version=` | Stream file gốc qua API (không lộ vị trí lưu trữ), ghi audit `file.download`. Video → 403 | VIEWER |
| POST | `/files/:id/download-link?version=` | Link tải dùng một lần (60 giây) để trình duyệt tải trực tiếp | VIEWER |
| GET | `/downloads/:token` | Tải bằng link dùng một lần (không cần token đăng nhập) | link |
| GET | `/files/:id/versions` | Lịch sử phiên bản file | VIEWER |
| POST | `/files/:id/versions/:versionId/restore` | Đặt một phiên bản cũ làm bản hiện tại | EDITOR |
| POST | `/files/:id/regenerate` | Tạo lại preview/thumbnail/chữ trích từ file gốc | EDITOR |
| GET | `/nodes/:id/events` | SSE trạng thái xử lý `{nodeId, status, versionId?, error?}` | VIEWER |
| GET | `/workspaces/:wsId/storage` | Dung lượng đã dùng (gốc, dẫn xuất, thùng rác) | thành viên |
| POST | `/files/:id/convert-to-document` | Import DOCX thành Document mới (cùng folder), Phase 5 | EDITOR |

Loại file cho phép: PDF; Office (docx/xlsx/pptx/doc/xls/ppt/odt/ods/odp/rtf); ảnh (png/jpg/webp/gif/avif/heic); chữ (txt/md/csv/json/log); video (mp4/m4v/mov/webm/mkv, chỉ với `kind: VIDEO`). Không nhận HTML/SVG/file thực thi. Worker kiểm tra loại thật bằng nội dung; không khớp → FAILED kèm lý do. Giới hạn: file 500 MB, video 10 GB (`UPLOAD_MAX_FILE_MB`, `UPLOAD_MAX_VIDEO_MB`).

### 7.9 Videos

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/videos/:id/playback` | `{masterUrl, playbackToken, expiresAt, watermark:{text}, resumeAt}` | VIEWER |
| GET | `/videos/:id/hls/master.m3u8?t=` | Master playlist (viết lại động) | playback token |
| GET | `/videos/:id/hls/:rendition/index.m3u8?t=` | Media playlist, segment URL đã ký | playback token |
| GET | `/videos/:id/key?t=` | Khóa AES-128 (16 byte) | playback token + rate limit |
| GET | `/videos/:id/poster` | Ảnh poster | VIEWER |
| GET | `/videos/:id/sprite` | Sprite xem trước khi tua (kèm VTT) | VIEWER |
| PUT | `/videos/:id/progress` | Lưu `{positionSec}` | VIEWER |
| PATCH | `/videos/:id` | Sửa tiêu đề/mô tả | EDITOR |
| POST | `/videos/:id/retranscode` | Chạy lại transcode khi FAILED | EDITOR |

### 7.10 Documents

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/documents/:id` | Metadata + `contentJson` (dùng để render nhanh hoặc khi không có WS) | VIEWER |
| GET | `/documents/:id/collab-token` | Token ngắn hạn để kết nối Hocuspocus | VIEWER |
| GET | `/documents/:id/export?format=html|md` | Xuất nội dung | VIEWER |
| POST | `/documents/:id/assets` | Upload ảnh/file nhúng (≤ 20 MB) | EDITOR |
| GET | `/documents/:id/versions` | Danh sách phiên bản | VIEWER |
| POST | `/documents/:id/versions` | Tạo phiên bản có tên `{name}` | EDITOR |
| GET | `/documents/:id/versions/:vid` | Nội dung một phiên bản | VIEWER |
| GET | `/documents/:id/versions/:vid/diff?with=` | Diff giữa 2 phiên bản | VIEWER |
| POST | `/documents/:id/versions/:vid/restore` | Khôi phục (áp lên Yjs qua collab server) | EDITOR |

**WebSocket** `wss://…/collab`: giao thức Hocuspocus, `documentName = doc:{nodeId}`, `token = collabToken`.

### 7.11 Comments

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/documents/:id/threads?status=` | Danh sách thread + comment | VIEWER |
| POST | `/documents/:id/threads` | Tạo thread `{anchorId, quotedText, body}` | VIEWER |
| POST | `/threads/:tid/comments` | Trả lời `{body}` | VIEWER |
| PATCH | `/comments/:cid` | Sửa comment | tác giả |
| DELETE | `/comments/:cid` | Xóa comment | tác giả hoặc ADMIN |
| POST | `/threads/:tid/resolve` · `/reopen` | Resolve hoặc mở lại thread | EDITOR hoặc người tạo thread |

### 7.12 Search, tags, favorites, recent, notifications

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/search?q=&workspaceId=&type=&tagIds=&createdBy=&from=&to=&cursor=` | Tìm toàn văn, có highlight | user (lọc theo acl) |
| GET/POST | `/workspaces/:wsId/tags` | Liệt kê/tạo tag | VIEWER / EDITOR |
| PATCH/DELETE | `/tags/:tagId` | Sửa/xóa tag | ADMIN |
| PUT | `/nodes/:id/tags` | Gán tag `{tagIds:[]}` | EDITOR |
| GET | `/me/favorites` · PUT/DELETE `/nodes/:id/favorite` | Yêu thích | VIEWER |
| GET | `/me/recent` | 50 mục mở gần đây | user |
| GET | `/me/notifications?unread=` · POST `/me/notifications/read` | Notification | user |
| GET | `/me/notifications/stream` | SSE notification real-time | user |

### 7.13 Audit

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| GET | `/workspaces/:wsId/audit-logs?action=&actorId=&from=&to=` | Log của workspace | ADMIN |
| GET | `/admin/audit-logs` | Log toàn hệ thống | system admin |
| GET | `…/audit-logs/export` | Xuất CSV | như trên |

---

## 8. Yêu cầu phi chức năng

| Mã | Yêu cầu |
|---|---|
| NFR-1 Hiệu năng | API CRUD p95 < 200 ms; tìm kiếm p95 < 300 ms; độ trễ đồng bộ collab < 200 ms trong LAN |
| NFR-2 Video | Video bắt đầu phát < 3 giây; thời gian transcode ≤ 1,5 lần thời lượng video (với máy 8 vCPU) |
| NFR-3 Tải đồng thời | 200 user, 50 người xem video cùng lúc, 20 người cùng sửa một tài liệu |
| NFR-4 Bảo mật | HTTPS bắt buộc; mọi bucket để private; secret lưu trong env/secret manager; AES key mã hóa bằng master key; rate limit theo user/IP; kiểm tra magic bytes; quét virus bằng ClamAV (tùy chọn) |
| NFR-5 Toàn vẹn | Không mất dữ liệu document: Yjs state persist tối đa 10 giây; DB backup hằng ngày (PITR), giữ 30 ngày |
| NFR-6 Quan sát | Log có cấu trúc (pino) kèm request-id; metrics Prometheus; healthcheck `/health`; Sentry |
| NFR-7 Kiểm thử | Unit test cho permission engine ≥ 90% coverage; e2e cho mọi endpoint chính (Vitest + Supertest + Testcontainers) |
| NFR-8 Triển khai | On-premise tại văn phòng, Docker Compose. Server khuyến nghị: 8 vCPU, 32 GB RAM, SSD cho Postgres/Meilisearch, ổ HDD/SSD dung lượng lớn có RAID (hoặc MinIO nhiều ổ, erasure coding) cho MinIO. Dev/staging dùng cùng compose |
| NFR-9 Ngôn ngữ | Thông báo lỗi có `code` cố định để FE dịch; tìm kiếm hỗ trợ tiếng Việt không dấu |

---

## 9. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Transcode tốn CPU | Worker video chạy riêng với concurrency = 1–2; có thể tách sang máy khác hoặc bật NVENC nếu có GPU |
| Video bị quay màn hình | Watermark động để truy vết, audit log phiên xem; chấp nhận rủi ro còn lại |
| Xung đột khi khôi phục phiên bản document | Thực hiện khôi phục trong collab server bằng cách áp transaction Yjs, không ghi đè DB khi đang có người sửa |
| Server văn phòng hỏng ổ cứng hoặc mất điện | RAID/erasure coding cho MinIO, UPS; backup hằng đêm (Postgres + `originals` + `assets`) ra ngoài server; HLS/preview tạo lại từ file gốc |
| Nhiều người xem video từ ngoài văn phòng làm nghẽn mạng | Giới hạn bitrate cho truy cập từ xa (ưu tiên 720p), theo dõi băng thông; khi cần thì chuyển media sang VPN/IP tĩnh |
| Băng thông upload văn phòng thấp | Backup ra cloud chạy ngoài giờ làm việc, chỉ gửi phần thay đổi |
| ACL trong search lệch so với DB | Cập nhật acl theo sự kiện + job đối soát (reconcile) hằng đêm; luôn kiểm tra lại quyền ở API trước khi trả kết quả |

---

## 10. Quyết định đã chốt và câu hỏi còn mở

Đã chốt (2026-10-13):

- Domain đăng nhập: `lunatech.vn`.
- Hạ tầng: server đặt tại văn phòng, object storage dùng MinIO.
- Không có quota dung lượng theo workspace ở MVP.
- Người được share folder (kể cả không thuộc workspace) được comment, áp dụng với mọi role từ VIEWER trở lên (tạm thời, có thể đổi sau).
- DNS của `lunatech.vn` do admin của công ty cấu hình (subdomain đề xuất `knowledge.lunatech.vn` và `media.knowledge.lunatech.vn`).

- Cho phép truy cập từ ngoài văn phòng qua Cloudflare Tunnel; chỉ tài khoản Google `@lunatech.vn`; mỗi lần vào phải đăng nhập lại (không ghi nhớ phiên).

Còn mở: không còn câu hỏi chặn việc triển khai.
