import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { AppConfig } from '../../config/app-config.js';
import { ErrorCode } from '../errors/error-codes.js';

type Operation = {
  tags?: string[];
  security?: unknown[];
  parameters?: { in: string }[];
  requestBody?: unknown;
  responses: Record<string, Record<string, unknown>>;
};

const DESCRIPTION = (config: AppConfig) => `
Backend của **Luna Knowledge**, kho tài liệu và video nội bộ của LunaTech.
Tổng quan luồng nghiệp vụ và sơ đồ: \`docs/API_OVERVIEW.md\`. Bộ request chạy được: \`backend/tests/*.http\` (httpYac).

## Xác thực
1. \`GET /api/v1/auth/google\` → đăng nhập Google (chỉ email công ty) → API đặt cookie \`luna_rt\` (refresh token, HttpOnly).
2. \`POST /api/v1/auth/refresh\` đổi cookie lấy \`accessToken\` (sống ${config.ACCESS_TOKEN_TTL_SEC} giây), cookie được xoay vòng mỗi lần.
3. Gửi \`Authorization: Bearer <accessToken>\` cho mọi request. Hết hạn → 401 \`SESSION_EXPIRED\` → gọi refresh rồi thử lại.

Môi trường dev: \`POST /api/v1/dev/token\` cấp token cho một email bất kỳ (chỉ khi \`NODE_ENV=development\`).

## Định dạng lỗi
Mọi lỗi trả cùng một dạng, \`requestId\` khớp header \`x-request-id\` và log server:
\`\`\`json
{ "error": { "code": "FORBIDDEN", "message": "...", "details": null, "requestId": "..." } }
\`\`\`
Mã lỗi: ${Object.values(ErrorCode)
  .map((c) => `\`${c}\``)
  .join(', ')}.

## Phân trang
Danh sách dài nhận \`limit\` và \`cursor\`, trả \`{ items, nextCursor }\`. \`nextCursor = null\` là hết dữ liệu; truyền nguyên giá trị đó vào \`cursor\` để lấy trang sau.

## Giới hạn
- ${config.RATE_LIMIT_USER_PER_MIN} request/phút cho mỗi người dùng đã đăng nhập, ${config.RATE_LIMIT_ANON_PER_MIN} request/phút cho mỗi IP chưa đăng nhập. Vượt → 429 \`RATE_LIMITED\`, header \`Retry-After\`.
- Body JSON tối đa ${config.BODY_LIMIT} → vượt trả 413 \`TOO_LARGE\`. File lớn đi qua upload nhiều phần thẳng tới object storage.

## Phân quyền
Mọi tài khoản @lunatech.vn tự động là **VIEWER** của workspace công ty *LunaTech*. Ai cũng tạo được workspace nhóm và là **ADMIN** của nó.

| Vai trò workspace | Quyền trên nội dung | Được làm |
|---|---|---|
| ADMIN | OWNER | Mọi việc: share, dọn thùng rác, quản lý thành viên và tag, xem hoạt động |
| MEMBER | EDITOR | Xem, comment, tạo, sửa, upload, xoá vào thùng rác |
| VIEWER | VIEWER | Xem, comment |

Share từng mục cho người ngoài workspace: *Chỉ xem* → VIEWER, *Được chỉnh sửa* → OWNER trên cả nhánh. Quyền thực tế là mức cao nhất giữa vai trò workspace và share.
Nhãn \`(VIEWER)\`, \`(EDITOR)\`, \`(OWNER)\` trong tóm tắt endpoint là quyền nội dung tối thiểu. System Admin (\`[Admin]\`) quản trị toàn hệ thống.

## Xử lý nền
Upload, trích chữ, preview, transcode video và đánh chỉ mục tìm kiếm chạy ở worker. Theo dõi trạng thái qua SSE \`GET /api/v1/nodes/{id}/events\`; thông báo qua \`GET /api/v1/me/notifications/stream\`.
`;

const TAGS: [string, string][] = [
  ['auth', 'Đăng nhập Google, refresh token, đăng xuất'],
  ['users', 'Người dùng hiện tại, tìm người, quản trị tài khoản'],
  ['workspaces', 'Workspace công ty và workspace nhóm'],
  ['members', 'Thành viên workspace và vai trò; luôn phải còn ít nhất một quản trị'],
  ['nodes', 'Cây thư mục: liệt kê, tạo folder, đổi tên, di chuyển, xoá, hoạt động'],
  ['uploads', 'Upload nhiều phần qua URL ký sẵn, tải tiếp khi rớt mạng'],
  ['files', 'File: phiên bản, preview, thumbnail, tải về, theo dõi xử lý'],
  ['videos', 'Video: phát HLS mã hoá AES-128 theo phiên xem, vị trí xem dở'],
  [
    'documents',
    'Tài liệu soạn thảo: nội dung, collab token, ảnh nhúng, phiên bản, xuất, import .docx',
  ],
  ['comments', 'Thread comment trên tài liệu'],
  ['shares', 'Share từng mục cho từng người'],
  ['tags', 'Tag của workspace và gán tag cho mục'],
  ['favorites', 'Yêu thích và mở gần đây của tôi'],
  ['trash', 'Thùng rác: khôi phục, xoá vĩnh viễn'],
  ['search', 'Tìm toàn văn, có lọc quyền'],
  ['notifications', 'Thông báo và luồng thời gian thực'],
  ['admin', 'System Admin: thống kê, nhật ký, video gốc'],
  ['health', 'Kiểm tra sức khoẻ cho Docker/Traefik'],
  ['dev', 'Chỉ có ở môi trường development'],
];

const RAW: Record<string, { status: string; type: string; description: string; binary?: boolean }> =
  {
    'get /health/live': {
      status: '200',
      type: 'application/json',
      description: 'Process còn sống',
    },
    'get /api/v1/files/{id}/download': {
      status: '200',
      type: 'application/octet-stream',
      description: 'Nội dung file gốc, có Content-Disposition',
      binary: true,
    },
    'get /api/v1/downloads/{token}': {
      status: '200',
      type: 'application/octet-stream',
      description: 'Nội dung file; link chỉ dùng được một lần',
      binary: true,
    },
    'get /api/v1/downloads/video/{token}': {
      status: '200',
      type: 'application/octet-stream',
      description: 'File gốc video; link chỉ dùng được một lần',
      binary: true,
    },
    'get /api/v1/nodes/{id}/events': {
      status: '200',
      type: 'text/event-stream',
      description:
        'Sự kiện `status` gửi ngay trạng thái hiện tại rồi mỗi lần đổi, `ping` mỗi 25 giây',
    },
    'get /api/v1/me/notifications/stream': {
      status: '200',
      type: 'text/event-stream',
      description: 'Sự kiện `notification` cho mỗi thông báo mới, `ping` mỗi 25 giây',
    },
    'get /api/v1/videos/{id}/hls/master.m3u8': {
      status: '200',
      type: 'application/vnd.apple.mpegurl',
      description: 'Master playlist, URL con mang sẵn phiên xem',
    },
    'get /api/v1/videos/{id}/hls/{rendition}/index.m3u8': {
      status: '200',
      type: 'application/vnd.apple.mpegurl',
      description: 'Media playlist, khoá trỏ về /key của phiên',
    },
    'get /api/v1/videos/{id}/key': {
      status: '200',
      type: 'application/octet-stream',
      description: 'Khoá AES-128, đúng 16 byte',
      binary: true,
    },
    'get /api/v1/videos/{id}/sprite.vtt': {
      status: '200',
      type: 'text/vtt',
      description: 'WebVTT trỏ tới ảnh sprite ký sẵn',
    },
    'get /api/v1/documents/{id}/export': {
      status: '200',
      type: 'text/html',
      description: 'Tài liệu dạng HTML hoặc Markdown (`format=md`), kèm Content-Disposition',
    },
    'get /api/v1/admin/audit-logs/export': {
      status: '200',
      type: 'text/csv',
      description: 'CSV UTF-8, tối đa 10.000 dòng',
    },
  };

const PUBLIC = new Set([
  'get /api/v1/auth/google',
  'get /api/v1/auth/google/callback',
  'post /api/v1/auth/refresh',
  'post /api/v1/auth/logout',
  'get /api/v1/downloads/{token}',
  'get /api/v1/downloads/video/{token}',
  'post /api/v1/dev/token',
  'get /health',
  'get /health/live',
]);

const errorRef = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

function enrich(doc: OpenAPIObject) {
  doc.components ??= {};
  doc.components.schemas = {
    ...doc.components.schemas,
    Error: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', enum: Object.values(ErrorCode) },
            message: { type: 'string' },
            details: { nullable: true },
            requestId: { type: 'string' },
          },
        },
      },
      example: {
        error: {
          code: 'FORBIDDEN',
          message: 'Bạn không có quyền với mục này',
          requestId: 'b1f0c2e4-7d1a-4c55-9e0e-2f1a0c9d8e11',
        },
      },
    },
  };
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [method, raw] of Object.entries(ops)) {
      const op = raw as Operation;
      const key = `${method} ${path}`;
      const r = op.responses;
      const special = RAW[key];
      if (special) {
        r[special.status] = {
          description: special.description,
          content: {
            [special.type]: {
              schema: { type: 'string', ...(special.binary ? { format: 'binary' } : {}) },
            },
          },
        };
      }
      if (PUBLIC.has(key)) {
        delete op.security;
      } else {
        r['401'] ??= errorRef(
          'Thiếu hoặc hết hạn access token (`UNAUTHENTICATED`, `SESSION_EXPIRED`)',
        );
      }
      if (op.parameters?.some((p) => p.in === 'path')) {
        if (!PUBLIC.has(key)) r['403'] ??= errorRef('Không đủ quyền (`FORBIDDEN`)');
        r['404'] ??= errorRef('Không tồn tại, đã xoá, hoặc bạn không thấy được (`NOT_FOUND`)');
      } else if (!PUBLIC.has(key) && path.includes('/admin/')) {
        r['403'] ??= errorRef('Chỉ System Admin (`FORBIDDEN`)');
      }
      if (op.requestBody || op.parameters?.some((p) => p.in === 'query')) {
        r['400'] ??= errorRef(
          'Dữ liệu không hợp lệ (`VALIDATION_ERROR`), `details` liệt kê từng trường',
        );
      }
      if (!path.startsWith('/health'))
        r['429'] ??= errorRef('Vượt giới hạn request (`RATE_LIMITED`)');
    }
  }
  return doc;
}

export function buildOpenApiDocument(app: INestApplication, config: AppConfig) {
  const builder = new DocumentBuilder()
    .setTitle('Luna Knowledge API')
    .setDescription(DESCRIPTION(config))
    .setVersion('1.0.0')
    .addServer(config.API_PUBLIC_URL)
    .addBearerAuth()
    .addCookieAuth('luna_rt');
  for (const [name, description] of TAGS) builder.addTag(name, description);
  return enrich(SwaggerModule.createDocument(app, builder.build(), { autoTagControllers: false }));
}
