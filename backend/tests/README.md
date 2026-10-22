# Test API bằng file .http

## Cài đặt (một lần)

Cài extension **httpYac** cho VS Code: `anweber.vscode-httpyac` (Extensions → tìm "httpYac").

## Chạy

1. Bật API: `pnpm dev` (cần môi trường development; chạy `pnpm db:seed` một lần để có admin@lunatech.vn).
2. Mở file `.http`:
   - Bấm **send** trên một request để chạy request đó. Token cần thiết được lấy tự động.
   - Bấm **send all** ở đầu file để chạy cả file. Kết quả ✓/✖ hiện ngay dưới từng request.

Hoặc chạy trên terminal:

```bash
pnpm test:http                                          # tất cả file
pnpm exec httpyac send tests/04-members.http --all      # một file
```

| File                     | Nhóm API                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `00-health.http`         | Health, Swagger, format lỗi                                                               |
| `01-auth.http`           | Token, refresh, đăng xuất, đăng nhập Google                                               |
| `02-users.http`          | `/me`, tìm user, quản trị user                                                            |
| `03-workspaces.http`     | Ai cũng tạo được workspace nhóm (người tạo là ADMIN), xem, sửa, xóa; workspace công ty `lunatech` (VIEWER, không xóa được) |
| `04-members.http`        | Thành viên: vai trò ADMIN / MEMBER, ADMIN cuối cùng, tự rời; đổi vai trò trong workspace công ty |
| `05-folders.http`        | Folder: tạo, liệt kê, đổi tên, di chuyển, breadcrumb, khu Tài liệu / Video, hoạt động     |
| `06-shares.http`         | Share "Chỉ xem" / "Được chỉnh sửa" cho người ngoài workspace, quyền kế thừa, thu hồi     |
| `07-trash.http`          | Thùng rác: xóa, khôi phục, xóa vĩnh viễn, dọn sạch                                        |
| `08-tags-favorites.http` | Tag, yêu thích, mở gần đây                                                                |
| `09-admin.http`          | Trang admin: số liệu, nhật ký hoạt động, xuất CSV                                         |
| `10-uploads.http`        | Upload multipart, xử lý file, xem trước, tải về, phiên bản (cần worker đang chạy)         |
| `11-videos.http`         | Video: transcode HLS, phiên xem, playlist, khoá, file gốc cho admin (cần worker + ffmpeg) |
| `12-documents.http`      | Tài liệu soạn thảo: collab token, phiên bản, comment + @mention, ảnh nhúng, xuất file     |
| `13-search.http`         | Tìm kiếm: không dấu, tô chỗ khớp, lọc theo quyền, share cập nhật kết quả, dựng lại chỉ mục |
| `_auth.http`             | Lấy token cho từng người dùng test và tạo workspace test dùng chung (các file khác import) |

## Phân quyền trong bộ test

- Workspace có hai loại (`kind`):
  - `COMPANY`: một workspace công ty duy nhất (`lunatech`, tạo từ seed). Ai đăng nhập (kể cả `/dev/token`) cũng tự vào với vai trò `VIEWER`. Không gỡ / tự rời được, không xóa được (403). ADMIN công ty hoặc System Admin đổi vai trò `VIEWER` / `MEMBER` / `ADMIN` (`PATCH .../members/:userId` hoặc `POST .../members` kèm `role`).
  - `TEAM`: ai cũng tạo được (`POST /workspaces`); người tạo là `ADMIN`, `memberEmails` là `MEMBER`. ADMIN workspace (hoặc System Admin) sửa / xóa workspace, thêm / đổi vai trò (`MEMBER` / `ADMIN`; `VIEWER` → 400) / gỡ thành viên; thành viên tự rời được; ADMIN cuối cùng không bị hạ / gỡ / tự rời được (400). MEMBER làm việc quản lý → 403, người ngoài → 404.
- Vai trò workspace (`myRole` của workspace): `ADMIN`, `MEMBER`, `VIEWER` hoặc `null` (System Admin không phải thành viên). Không còn trường `owner`.
- Quyền trên từng mục (`myRole` của mục) theo vai trò workspace: `ADMIN` → `OWNER`, `MEMBER` → `EDITOR`, `VIEWER` → `VIEWER`; share "Được chỉnh sửa" → `OWNER`, share "Chỉ xem" → `VIEWER`. Người tạo mục không còn tự là `OWNER`.
  - `VIEWER`: xem + comment.
  - `EDITOR`: thêm tạo, tải lên, đổi tên, di chuyển, sửa, phiên bản, tạo / gắn tag, xóa (vào thùng rác) mọi mục.
  - `OWNER`: thêm quản lý share, xem hoạt động của mục (System Admin cũng xem được), xóa comment của người khác.
- Thùng rác: MEMBER trở lên hoặc System Admin xem (VIEWER công ty → 403); người đã xóa, ADMIN workspace hoặc System Admin khôi phục; ADMIN workspace hoặc System Admin xóa vĩnh viễn / dọn sạch.
- Sửa / xóa tag: ADMIN workspace hoặc System Admin.

Người dùng trong `_auth.http` (workspace nhóm `contentWs` do `creator` tạo mới mỗi lần chạy):

| Người          | Vai trò trong workspace test                                                                 |
| -------------- | -------------------------------------------------------------------------------------------- |
| `admin`        | System Admin, không phải thành viên (là ADMIN của workspace công ty)                         |
| `creator`      | Người tạo `contentWs` nên là ADMIN → OWNER trên mọi mục; tạo folder `viewFolder`             |
| `member`       | MEMBER → EDITOR trên mọi mục (kể cả mục mình tạo)                                            |
| `sharedViewer` | Không phải thành viên; được share "Chỉ xem" folder `viewFolder` (11 share thêm folder video) |
| `sharedEditor` | Không phải thành viên; được share "Được chỉnh sửa" trong 06 nên là OWNER trên nhánh đó        |
| `outsider`     | Không phải thành viên, không được share gì (06 share riêng để test)                          |
| `alice`, `bob` | Dùng cho test quản trị người dùng (02)                                                       |

Mọi người dùng trên đều là VIEWER của workspace công ty `lunatech`. `04-members.http` tạm nâng `qa.company.lead` / `qa.company.staff` trong workspace công ty rồi trả về VIEWER.

`fixtures/` chứa file mẫu nhỏ (docx, xlsx, pdf, png, txt và `fake-exe.pdf` là file .exe đổi đuôi) dùng cho `10-uploads.http` và e2e của worker.

Tải thử phát video (50 phiên): `docker run --rm --network host -v "$PWD/tests/load:/load" grafana/k6:1.8.1 run -e VIDEO_ID=<id> /load/playback.js` (xem đầu file `load/playback.js`).
