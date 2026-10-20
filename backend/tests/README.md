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

| File                     | Nhóm API                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `00-health.http`         | Health, Swagger, format lỗi                                                        |
| `01-auth.http`           | Token, refresh, đăng xuất, đăng nhập Google                                        |
| `02-users.http`          | `/me`, tìm user, quản trị user                                                     |
| `03-workspaces.http`     | Tạo, xem, sửa, xóa workspace                                                       |
| `04-members.http`        | Thành viên, vai trò, chuyển OWNER                                                  |
| `05-folders.http`        | Folder: tạo, liệt kê, đổi tên, di chuyển, breadcrumb                               |
| `06-shares.http`         | Share folder cho người ngoài workspace, quyền kế thừa, thu hồi                     |
| `07-trash.http`          | Thùng rác: xóa, khôi phục, xóa vĩnh viễn, dọn sạch                                 |
| `08-tags-favorites.http` | Tag, yêu thích, mở gần đây                                                         |
| `09-admin.http`          | Trang admin: số liệu, nhật ký hoạt động, xuất CSV                                  |
| `10-uploads.http`        | Upload multipart, xử lý file, xem trước, tải về, phiên bản (cần worker đang chạy)  |
| `_auth.http`             | Lấy token cho từng vai trò và tạo workspace test dùng chung (các file khác import) |

`fixtures/` chứa file mẫu nhỏ (docx, xlsx, pdf, png, txt và `fake-exe.pdf` là file .exe đổi đuôi) dùng cho `10-uploads.http` và e2e của worker.
