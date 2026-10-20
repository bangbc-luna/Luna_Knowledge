# Luna Knowledge

Hệ thống lưu trữ tài liệu và video nội bộ của Lunatech: chia theo workspace, soạn thảo real-time, xem video HLS (chỉ xem, không tải).

| Thư mục | Nội dung |
|---|---|
| [backend/](backend/) | API (NestJS), worker, collab server, Prisma, hạ tầng dev (Docker Compose), file test `.http` |
| [frontend/](frontend/) | Giao diện web |
| [docs/](docs/) | Đặc tả ([SPEC.md](docs/SPEC.md)) và kế hoạch ([PLAN.md](docs/PLAN.md)) |

## Chạy nhanh (dev)

```bash
cd backend && pnpm install && pnpm dev      # API http://localhost:4000 (Swagger /api/docs)
cd frontend && pnpm install && pnpm dev     # UI  http://localhost:5173
```

Chi tiết xem README trong từng thư mục.
