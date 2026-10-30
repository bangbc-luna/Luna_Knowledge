# Gia cố đợt 1: Ổn định giờ cao điểm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server một máy chịu được giờ cao điểm (~150 người xem video, một phần qua cloudflared + ~30 người soạn tài liệu + 1 transcode) với 0 lỗi 429/5xx, API p95 < 300 ms, collab p95 < 50 ms, segment p95 < 300 ms, và có dashboard + cảnh báo để biết khi sắp quá tải.

**Architecture:** Sửa ở bốn lớp. API: bỏ throttle chung cho 4 route HLS, trả trần chất lượng 720p cho người xem qua tunnel, giới hạn import .docx, timeout pool DB và keep-alive HTTP. Collab/worker: gộp job index bằng deduplication của BullMQ, ffmpeg chạy `nice` + giới hạn thread, worker có `/health`. Compose prod: `cpus`/`mem_limit`, Traefik tin header của cloudflared (IP cố định) và nới `readTimeout`, profile `monitoring` (Prometheus + Grafana + node-exporter + cAdvisor). Frontend: hls.js `capLevelToPlayerSize` + trần 720p cho người ở xa, `next/dynamic` cho `LatexWorkspace`. Kết thúc bằng bài k6 hỗn hợp qua Traefik trên prod compose ở máy dev.

**Tech Stack:** NestJS 12 (ESM), `@nestjs/throttler` 6, Prisma 7 + `@prisma/adapter-pg`, BullMQ 6.3, Hocuspocus 4, Vitest 4 + testcontainers, Traefik 3.6, Docker Compose, Next.js 16.4, hls.js 1.7, k6 1.8.1 (`grafana/k6:1.8.1`).

**Spec:** `docs/superpowers/specs/2026-10-30-hardening-design.md` (chỉ mục 2 và mục 4 "Đợt 1", việc 1.1–1.9).

## Global Constraints

- Không có comment trong mã nguồn (quy ước của chủ dự án), kể cả YAML/JS của k6 và cấu hình Prometheus/Grafana do ta viết.
- Trước khi sửa cấu hình Next.js đọc `frontend/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` (xem `frontend/AGENTS.md`); trước khi đụng `turbo.json`/lệnh turbo đọc `docs/README.md` trong package `turbo` đã cài (xem `backend/AGENTS.md`).
- Mọi commit nằm trên nhánh `hardening/wave1-peak-stability`, không commit lên `main`.
- Đợt kết thúc khi xanh: trong `backend/` `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:http` (cần `pnpm dev` đang chạy); trong `frontend/` `pnpm lint`, `pnpm typecheck`, `pnpm build`.
- Không nới bảo vệ video để chữa rate limit: không route nào trả file video, segment vẫn là URL ký 2 phút, khoá vẫn giới hạn 30 lần/phiên (`MAX_KEY_FETCHES`).
- Không đổi response API đang dùng; chỉ được **thêm** trường (`maxHeight` trong playback).
- Chưa có server thật: load test chạy trên máy dev với prod compose, giả định server **8 core / 32 GB**; kết quả ghi rõ "đo trên máy dev, tham khảo"; PLAN.md có mục mở "chạy lại trên server thật (k6 từ máy khác trong LAN), chỉnh `cpus`/`mem_limit`".
- Người xem giờ cao điểm ở cả LAN lẫn qua cloudflared; cả hai đường đều không được dính 429.
- Thay đổi player không đổi giao diện; vẫn kiểm tra trên trình duyệt bằng dev login `?as=<email>` theo quy ước làm UI của dự án.
- Commit message theo kiểu repo: câu tiếng Anh thường, mô tả thay đổi (ví dụ `Skip throttling on HLS playback routes`).

## Review Focus

1. **Một IP gửi dồn dập request HLS với phiên `s` sai/hết hạn** (bot, tab treo): phải nhận 404 nhanh, không 429, không làm IP đó bị chặn ở route khác, không chạm DB. → test ở Task 1.
2. **File .docx đúng 20 MiB và 20 MiB + 1 byte; file nén nở ra quá lớn**: 20 MiB vẫn chuyển được, lớn hơn bị 413 với thông báo rõ, và không để lại tài liệu rỗng "mồ côi" trong thư mục. → test ở Task 5.
3. **Lần lưu đến sau khi job index trước đã hết cửa sổ gộp**: phải sinh job mới, nội dung sửa cuối cùng vẫn được index. → test ở Task 6.
4. **Máy trong LAN tự gửi `X-Forwarded-For` hoặc `Cf-Connecting-IP` giả**: Traefik không tin XFF từ IP khác cloudflared (vẫn bị giới hạn theo IP thật), `Cf-Connecting-IP` giả chỉ làm chất lượng mặc định xuống 720p. → kiểm tra ở Task 8 (curl) và Task 2 (test LAN không header → `maxHeight: null`).
5. **Worker chạy câu SQL dài (reindex, dọn dẹp) sau khi bật `statement_timeout` 30 s**: worker phải dùng mốc riêng 300 s, không bị cắt giữa chừng. → test ở Task 4.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/apps/api/src/videos/videos.controller.ts` | `@SkipThrottle()` cho 4 route HLS; truyền cờ "qua tunnel" vào `startPlayback` |
| `backend/apps/api/src/common/http/request-context.ts` | thêm `viaTunnel(req)` |
| `backend/apps/api/src/videos/videos.service.ts`, `videos.schemas.ts` | trường `maxHeight` của playback |
| `backend/apps/api/src/config/app-config.ts` | `REMOTE_VIDEO_MAX_HEIGHT`, `HTTP_KEEP_ALIVE_TIMEOUT_MS` |
| `backend/apps/api/src/setup-app.ts` | đặt `keepAliveTimeout`/`headersTimeout` |
| `backend/packages/shared/src/env.ts` | `DB_CONNECT_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS` |
| `backend/packages/db/src/index.ts` | `createPrismaClient` nhận và truyền timeout cho pg |
| `backend/apps/api/src/documents/docx-limits.ts` (mới) | đọc tổng dung lượng giải nén từ central directory của zip |
| `backend/apps/api/src/documents/documents.service.ts` | chặn kích thước trước khi đọc/convert |
| `backend/apps/collab/src/index-queue.ts` (mới) | `enqueueIndexNode` có deduplication + delay |
| `backend/apps/worker/src/processing/ffmpeg.ts` | `nice` + `-threads` |
| `backend/apps/worker/src/infra/metrics.server.ts` | route `/health` |
| `backend/docker/docker-compose.prod.yml` | giới hạn tài nguyên, Traefik, healthcheck, grace period, profile `monitoring` |
| `backend/docker/monitoring/**` (mới) | cấu hình Prometheus, luật cảnh báo, provisioning + dashboard Grafana |
| `backend/scripts/load-seed.ts` (mới), `backend/scripts/upload.ts` | tạo user/phiên/token cho load test trên prod; upload bằng token có sẵn |
| `backend/tests/load/peak.js` (mới), `backend/apps/collab/scripts/load-collab.ts` | kịch bản k6 hỗn hợp; collab đọc seed, nhiều tài liệu, ngưỡng p95 |
| `frontend/src/components/videos/video-player.tsx`, `frontend/src/lib/types.ts` | `capLevelToPlayerSize`, trần theo `maxHeight` |
| `frontend/src/components/documents/document-page.tsx` | `next/dynamic` cho `LatexWorkspace` |
| `docs/DEPLOY.md`, `docs/PLAN.md` | con số tài nguyên, NIC/uplink, monitoring, kết quả đo, mục mở |

---

### Task 0: Nhánh làm việc

- [ ] **Step 1: Tạo nhánh**

Run: `cd /home/bangbc/Documents/Luna/Luna_Knowledge && git switch -c hardening/wave1-peak-stability`
Expected: `Switched to a new branch 'hardening/wave1-peak-stability'`. Không đưa thay đổi đang dở của `.gitignore` và `docs/superpowers/` vào commit của task khác trừ khi task đó nói rõ.

---

### Task 1: Route HLS không bị rate limit ẩn danh (1.1, phần API)

**Files:**
- Modify: `backend/apps/api/src/videos/videos.controller.ts` (4 handler `master`, `media`, `segment`, `key`, khoảng dòng 99–154)
- Test: `backend/apps/api/test/security.e2e-spec.ts` (app ở đây có `RATE_LIMIT_ANON_PER_MIN: 4`)

**Interfaces:**
- Produces: 4 route `GET /api/v1/videos/:id/hls/master.m3u8`, `/hls/:rendition/index.m3u8`, `/hls/:rendition/:segment`, `/videos/:id/key` không qua throttler. Tracker và giới hạn của mọi route khác giữ nguyên.

- [ ] **Step 1: Viết test hỏng**, đặt ngay sau test `'request chưa đăng nhập bị giới hạn theo IP; /health không bị giới hạn'` (IP test đã cạn hạn mức ẩn danh):

```ts
it('route HLS không bị giới hạn theo IP dù IP đã cạn hạn mức ẩn danh', async () => {
  const id = randomUUID();
  const s = 'x'.repeat(32);
  await http().post('/api/v1/auth/refresh').expect(429);
  const paths = [
    `/api/v1/videos/${id}/hls/master.m3u8?s=${s}`,
    `/api/v1/videos/${id}/hls/720p/index.m3u8?s=${s}`,
    `/api/v1/videos/${id}/hls/720p/seg_0000.ts?s=${s}`,
    `/api/v1/videos/${id}/key?s=${s}`,
  ];
  for (const p of paths) for (let i = 0; i < 15; i++) await http().get(p).expect(404);
  await http().post('/api/v1/auth/refresh').expect(429);
});
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd backend/apps/api && pnpm vitest run --config ./vitest.config.e2e.ts test/security.e2e-spec.ts -t "route HLS"`
Expected: FAIL, nhận 429 thay vì 404.

- [ ] **Step 3: Thêm `@SkipThrottle()` (từ `@nestjs/throttler`) lên 4 handler `master`, `media`, `segment`, `key`.** Không đổi `LunaThrottlerGuard`.

- [ ] **Step 4: Chạy lại test trên và toàn bộ `security.e2e-spec.ts` + `videos.e2e-spec.ts`**

Run: `pnpm vitest run --config ./vitest.config.e2e.ts test/security.e2e-spec.ts test/videos.e2e-spec.ts`
Expected: PASS (test `'khoá có giới hạn số lần'` vẫn trả 429 RATE_LIMITED sau 30 lần lấy khoá).

- [ ] **Step 5: Commit** `Skip throttling on HLS playback routes`

---

### Task 2: Playback trả trần chất lượng cho người xem qua tunnel (1.8, phần API)

**Files:**
- Modify: `backend/apps/api/src/common/http/request-context.ts`
- Modify: `backend/apps/api/src/config/app-config.ts` (khối `.extend({...})`)
- Modify: `backend/apps/api/src/videos/videos.schemas.ts` (`playbackSchema`)
- Modify: `backend/apps/api/src/videos/videos.service.ts:100-162` (`startPlayback`)
- Modify: `backend/apps/api/src/videos/videos.controller.ts` (`playback`)
- Modify: `backend/.env.example`, `backend/.env.prod.example`
- Test: `backend/apps/api/test/videos.e2e-spec.ts`

**Interfaces:**
- Produces: `export function viaTunnel(req: Request): boolean` (true khi có header `cf-connecting-ip` không rỗng); `REMOTE_VIDEO_MAX_HEIGHT: z.coerce.number().int().positive().default(720)`; `startPlayback(user, nodeId, ctx, opts: { viaTunnel: boolean })`; response playback có thêm `maxHeight: number | null` (`playbackSchema` thêm `maxHeight: z.number().int().nullable().describe('Trần chất lượng mặc định (px chiều cao) cho người xem từ xa; null = không giới hạn')`). Task 3 dùng `maxHeight`.

- [ ] **Step 1: Viết test hỏng** trong `videos.e2e-spec.ts`:

```ts
it('người xem qua cloudflared nhận trần 720p, người trong LAN không bị giới hạn', async () => {
  const { nodeId } = await seedVideo('Từ xa.mp4');
  const lan = await play(viewer, nodeId).expect(200);
  expect(lan.body.maxHeight).toBeNull();
  const remote = await play(viewer, nodeId).set('Cf-Connecting-IP', '203.0.113.9').expect(200);
  expect(remote.body.maxHeight).toBe(720);
  await http().get(remote.body.masterUrl).expect(200);
});
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `pnpm vitest run --config ./vitest.config.e2e.ts test/videos.e2e-spec.ts -t "cloudflared"`
Expected: FAIL, `maxHeight` là `undefined`.

- [ ] **Step 3: Cài đặt** `viaTunnel`, env, schema, và `startPlayback` trả `maxHeight: opts.viaTunnel ? this.config.REMOTE_VIDEO_MAX_HEIGHT : null`. Controller gọi `this.videos.startPlayback(user, id, requestContext(req), { viaTunnel: viaTunnel(req) })`. Thêm `REMOTE_VIDEO_MAX_HEIGHT=720` vào hai file `.env*.example`. Không đổi `RequestContext` (nó đi vào audit log).

- [ ] **Step 4: Chạy lại**

Run: `pnpm vitest run --config ./vitest.config.e2e.ts test/videos.e2e-spec.ts`
Expected: PASS toàn file.

- [ ] **Step 5: Commit** `Cap default playback quality at 720p for viewers coming through the tunnel`

---

### Task 3: Player tự giới hạn theo khung hình và theo `maxHeight` (1.8, phần FE)

**Files:**
- Modify: `frontend/src/lib/types.ts:184-192` (`Playback`)
- Modify: `frontend/src/components/videos/video-player.tsx:90-113`

**Interfaces:**
- Consumes: `Playback.maxHeight: number | null` (Task 2).
- Produces: không có gì cho task khác.

- [ ] **Step 1: Thêm `maxHeight: number | null` vào `interface Playback`.**

- [ ] **Step 2: Đổi khởi tạo hls.js** thành `new Hls({ startPosition: resumeFrom ?? -1, capLevelToPlayerSize: true })`. Trong handler `MANIFEST_PARSED`, khi `pb.maxHeight` khác null: đặt `instance.autoLevelCapping` = chỉ số của level cao nhất trong `data.levels` có `height <= pb.maxHeight` (không có level nào thoả thì chỉ số level thấp nhất). Không đụng `selectQuality` (dòng ~198): người dùng chọn tay 1080p vẫn được, chọn lại "Tự động" thì trần quay lại.

- [ ] **Step 3: Kiểm tra tĩnh**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build`
Expected: cả ba thoát mã 0.

- [ ] **Step 4: Kiểm tra trình duyệt.** `cd backend && pnpm dev`, `cd frontend && pnpm dev`, đăng nhập `http://127.0.0.1:5173/?as=qa.member@lunatech.vn`, mở một video ≥ 720p.
  - Cửa sổ trình phát nhỏ (khoảng 640 px): nhãn "Tự động" hiện ≤ 720p; phóng toàn màn hình thì được lên 1080p.
  - Giả lập tunnel: trong DevTools → Network → chuột phải request `POST .../playback` → *Override headers* thêm `Cf-Connecting-IP: 203.0.113.9` (hoặc Playwright `extraHTTPHeaders`), tải lại: ở toàn màn hình nhãn tự động vẫn ≤ 720p; chọn tay 1080p thì phát 1080p.
  - Watermark, xem tiếp, dải ảnh tua vẫn như cũ; không lỗi console.

- [ ] **Step 5: Commit** `Cap hls.js levels to player size and to the server-provided remote ceiling`

---

### Task 4: Timeout pool DB và keep-alive HTTP (1.3, phần mã)

**Files:**
- Modify: `backend/packages/shared/src/env.ts` (`databaseEnvSchema`)
- Modify: `backend/packages/db/src/index.ts`
- Modify: `backend/apps/api/src/infra/prisma/prisma.service.ts`, `backend/apps/worker/src/infra/prisma.provider.ts`, `backend/apps/collab/src/server.ts:81-82`
- Modify: `backend/apps/api/src/config/app-config.ts`, `backend/apps/api/src/setup-app.ts`
- Test: `backend/packages/shared/src/env.spec.ts`, `backend/apps/api/test/app.e2e-spec.ts`, `backend/apps/worker/test/file-process.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `databaseEnvSchema` thêm `DB_CONNECT_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS`, cả ba `z.coerce.number().int().min(0).optional()` (giữ kiểu như `DB_POOL_MAX`, để không phải sửa các object config viết tay trong test).
  - `CreatePrismaClientOptions` thêm `connectTimeoutMs?: number` (mặc định 5000), `statementTimeoutMs?: number` (mặc định 30000), `idleInTransactionTimeoutMs?: number` (mặc định 60000); `createPrismaClient` truyền vào `new PrismaPg({ connectionString, max, connectionTimeoutMillis, statement_timeout, idle_in_transaction_session_timeout })`.
  - Ba nơi gọi truyền `config.DB_*` tương ứng.
  - API env `HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(95_000)`; `setupApp` đặt `server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS`, `server.headersTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000` trên `app.getHttpServer()`.
  - Task 8 dựa vào: worker trong compose đặt `DB_STATEMENT_TIMEOUT_MS=300000`; Traefik `idleConnTimeout=90s` < 95 s.

- [ ] **Step 1: Viết test hỏng**
  - `env.spec.ts`: `databaseEnvSchema.parse({ DATABASE_URL: 'postgresql://a@b/c', DB_STATEMENT_TIMEOUT_MS: '1500' }).DB_STATEMENT_TIMEOUT_MS` bằng `1500`; khi bỏ trống thì `undefined`.
  - `app.e2e-spec.ts`:

```ts
it('kết nối DB có statement_timeout và idle_in_transaction_session_timeout; keep-alive dài hơn Traefik', async () => {
  const [st] = await ctx.prisma.$queryRawUnsafe<Array<{ statement_timeout: string }>>('SHOW statement_timeout');
  expect(st.statement_timeout).toBe('30s');
  const [idle] = await ctx.prisma.$queryRawUnsafe<Array<{ idle_in_transaction_session_timeout: string }>>(
    'SHOW idle_in_transaction_session_timeout',
  );
  expect(idle.idle_in_transaction_session_timeout).toBe('1min');
  const server = ctx.app.getHttpServer() as import('node:http').Server;
  expect(server.keepAliveTimeout).toBe(95_000);
  expect(server.headersTimeout).toBe(96_000);
  const short = createPrismaClient({ connectionString: process.env.DATABASE_URL!, max: 1, statementTimeoutMs: 200 });
  await expect(short.$queryRawUnsafe('SELECT pg_sleep(1)')).rejects.toThrow(/statement timeout/);
  await short.$disconnect();
});
```

  - `file-process.e2e-spec.ts`: thêm `DB_STATEMENT_TIMEOUT_MS: '300000'` vào khối `Object.assign(process.env, {...})`, và test `'worker dùng statement_timeout riêng cho việc dài'`: `SHOW statement_timeout` qua `prisma` của worker bằng `'5min'`.

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd backend && pnpm --filter @luna/shared test && pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/app.e2e-spec.ts`
Expected: FAIL (`statement_timeout` là `0`, `keepAliveTimeout` là `5000`).

- [ ] **Step 3: Cài đặt theo Interfaces.**

- [ ] **Step 4: Chạy lại cả ba file test + `pnpm typecheck`**

Run: `pnpm --filter @luna/shared test && pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/app.e2e-spec.ts && pnpm --filter @luna/worker exec vitest run --config ./vitest.config.e2e.ts test/file-process.e2e-spec.ts -t "statement_timeout" && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Thêm vào `.env.example` và `.env.prod.example`:** `DB_CONNECT_TIMEOUT_MS=5000`, `DB_STATEMENT_TIMEOUT_MS=30000`, `DB_IDLE_TX_TIMEOUT_MS=60000`, `HTTP_KEEP_ALIVE_TIMEOUT_MS=95000`.

- [ ] **Step 6: Commit** `Add database pool timeouts and keep-alive longer than the proxy idle timeout`

---

### Task 5: Giới hạn kích thước khi chuyển .docx thành tài liệu (1.4)

**Files:**
- Create: `backend/apps/api/src/documents/docx-limits.ts`, `backend/apps/api/src/documents/docx-limits.spec.ts`
- Modify: `backend/apps/api/src/documents/documents.service.ts:260-306` (`importDocx`)
- Modify: `backend/apps/api/package.json` (devDependency `jszip` `3.10.2`, bản mammoth đang dùng, chỉ để dựng file zip trong test)
- Test: `backend/apps/api/test/documents.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `export const DOCX_IMPORT_MAX_BYTES = 20 * 1024 * 1024;`
  - `export const DOCX_UNZIPPED_MAX_BYTES = 100 * 1024 * 1024;`
  - `export function zipUncompressedBytes(buf: Buffer): number | null` — tổng `uncompressed size` của mọi mục trong central directory; `null` nếu không đọc được zip; `Number.POSITIVE_INFINITY` nếu gặp giá trị ZIP64 `0xFFFFFFFF`.
  - Lỗi: kích thước gốc > 20 MiB → `AppError.tooLarge('Word documents larger than 20 MB cannot be converted', { maxBytes: DOCX_IMPORT_MAX_BYTES })`; giải nén > 100 MiB → `AppError.tooLarge('This Word document expands to more than 100 MB and cannot be converted', { maxUnzippedBytes: DOCX_UNZIPPED_MAX_BYTES })`; `null` → `AppError.unsupportedType('This Word document could not be converted')`.

Thuật toán `zipUncompressedBytes` (không thư viện): quét ngược từ cuối buffer (tối đa 65 557 byte) tìm chữ ký EOCD `0x06054b50`; đọc số mục (u16 LE tại +10) và offset central directory (u32 LE tại +16); duyệt từng header `0x02014b50`: cộng u32 tại +24, nhảy `46 + nameLen(+28) + extraLen(+30) + commentLen(+32)`; sai chữ ký hoặc vượt buffer → `null`.

- [ ] **Step 1: Viết unit test hỏng** `docx-limits.spec.ts` (dựng zip bằng `JSZip`, `compression: 'DEFLATE'`):
  - `'cộng dung lượng giải nén của mọi mục'`: zip có `a.xml` 1000 byte và `b.xml` 2500 byte → `3500`.
  - `'file nén nhỏ nhưng nở lớn vẫn đo đúng'`: một mục 5 MiB toàn số 0 → `5 * 1024 * 1024`, và `buf.length < 100_000`.
  - `'không phải zip thì trả null'`: `Buffer.from('not a zip')` → `null`.
  - `'ZIP64 coi như vô hạn'`: sửa u32 tại +24 của header đầu thành `0xFFFFFFFF` → `Infinity`.

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd backend/apps/api && pnpm vitest run src/documents/docx-limits.spec.ts`
Expected: FAIL, module không tồn tại.

- [ ] **Step 3: Cài `docx-limits.ts`.** Run lại lệnh trên → PASS.

- [ ] **Step 4: Viết e2e hỏng** trong `documents.e2e-spec.ts`. Tách phần dựng file từ test `'import .docx ...'` (dòng ~533–567) thành helper trong file test `seedDocx(folderId: string, name: string, body: Buffer, sizeBytes = body.length): Promise<string>` (trả node id; ghi `sizeBytes` vào blob). Test mới:

```ts
it('import .docx: quá 20 MB hoặc nở quá 100 MB bị từ chối rõ ràng, không để lại tài liệu rỗng', async () => {
  const folder = (await http().post(`/api/v1/workspaces/${wsId}/folders`).set(editor.auth).send({ name: 'Giới hạn' }).expect(201)).body.id;
  const sample = await readFile(`${FIXTURES}sample.docx`);
  const exact = await seedDocx(folder, 'Vừa.docx', sample, 20 * 1024 * 1024);
  await http().post(`/api/v1/files/${exact}/convert-to-document`).set(editor.auth).expect(201);
  const big = await seedDocx(folder, 'To.docx', sample, 20 * 1024 * 1024 + 1);
  const r1 = await http().post(`/api/v1/files/${big}/convert-to-document`).set(editor.auth).expect(413);
  expect(r1.body.error.code).toBe('TOO_LARGE');
  expect(r1.body.error.details).toEqual({ maxBytes: 20 * 1024 * 1024 });
  const zip = new JSZip();
  zip.file('word/document.xml', Buffer.alloc(101 * 1024 * 1024));
  const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const bombId = await seedDocx(folder, 'Bom.docx', bomb);
  const r2 = await http().post(`/api/v1/files/${bombId}/convert-to-document`).set(editor.auth).expect(413);
  expect(r2.body.error.details).toEqual({ maxUnzippedBytes: 100 * 1024 * 1024 });
  const docs = await ctx.prisma.node.count({ where: { parentId: folder, type: 'DOCUMENT' } });
  expect(docs).toBe(1);
});
```

(Đặt `testTimeout` của test này 60 000 ms vì dựng zip 101 MiB.)

- [ ] **Step 5: Chạy, xác nhận hỏng**

Run: `pnpm vitest run --config ./vitest.config.e2e.ts test/documents.e2e-spec.ts -t "20 MB"`
Expected: FAIL (file 20 MiB + 1 vẫn trả 201).

- [ ] **Step 6: Sửa `importDocx`:** sau khi kiểm `DOCX_MIME`, so `original.sizeBytes > BigInt(DOCX_IMPORT_MAX_BYTES)` → 413 trước khi tải; trong vòng đọc stream, tổng byte vượt mốc thì huỷ stream và trả cùng lỗi 413; sau khi có buffer, gọi `zipUncompressedBytes` và ném lỗi tương ứng. Cả ba kiểm tra đứng **trước** `createNode` để không sinh tài liệu mồ côi.

- [ ] **Step 7: Chạy lại toàn file**

Run: `pnpm vitest run --config ./vitest.config.e2e.ts test/documents.e2e-spec.ts && pnpm vitest run src/documents/docx-limits.spec.ts`
Expected: PASS, gồm test import cũ.

- [ ] **Step 8: Commit** `Limit Word import to 20 MB input and 100 MB uncompressed`

---

### Task 6: Gộp job index của collab (1.5)

**Files:**
- Create: `backend/apps/collab/src/index-queue.ts`
- Modify: `backend/apps/collab/src/server.ts:309-312` (`onStoreDocument`), `backend/apps/collab/src/config.ts`
- Test: `backend/apps/collab/test/server.e2e-spec.ts` (thêm `COLLAB_INDEX_DELAY_MS` vào object `config` dòng ~159)

**Interfaces:**
- Produces:
  - `COLLAB_INDEX_DELAY_MS: z.coerce.number().int().min(0).default(5000)` trong `collabEnvSchema`.
  - `export function enqueueIndexNode(queue: Queue, nodeId: string, delayMs: number): Promise<void>` gọi `queue.add(SEARCH_JOBS.INDEX_NODE, { nodeId }, { delay: delayMs, deduplication: { id: \`index-node-${nodeId}\`, ttl: delayMs }, removeOnComplete: true, removeOnFail: 100 })` (BullMQ cấm `:` trong id; ttl = delay để khoá gộp hết hạn đúng lúc job chạy, nên lần lưu trong khi job đang chạy sinh job mới). Không bắt lỗi trong hàm; `server.ts` giữ `.catch(() => undefined)`.

- [ ] **Step 1: Viết test hỏng** trong `server.e2e-spec.ts` (config test đặt `COLLAB_INDEX_DELAY_MS: 1500`; tạo `Queue(QUEUES.SEARCH_INDEX, { connection: redisConnection(config.REDIS_URL), prefix: 'luna' })` riêng cho test và đóng ở `afterAll`):

```ts
it('nhiều lần gọi trong cửa sổ gộp chỉ sinh một job index; hết cửa sổ thì sinh job mới', async () => {
  const id = randomUUID();
  await enqueueIndexNode(queue, id, 1500);
  await enqueueIndexNode(queue, id, 1500);
  await enqueueIndexNode(queue, id, 1500);
  const jobsFor = async () => (await queue.getJobs(['delayed', 'waiting'])).filter((j) => j.data.nodeId === id);
  expect(await jobsFor()).toHaveLength(1);
  await sleep(1700);
  await enqueueIndexNode(queue, id, 1500);
  expect(await jobsFor()).toHaveLength(2);
});

it('lưu tài liệu nhiều lần chỉ đẩy một job index đang chờ', async () => {
  const nodeId = await newDocument();
  const a = await connect(users.editor, nodeId);
  type(a.ydoc, 'một');
  await until(async () => (await queue.getJobs(['delayed', 'waiting'])).some((j) => j.data.nodeId === nodeId));
  type(a.ydoc, 'hai');
  await sleep(300);
  type(a.ydoc, 'ba');
  await sleep(300);
  expect((await queue.getJobs(['delayed', 'waiting'])).filter((j) => j.data.nodeId === nodeId)).toHaveLength(1);
});
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd backend/apps/collab && pnpm vitest run --config ./vitest.config.e2e.ts -t "job index"`
Expected: FAIL, module `index-queue.js` không tồn tại.

- [ ] **Step 3: Cài `index-queue.ts`, thêm env, thay lời gọi trong `onStoreDocument` bằng `enqueueIndexNode(searchQueue, nodeId, config.COLLAB_INDEX_DELAY_MS).catch(() => undefined)`.**

- [ ] **Step 4: Chạy lại toàn file collab e2e + worker search e2e**

Run: `pnpm vitest run --config ./vitest.config.e2e.ts && cd ../worker && pnpm vitest run --config ./vitest.config.e2e.ts test/search-index.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit** `Deduplicate collab search indexing jobs per document`

---

### Task 7: ffmpeg nhường CPU; worker có `/health` (1.2 và 1.7, phần mã)

**Files:**
- Modify: `backend/packages/shared/src/env.ts` (`videoEnvSchema`)
- Modify: `backend/apps/worker/src/processing/ffmpeg.ts` (`FfmpegTools`, `run`, `transcodeHls` dòng ~138–235)
- Modify: `backend/apps/worker/src/processors/video-transcode.processor.ts:63-67`
- Modify: `backend/apps/worker/src/infra/metrics.server.ts:48-63`
- Modify: `backend/Dockerfile` (stage `worker`: thêm `HEALTHCHECK` giống api, URL `http://127.0.0.1:'+(process.env.WORKER_METRICS_PORT||9464)+'/health`)
- Create: `backend/apps/worker/src/processing/ffmpeg.spec.ts`; Modify: `backend/apps/worker/package.json` (thêm script `"test": "vitest run"`; mẫu include mặc định của vitest `**/*.spec.ts` không khớp `*.e2e-spec.ts`, nên không cần config mới và `turbo run test` tự nhận worker)
- Test: `backend/apps/worker/test/system.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `videoEnvSchema` thêm `FFMPEG_THREADS: z.coerce.number().int().min(0).default(0)` (0 = để ffmpeg tự chọn), `FFMPEG_NICE: z.coerce.number().int().min(0).max(19).default(10)`.
  - `FfmpegTools` thêm `threads: number; nice: number`.
  - `export function ffmpegCommand(tools: FfmpegTools, args: string[]): { cmd: string; args: string[] }` — `nice > 0` → `{ cmd: 'nice', args: ['-n', String(nice), tools.ffmpeg, ...args] }`, ngược lại `{ cmd: tools.ffmpeg, args }`. Mọi lời gọi ffmpeg (transcode, poster, sprite) đi qua hàm này; ffprobe không.
  - `export function threadArgs(threads: number): { global: string[]; output: string[] }` — `threads > 0` → `{ global: ['-filter_complex_threads', String(threads)], output: ['-threads', String(threads)] }`, ngược lại cả hai `[]`; trong `transcodeHls`, `global` đứng đầu danh sách args, `output` chèn ngay trước `'-f', 'hls'`.
  - Metrics server: `GET /health` → `200 ok` không cần token (đặt trước kiểm tra `metricsAllowed`).

- [ ] **Step 1: Viết test hỏng**
  - `ffmpeg.spec.ts`: `ffmpegCommand({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', encoder: 'libx264', threads: 4, nice: 10 }, ['-i', 'a'])` bằng `{ cmd: 'nice', args: ['-n', '10', 'ffmpeg', '-i', 'a'] }`; với `nice: 0` bằng `{ cmd: 'ffmpeg', args: ['-i', 'a'] }`; `threadArgs(4)` bằng `{ global: ['-filter_complex_threads', '4'], output: ['-threads', '4'] }`; `threadArgs(0)` bằng `{ global: [], output: [] }`.
  - `system.e2e-spec.ts`: đổi `WORKER_METRICS_PORT` thành `'19464'`; test `'GET /health trả ok không cần token'`: `fetch('http://127.0.0.1:19464/health')` → status 200, body `ok`.

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd backend/apps/worker && pnpm vitest run src/processing/ffmpeg.spec.ts && pnpm vitest run --config ./vitest.config.e2e.ts test/system.e2e-spec.ts`
Expected: FAIL.

- [ ] **Step 3: Cài đặt theo Interfaces;** processor truyền `threads: config.FFMPEG_THREADS, nice: config.FFMPEG_NICE`.

- [ ] **Step 4: Chạy lại, gồm e2e transcode thật**

Run: `pnpm vitest run src/processing/ffmpeg.spec.ts && pnpm vitest run --config ./vitest.config.e2e.ts`
Expected: PASS, test `'video: transcode HLS 360p/720p ...'` vẫn xanh (ffmpeg chạy dưới `nice`).

- [ ] **Step 5: Commit** `Run ffmpeg under nice with bounded threads and add worker health endpoint`

---

### Task 8: Prod compose: giới hạn tài nguyên, Traefik, healthcheck (1.2, 1.1 phần Traefik, 1.3 phần Traefik, 1.7 phần healthcheck)

**Files:**
- Modify: `backend/docker/docker-compose.prod.yml`
- Modify: `backend/.env.prod.example`
- Modify: `docs/DEPLOY.md` (§2 chuẩn bị server, §6 truy cập từ xa, §8 nâng cấp, §9 theo dõi)

**Interfaces:**
- Consumes: `FFMPEG_THREADS`, `FFMPEG_NICE` (Task 7), `DB_STATEMENT_TIMEOUT_MS` (Task 4), `/health` của worker (Task 7), `HTTP_KEEP_ALIVE_TIMEOUT_MS=95000` (Task 4).
- Produces: mạng `edge` có subnet cố định, cloudflared có IP cố định — Task 10 dùng gateway `172.30.0.1` cho node-exporter.

Giá trị (giả định server 8 core / 32 GB, ghi rõ trong DEPLOY.md):

| Dịch vụ | `cpus` | `mem_limit` | Khác |
|---|---|---|---|
| worker | `'4'` | `6g` | `FFMPEG_THREADS: '4'`, `FFMPEG_NICE: '10'`, `DB_STATEMENT_TIMEOUT_MS: '300000'`, `stop_grace_period: 60s`, healthcheck `/health` |
| tika | `'1'` | `1536m` | `JAVA_TOOL_OPTIONS: -Xmx1g`; pin image `apache/tika:<bản full cụ thể đang chạy>` thay `latest-full` chỉ khi kéo được tag cụ thể (nếu không, để 2.12) |
| gotenberg | `'1'` | `1g` | |
| meilisearch | `'1'` | `2g` | `MEILI_MAX_INDEXING_MEMORY: 1Gb`, `MEILI_MAX_INDEXING_THREADS: '1'` |
| redis | `'0.5'` | `1g` | command thêm `--maxmemory 768mb` (giữ `--maxmemory-policy noeviction` vì BullMQ cần) |
| api, collab | không giới hạn | không giới hạn | `stop_grace_period: 30s` |
| frontend | không giới hạn | không giới hạn | `KEEP_ALIVE_TIMEOUT: '95000'` (Next standalone đọc biến này) |

Traefik thêm vào `command`:
- `--entrypoints.websecure.forwardedHeaders.trustedIPs=${CLOUDFLARED_IP:-172.30.0.250}/32`
- `--entrypoints.websecure.transport.respondingTimeouts.readTimeout=600s` (part upload 16 MB ở 256 kbps ≈ 500 s)
- `--entrypoints.websecure.transport.respondingTimeouts.idleTimeout=180s`
- `--serversTransport.forwardingTimeouts.idleConnTimeout=90s`

Mạng `edge`: `ipam.config: [{ subnet: ${EDGE_SUBNET:-172.30.0.0/24}, gateway: ${EDGE_GATEWAY:-172.30.0.1} }]`; `cloudflared.networks.edge.ipv4_address: ${CLOUDFLARED_IP:-172.30.0.250}`.

- [ ] **Step 1: Sửa compose và `.env.prod.example`** (thêm `EDGE_SUBNET`, `EDGE_GATEWAY`, `CLOUDFLARED_IP` có giá trị mặc định ở trên, kèm dòng giải thích trong `.env.prod.example` — file env được phép có `#`).

- [ ] **Step 2: Kiểm tra cấu hình**

Run: `cd backend && docker compose -f docker/docker-compose.prod.yml --env-file .env.prod.example config --quiet && docker compose -f docker/docker-compose.prod.yml --env-file .env.prod.example config | grep -E "cpus|mem_limit|trustedIPs|readTimeout|ipv4_address|stop_grace_period"`
Expected: lệnh đầu thoát mã 0; lệnh sau in đủ 5 dịch vụ có `cpus`, dòng `trustedIPs=172.30.0.250/32`, `readTimeout=600s`, `ipv4_address: 172.30.0.250`.

- [ ] **Step 3: Chạy stack prod trên máy dev và kiểm tra giới hạn.** Chuẩn bị `.env.prod` theo DEPLOY.md §4 với `APP_HOST=knowledge.lunatech.test`, `MEDIA_HOST=media.knowledge.lunatech.test`, thêm hai tên đó trỏ `127.0.0.1` trong `/etc/hosts`, `S3_PUBLIC_ENDPOINT=https://media.knowledge.lunatech.test`. Traefik sẽ dùng chứng chỉ tự ký (ACME không chạy được ở máy dev) — chấp nhận, mọi lệnh dùng `-k`/bỏ kiểm TLS.

Run: `alias luna='docker compose -f docker/docker-compose.prod.yml --env-file .env.prod' && luna build && luna up -d && luna ps && docker inspect -f '{{.Name}} {{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}' $(luna ps -q worker tika gotenberg meilisearch redis)`
Expected: `worker` `(healthy)`; NanoCpus `4000000000`, `1000000000`, `1000000000`, `1000000000`, `500000000`; Memory `6442450944`, `1610612736`, `1073741824`, `2147483648`, `1073741824`.

- [ ] **Step 4: Kiểm tra Traefik chỉ tin XFF từ IP của cloudflared** (Review Focus 4). Dùng `/api/v1/auth/refresh` (ẩn danh, 120/phút/IP):

```bash
probe() { docker run --rm --network luna_edge $1 curlimages/curl:8.11.1 -sk -o /dev/null -w '%{http_code}\n' \
  --resolve knowledge.lunatech.test:443:$(docker inspect -f '{{(index .NetworkSettings.Networks "luna_edge").IPAddress}}' $(luna ps -q traefik)) \
  -X POST -H "X-Forwarded-For: $2" https://knowledge.lunatech.test/api/v1/auth/refresh; }
for i in $(seq 125); do probe "--ip 172.30.0.250" 203.0.113.7; done | sort | uniq -c
probe "--ip 172.30.0.250" 203.0.113.8
for i in $(seq 125); do probe "" 203.0.113.9; done | sort | uniq -c
probe "" 203.0.113.10
```

Expected: vòng 1 có `429`; lệnh thứ hai (IP giả lập khác qua cloudflared) trả `401`; vòng 3 có `429`; lệnh cuối (XFF khác nhưng không đi từ IP cloudflared) vẫn `429`. Chạy `luna stop` cloudflared trước nếu đang bật (IP 172.30.0.250 phải trống).

- [ ] **Step 5: Cập nhật DEPLOY.md**
  - §2: bảng giới hạn tài nguyên ở trên, ghi "giả định 8 core / 32 GB, chỉnh lại khi có server thật"; khuyến nghị NIC ≥ 2,5 GbE (200 người xem 1080p ≈ 1 Gbps trong LAN), switch LAN tối thiểu 1 GbE tới từng máy.
  - §6: người xem qua tunnel mặc định trần 720p (~3 Mbps/người), vẫn chọn tay được 1080p; công thức uplink: số người xem từ xa ≈ uplink(Mbps) / 3; khuyến nghị uplink theo số người xem từ xa dự kiến; Traefik chỉ tin `X-Forwarded-For` từ `CLOUDFLARED_IP`.
  - §8: lần đầu nâng cấp lên bản này phải `luna down && luna up -d` một lần vì mạng `luna_edge` đổi subnet (Compose báo network cần tạo lại).
  - §9: thay dòng 429 bằng: route xem video không bị giới hạn; nếu thấy 429 ở người dùng từ xa thì kiểm tra `CLOUDFLARED_IP` khớp IP thật của container cloudflared.

- [ ] **Step 6: Commit** `Resource limits, trusted tunnel headers, proxy timeouts and worker healthcheck in production compose`

---

### Task 9: Tải LatexWorkspace theo nhu cầu (1.6)

**Files:**
- Modify: `frontend/src/components/documents/document-page.tsx:34` và chỗ render `LatexWorkspace`

**Interfaces:**
- Produces: `const LatexWorkspace = dynamic(() => import('./latex-workspace').then((m) => m.LatexWorkspace), { ssr: false, loading: () => <LatexLoading /> })` — `LatexLoading` là khối giữ chỗ cùng chiều cao vùng soạn (dùng skeleton/khối có sẵn trong `../ui/misc` nếu có, không thêm style mới). Không file nào khác import tĩnh `latex-workspace` từ trang tài liệu rich-text.

- [ ] **Step 1: Đọc** `frontend/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` (cách dùng `next/dynamic` với named export và `ssr: false` trong client component ở Next 16).

- [ ] **Step 2: Đổi import tĩnh thành `dynamic(...)` như Interfaces.** `grep -rn "latex-workspace" frontend/src` chỉ còn lời gọi `import()` trong `document-page.tsx`.

- [ ] **Step 3: Kiểm tra tĩnh**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build`
Expected: thoát mã 0.

- [ ] **Step 4: Kiểm tra trình duyệt** (`?as=qa.member@lunatech.vn`, DevTools → Network lọc JS, bật "Disable cache"):
  - Mở một tài liệu rich-text: không có request nào tới file JS chứa `cm-editor` hoặc `katex` (tìm trong Network bằng ô Search của DevTools), không tải `katex.min.css`.
  - Mở một tài liệu LaTeX: chunk chứa CodeMirror/KaTeX được tải, soạn và xem trước hoạt động như trước, hai người cùng gõ vẫn hội tụ.

- [ ] **Step 5: Commit** `Load the LaTeX workspace on demand`

---

### Task 10: Profile `monitoring`: Prometheus, Grafana, node-exporter, cAdvisor (1.7)

**Files:**
- Create: `backend/docker/monitoring/prometheus.yml`, `backend/docker/monitoring/alerts.yml`
- Create: `backend/docker/monitoring/grafana/provisioning/datasources/prometheus.yml`, `.../dashboards/luna.yml`, `backend/docker/monitoring/grafana/dashboards/luna-overview.json`
- Modify: `backend/docker/docker-compose.prod.yml`, `backend/.env.prod.example` (`GRAFANA_ADMIN_PASSWORD=`), `docs/DEPLOY.md` §9

**Interfaces:**
- Consumes: `/metrics` của api (`http_request_duration_seconds`, `http_rate_limited_total`, mặc định `nodejs_*`), collab (`collab_documents_open`, `collab_connections`), worker (`queue_jobs{queue,state}`) với `Authorization: Bearer <METRICS_TOKEN>`; gateway `172.30.0.1` (Task 8).
- Produces: dịch vụ `prometheus`, `grafana`, `node-exporter`, `cadvisor`, đều `profiles: [monitoring]`, `restart: unless-stopped`; volume `prometheus-data`, `grafana-data`.

Quyết định:
- Image pin theo tag cụ thể (kiểm `docker pull` được trước khi commit): `prom/prometheus:v3.5.0`, `grafana/grafana:12.1.0`, `prom/node-exporter:v1.9.1`, `gcr.io/cadvisor/cadvisor:v0.52.1` (tag nào không kéo được thì lấy bản vá mới nhất cùng nhánh).
- `prometheus`: mạng `internal` + `edge`; `entrypoint: ['/bin/sh', '-c', 'printf %s "$$METRICS_TOKEN" > /prometheus/metrics_token && exec /bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus --storage.tsdb.retention.time=30d']`, `environment: METRICS_TOKEN: ${METRICS_TOKEN}`; job `api` (`api:4000`), `collab` (`collab:4001`), `worker` (`worker:9464`) dùng `authorization.credentials_file: /prometheus/metrics_token`; job `node` (`${EDGE_GATEWAY}:9100`, ghi thẳng `172.30.0.1:9100`), `cadvisor` (`cadvisor:8080`); `scrape_interval: 15s`; `rule_files: [alerts.yml]`. Không có cổng ra ngoài.
- `node-exporter`: `network_mode: host`, `pid: host`, volume `/:/host:ro,rslave`, command `--path.rootfs=/host --web.listen-address=172.30.0.1:9100` (chỉ nghe trên cầu nối Docker, không lộ ra LAN).
- `cadvisor`: mạng `internal`, volume `/:/rootfs:ro`, `/var/run:/var/run:ro`, `/sys:/sys:ro`, `/var/lib/docker/:/var/lib/docker:ro`, `/dev/disk/:/dev/disk:ro`, `privileged: true`, `devices: [/dev/kmsg]`.
- `grafana`: mạng `internal`, cổng `127.0.0.1:3001:3000` (vào qua SSH tunnel), `GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}`, `GF_USERS_ALLOW_SIGN_UP: 'false'`, mount provisioning + dashboards chỉ đọc.
- Luật cảnh báo (`alerts.yml`, group `luna`), hiển thị trong Grafana (panel "Alert list" nguồn Prometheus) và Prometheus `/alerts`:
  - `ApiLatencyP95High`: `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="api"}[5m]))) > 0.3`, `for: 5m`.
  - `Http429Or5xxRatio`: `sum(rate(http_request_duration_seconds_count{status=~"429|5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m])) > 0.01`, `for: 5m`.
  - `EventLoopLagHigh`: `max by (service) (nodejs_eventloop_lag_p99_seconds) > 0.2`, `for: 2m`.
  - `QueueBacklog`: `sum by (queue) (queue_jobs{state="waiting"}) > 100`, `for: 10m`.
  - `HostCpuHigh`: `1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) > 0.9`, `for: 10m`.
  - `HostMemoryLow`: `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.1`, `for: 5m`.
  - `HostNetworkSaturated`: `max(rate(node_network_transmit_bytes_total{device!~"lo|veth.*|br-.*|docker.*"}[5m])) * 8 > 0.8e9`, `for: 5m`.
  - `TargetDown`: `up == 0`, `for: 2m`.
- Dashboard `luna-overview.json` (uid `luna-overview`), các panel: API p95 theo route; tỉ lệ 429 và 5xx; event-loop lag p99 theo service; `queue_jobs` theo queue/state; `collab_connections`, `collab_documents_open`; CPU/RAM/NIC host; CPU/RAM theo container (cAdvisor `container_cpu_usage_seconds_total`, `container_memory_working_set_bytes` theo `name`); Alert list. Bố cục chi tiết do người làm chọn (spec §8).

- [ ] **Step 1: Viết các file cấu hình và sửa compose.**

- [ ] **Step 2: Kiểm tra cú pháp**

Run: `cd backend && docker compose -f docker/docker-compose.prod.yml --env-file .env.prod.example --profile monitoring config --quiet && docker run --rm --entrypoint promtool -v "$PWD/docker/monitoring:/m" prom/prometheus:v3.5.0 check rules /m/alerts.yml && python3 -m json.tool docker/monitoring/grafana/dashboards/luna-overview.json > /dev/null`
Expected: cả ba thoát mã 0; promtool in `SUCCESS: 8 rules found`.

- [ ] **Step 3: Chạy trên stack prod ở máy dev**

Run: `luna --profile monitoring up -d && sleep 30 && luna exec prometheus wget -qO- 'http://127.0.0.1:9090/api/v1/targets?state=active' | grep -o '"health":"[a-z]*"' | sort | uniq -c && curl -s -u admin:$GRAFANA_ADMIN_PASSWORD http://127.0.0.1:3001/api/search?query=Luna | grep -c luna-overview`
Expected: `5 "health":"up"` (api, collab, worker, node, cadvisor), không có `down`; dòng cuối in `1`. Mở `http://127.0.0.1:3001`, dashboard có số liệu ở mọi panel. `curl -s -m 3 http://<IP LAN của máy>:9100/metrics` thất bại (node-exporter không lộ ra LAN).

- [ ] **Step 4: DEPLOY.md §9** thêm: bật bằng `luna --profile monitoring up -d`, vào Grafana qua `ssh -L 3001:127.0.0.1:3001 <server>`, danh sách cảnh báo và ý nghĩa ngưỡng; ghi rằng cảnh báo hiện chỉ hiển thị trên Grafana/Prometheus, chưa gửi đi đâu.

- [ ] **Step 5: Commit** `Monitoring profile with Prometheus, Grafana, node-exporter, cAdvisor and alert rules`

---

### Task 11: Kịch bản load test hỗn hợp qua Traefik (1.9, phần script)

**Files:**
- Create: `backend/scripts/load-seed.ts`; Modify: `backend/scripts/package.json` (script `"load:seed": "tsx load-seed.ts"`, dependency `jose` `^6.2.12`)
- Modify: `backend/scripts/upload.ts` (thêm option `--token`)
- Create: `backend/tests/load/peak.js`
- Modify: `backend/apps/collab/scripts/load-collab.ts`
- Modify: `backend/package.json` (script `load:peak`), `.gitignore` (thêm `backend/tests/load/.seed.json`)

**Interfaces:**
- Consumes: `maxHeight` (Task 2), HLS không throttle (Task 1).
- Produces:
  - `pnpm --filter @luna/scripts load:seed -- --viewers 150 --editors 30 --out ../tests/load/.seed.json --yes` với env `DATABASE_URL` (Postgres prod qua `127.0.0.1:5432`), `JWT_ACCESS_SECRET` (của `.env.prod`). Không có `--yes` thì thoát mã 1 không làm gì. Upsert user `load.lead@lunatech.vn`, `load.e{i}@lunatech.vn`, `load.v{i}@lunatech.vn` (đều được `cleanup:test` dọn vì khớp `load.%`), workspace slug `load-peak` (lead `ADMIN`, editors `MEMBER`, viewers `VIEWER`), mỗi user một `Session` (`absoluteExpiresAt` = now + 12 h), ký access token như `TokenService.signAccess` (HS256, `iss: 'luna-api'`, `aud: 'luna'`, `typ: 'access'`, `sid`, `sub`) nhưng hết hạn sau 2 h. File ra: `{ wsId: string, lead: string, editors: string[], viewers: string[] }`.
  - `upload.ts --token <accessToken>`: có token thì bỏ bước gọi `/dev/token`.
  - `load-collab.ts` đọc thêm env: `SEED_FILE` (có thì lấy `lead` + `editors` từ file thay vì `/dev/token`, dùng `wsId` sẵn có), `DOCS` (mặc định 1; client `i` vào tài liệu `i % DOCS`), `P95_MAX_MS` (có thì thoát mã 1 khi p95 vượt). Giữ hành vi cũ khi không đặt các biến này.
  - `peak.js` — biến môi trường: `BASE` (mặc định `https://knowledge.lunatech.test`), `VIDEO_ID` (video ≥ 6 phút, có 720p và 1080p), `TRANSCODE_ID` (video 1080p ≥ 20 phút để transcode kéo dài suốt bài), `VIEWERS_LAN` (100), `VIEWERS_TUNNEL` (50), `EDITORS` (30), `SEGMENTS` (50 ≈ 5 phút), `HOLD` (`'6m'`). Seed đọc ở init bằng `JSON.parse(open('/load/.seed.json'))`. `options.insecureSkipTLSVerify = true`.
    - `setup()`: `POST /api/v1/videos/${TRANSCODE_ID}/retranscode` bằng `lead`, check 204.
    - Scenario `viewers_lan` (`per-vu-iterations`, VUs `VIEWERS_LAN`, 1 iteration, `maxDuration` = `HOLD` + 2m) và `viewers_tunnel` (tương tự, VUs `VIEWERS_TUNNEL`): mỗi VU dùng token `viewers[i]`, `POST playback` (tag `kind:api`), master, media playlist của `1080p` (LAN) hoặc rendition theo `maxHeight` = `720p` (tunnel), key, rồi lần lượt `SEGMENTS` segment, `sleep(6)` giữa hai segment (tag `kind:segment`, k6 tự theo 302 sang media host). Tunnel gửi kèm mọi request `Cf-Connecting-IP` và `X-Forwarded-For` = `198.51.100.${(vu % 250) + 1}` (mọi VU vẫn từ cùng một IP nguồn); check `maxHeight === 720` cho tunnel, `null` cho LAN.
    - Scenario `editors` (`constant-vus`, `EDITORS`, `HOLD`): liệt kê thư mục gốc workspace, `GET /documents/:id` + `GET /documents/:id/collab-token` một tài liệu của workspace, tìm kiếm, `sleep(5)`; tag `kind:api`.
    - Counter `bad_status` tăng khi status là 429 hoặc ≥ 500.
    - `thresholds`: `bad_status: ['count==0']`, `'http_req_duration{kind:api}': ['p(95)<300']`, `'http_req_duration{kind:segment}': ['p(95)<300']`, `checks: ['rate>0.99']`.
  - `load:peak` trong `backend/package.json`: `docker run --rm --network host --add-host knowledge.lunatech.test:127.0.0.1 --add-host media.knowledge.lunatech.test:127.0.0.1 -v "$PWD/tests/load:/load" -e BASE -e VIDEO_ID -e TRANSCODE_ID -e VIEWERS_LAN -e VIEWERS_TUNNEL -e EDITORS -e SEGMENTS -e HOLD grafana/k6:1.8.1 run /load/peak.js`.

- [ ] **Step 1: Viết `load-seed.ts`, `--token` cho `upload.ts`, mở rộng `load-collab.ts`, `peak.js`, script `load:peak`, dòng `.gitignore`.**

- [ ] **Step 2: Kiểm tra cú pháp và chạy khói trên stack dev** (không phải bài đo):

Run: `cd backend && pnpm typecheck && docker run --rm -v "$PWD/tests/load:/load" grafana/k6:1.8.1 inspect /load/peak.js > /dev/null && echo ok`
Expected: `ok`.

- [ ] **Step 3: Chạy khói trên stack prod ở máy dev** với số nhỏ: `load:seed -- --viewers 4 --editors 2 ...`, upload hai video bằng `upload.ts --api https://knowledge.lunatech.test --token <lead> --ws load-peak` (`NODE_TLS_REJECT_UNAUTHORIZED=0`), rồi `VIEWERS_LAN=2 VIEWERS_TUNNEL=2 EDITORS=2 SEGMENTS=3 HOLD=30s pnpm load:peak`.
Expected: k6 thoát mã 0, mọi check xanh, `bad_status` = 0.

- [ ] **Step 4: Commit** `Mixed peak-hour k6 scenario through Traefik with seeded load users`

---

### Task 12: Chạy bài đo, ghi kết quả, chốt đợt (1.9, phần chạy + mục "Xong đợt 1")

**Files:**
- Modify: `docs/PLAN.md` (thêm mục "Gia cố đợt 1 — ổn định giờ cao điểm (2026-10-30)" sau Phase 8; sửa dòng load test ở Phase 7 dòng ~211 để trỏ tới mục mới)

- [ ] **Step 1: Chuẩn bị dữ liệu thật cỡ đo.** Stack prod ở máy dev (Task 8 Step 3) + `--profile monitoring`. `load:seed -- --viewers 150 --editors 30 --out ../tests/load/.seed.json --yes`; upload video `VIDEO_ID` (1080p, ≥ 6 phút) và `TRANSCODE_ID` (1080p, ≥ 20 phút; file `*.mp4` không vào git), đợi `VIDEO_ID` READY; tạo 6 tài liệu trong `load-peak` (k6 `editors` và collab dùng).

- [ ] **Step 2: Chạy đồng thời collab và k6**

Run (hai terminal, bắt đầu cùng lúc):
`cd backend/apps/collab && NODE_TLS_REJECT_UNAUTHORIZED=0 API=https://knowledge.lunatech.test SEED_FILE=../../tests/load/.seed.json CLIENTS=30 DOCS=6 SECONDS=360 P95_MAX_MS=50 pnpm load`
`cd backend && VIDEO_ID=… TRANSCODE_ID=… pnpm load:peak`
Expected: collab in p95 < 50 ms và thoát mã 0; k6 mọi threshold xanh (`bad_status` 0, API p95 < 300 ms, segment p95 < 300 ms). Trong lúc chạy, Grafana cho thấy `queue_jobs{queue="video-transcode",state="active"}` = 1 suốt bài và ghi lại đỉnh CPU/RAM host, CPU worker, event-loop lag api.

- [ ] **Step 3: Nếu một ngưỡng trượt**, không nới ngưỡng: dùng skill `superpowers:systematic-debugging`, sửa nguyên nhân trong phạm vi đợt 1 (kèm test), chạy lại Step 2.

- [ ] **Step 4: Ghi PLAN.md** mục mới gồm: danh sách 1.1–1.9 đã xong (checkbox `[x]`); bảng kết quả (cấu hình máy dev thực tế từ `lscpu`/`free -g`, số VU từng nhóm, tổng request, `bad_status`, API p95, segment p95, collab p95/max, thời gian transcode trong bài, đỉnh CPU/RAM host, băng thông đỉnh); dòng in đậm "Đo trên máy dev với prod compose, giả định server 8 core / 32 GB — chỉ để tham khảo"; mục mở `- [ ] Chạy lại kịch bản peak (tests/load/peak.js + load-collab) trên server thật, k6 chạy từ một máy khác trong LAN; chỉnh cpus/mem_limit trong docker-compose.prod.yml và DEPLOY.md theo cấu hình thật.`; mục mở `- [ ] Chọn kênh gửi cảnh báo (Alertmanager/Telegram/email) cho các luật trong docker/monitoring/alerts.yml.`

- [ ] **Step 5: Cổng chất lượng của đợt**

Run: `cd backend && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` rồi (với `pnpm dev` đang chạy) `pnpm test:http`; `cd ../frontend && pnpm lint && pnpm typecheck && pnpm build`
Expected: tất cả thoát mã 0. `grep -rnE "^\s*(//|/\*)" $(git diff --name-only main -- '*.ts' '*.tsx' '*.js')` không in gì (không có comment).

- [ ] **Step 6: Dọn dữ liệu load** `pnpm test:cleanup` trên DB prod máy dev (xoá user `load.%`) rồi commit `Record wave 1 peak-hour load test results`.
