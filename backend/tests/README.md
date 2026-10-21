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
| `03-workspaces.http`     | Tạo (kèm thành viên ban đầu), xem, sửa, xóa workspace; tự vào workspace `lunatech`        |
| `04-members.http`        | Thành viên: System Admin thêm / gỡ, thành viên tự rời                                     |
| `05-folders.http`        | Folder: tạo, liệt kê, đổi tên, di chuyển, breadcrumb, khu Tài liệu / Video, hoạt động     |
| `06-shares.http`         | Share "Chỉ xem" / "Được chỉnh sửa" cho người ngoài workspace, quyền kế thừa, thu hồi     |
| `07-trash.http`          | Thùng rác: xóa, khôi phục, xóa vĩnh viễn, dọn sạch                                        |
| `08-tags-favorites.http` | Tag, yêu thích, mở gần đây                                                                |
| `09-admin.http`          | Trang admin: số liệu, nhật ký hoạt động, xuất CSV                                         |
| `10-uploads.http`        | Upload multipart, xử lý file, xem trước, tải về, phiên bản (cần worker đang chạy)         |
| `11-videos.http`         | Video: transcode HLS, phiên xem, playlist, khoá, file gốc cho admin (cần worker + ffmpeg) |
| `12-documents.http`      | Tài liệu soạn thảo: collab token, phiên bản, comment + @mention, ảnh nhúng, xuất file     |
| `_auth.http`             | Lấy token cho từng người dùng test và tạo workspace test dùng chung (các file khác import) |

## Phân quyền trong bộ test

- Workspace chỉ có một vai trò thành viên `MEMBER`. Chỉ System Admin (`admin`) tạo / sửa / xóa workspace và thêm / gỡ thành viên; thành viên tự rời được.
- Quyền trên từng mục (`myRole`): thành viên là `EDITOR` (xem, tạo, sửa, di chuyển, tải bản mới, comment, gắn tag); người tạo mục hoặc folder cha, hoặc người được share "Được chỉnh sửa", là `OWNER` (thêm: xóa, quản lý share, xem hoạt động); share "Chỉ xem" là `VIEWER` (xem + comment).
- Thùng rác: thành viên xem; người đã xóa hoặc System Admin khôi phục; chỉ System Admin xóa vĩnh viễn / dọn sạch. Sửa / xóa tag: chỉ System Admin.

Người dùng trong `_auth.http` (workspace `contentWs` tạo mới mỗi lần chạy):

| Người          | Vai trò trong workspace test                                                                 |
| -------------- | -------------------------------------------------------------------------------------------- |
| `admin`        | System Admin, không phải thành viên                                                          |
| `creator`      | Thành viên; tạo folder `viewFolder` nên là OWNER của mọi mục bên trong                       |
| `member`       | Thành viên; là OWNER của mục mình tạo, EDITOR với mục người khác tạo                         |
| `sharedViewer` | Không phải thành viên; được share "Chỉ xem" folder `viewFolder` (11 share thêm folder video) |
| `sharedEditor` | Không phải thành viên; được share "Được chỉnh sửa" trong 06 nên là OWNER trên nhánh đó        |
| `outsider`     | Không phải thành viên, không được share gì (06 share riêng để test)                          |
| `alice`, `bob` | Dùng cho test quản trị người dùng (02)                                                       |

`fixtures/` chứa file mẫu nhỏ (docx, xlsx, pdf, png, txt và `fake-exe.pdf` là file .exe đổi đuôi) dùng cho `10-uploads.http` và e2e của worker.

Tải thử phát video (50 phiên): `docker run --rm --network host -v "$PWD/tests/load:/load" grafana/k6:1.8.1 run -e VIDEO_ID=<id> /load/playback.js` (xem đầu file `load/playback.js`).
