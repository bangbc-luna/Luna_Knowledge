# Luna Knowledge · Frontend

Next.js 16 (App Router, TypeScript, Tailwind v4). Giao diện theo skill `evon:ui-ux`: khu user theo phương án A + E, khu admin theo phương án A.

## Chạy

```bash
cd ../backend && pnpm dev        # backend phải chạy trước (API :4000)
cd ../frontend && pnpm install
pnpm dev                          # http://localhost:5173
```

`/api/*` được Next chuyển tiếp sang backend (`next.config.ts`, biến `API_ORIGIN`, mặc định `http://localhost:4000`), nên UI và API cùng origin: cookie refresh `luna_rt` tự gửi kèm, không cần CORS.

Đăng nhập Google thật quay về `http://localhost:5173/login` (`AUTH_REDIRECT_URL` trong `backend/.env`). Ở môi trường dev có thêm **Đăng nhập nhanh** và **Đổi vai nhanh** (menu tài khoản) bằng các tài khoản `qa.*@lunatech.vn`.

## Hai khu

| Khu | Đường dẫn | Ai vào được |
|---|---|---|
| Tài liệu | `/w/[wsId]/f/[[...folder]]`, `/w/[wsId]/members`, `/w/[wsId]/trash`, `/w/[wsId]/tags`, `/shared`, `/favorites`, `/recent` | Mọi người đã đăng nhập; thao tác được tới đâu tuỳ vai trò trong workspace và quyền chia sẻ |
| Quản trị | `/admin`, `/admin/users`, `/admin/logs`, `/admin/workspaces` | Chỉ System Admin (người khác thấy trang "không có quyền") |

## Cấu trúc

```
src/
  app/                    route (App Router): (user)/…, admin/…, login
  components/
    ui/                   nút, ô nhập, ô chọn, menu, hộp thoại, panel trượt, toast…
    shell/                khung app: sidebar, thanh trên, menu tài khoản, chặn quyền
    content/              màn khu tài liệu (thư mục, chia sẻ, thành viên, thùng rác, tag…)
    admin/                màn khu quản trị (tổng quan, người dùng, nhật ký, workspace)
  lib/                    gọi API (tự refresh token), xác thực, định dạng, kiểu dữ liệu
```

## Đổi thương hiệu

- **Màu nhấn:** `--primary` trong `src/app/globals.css` (khối "ĐỔI THƯƠNG HIỆU"), hiện là chàm `#4f46e5`.
- **Font:** `src/app/layout.tsx` (Inter).

## Kiểm tra

```bash
pnpm typecheck && pnpm lint
```
