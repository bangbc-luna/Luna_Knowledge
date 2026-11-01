# Đợt 3: Tái cấu trúc kiến trúc — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gom các đoạn logic đang lặp và đã lệch nhau vào vài module sâu (`NodeTree`, `ObjectStore`, ghi audit, payload queue có kiểu, `DocumentAssets`, `HlsSessions`) và sinh kiểu FE từ OpenAPI. Hành vi và response API giữ nguyên.

**Architecture:** Làm từ dưới lên. Phần dùng chung đi trước: `writeAudit` + `AuditAction` trong `@luna/db`, `JobPayloads` + hàm enqueue trong `@luna/shared`, `ObjectStore` trong `@luna/shared`. Sau đó là các việc nhỏ ở API mà `NodeTree` sẽ dùng: `requireNode(..., { types })`, `mapUnique`, cột trạng thái user trong `accessColumns`. Tiếp theo tách `DocumentAssets` và `HlsSessions`. `NodeTree` làm sau cùng ở backend: trước tiên viết test chốt hành vi hiện tại, sau đó chuyển các đường tạo mục, rồi tới move và restore. Phần FE làm cuối: xuất OpenAPI ra kiểu TS, rồi cho `types.ts` thành alias của kiểu sinh ra. Mỗi task để hệ thống xanh khi xong.

**Tech Stack:** NestJS 12 (ESM), Prisma 7 + `@prisma/adapter-pg`, PostgreSQL 16 + ltree, BullMQ 6, Hocuspocus, `@aws-sdk/client-s3` v3 (MinIO), zod 4 (`z.toJSONSchema`), `@nestjs/swagger`, `openapi-typescript` 7 (pin bản chính xác), Next.js 16, Vitest + testcontainers.

**Spec:** `docs/superpowers/specs/2026-10-30-hardening-design.md`, mục 7 "Đợt 3" (3.1–3.6), cùng ràng buộc ở mục 2 và 3.

## Global Constraints

- Không viết comment trong code mới hay code sửa (TS, TSX, script). Đây là quy ước của chủ dự án. File sinh ra (`frontend/src/lib/api-schema.ts`) cũng không được có comment (Task 11 bỏ description trước khi sinh).
- Không đổi hành vi, không đổi response API (status, body, message lỗi, header). Phản mục tiêu ở spec mục 2: "Đợt 3 (tái cấu trúc) làm hỏng test e2e hiện có hoặc thay đổi response API". Test e2e hiện có không được sửa assertion. Chỉ được sửa phần setup khi một symbol bị đổi tên/chuyển chỗ (ví dụ `ctx.app.get(S3)` → `ctx.app.get(ObjectStore).s3`).
- Không có migration Prisma nào trong đợt này. `schema.prisma` giữ nguyên.
- Làm trên branch `refactor/wave3-architecture` (đã tách từ `main` 5d8b8a9). Mỗi task commit riêng; mỗi mục 3.x có commit riêng. Lệnh git chạy ở gốc repo `Luna_Knowledge`, lệnh pnpm backend chạy trong `backend/`, lệnh pnpm FE chạy trong `frontend/`.
- Mỗi task backend chỉ coi là xong khi lệnh sau xanh (CI có chạy `format:check`): `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm test:e2e`.
- Sau khi sửa `packages/db` hoặc `packages/shared`, build lại trước khi chạy vitest riêng một app: `pnpm turbo run build --filter=@luna/db --filter=@luna/shared`.
- Task nào chạm FE thì thêm `pnpm lint && pnpm typecheck && pnpm build` trong `frontend/`. Kiểm trên trình duyệt qua dev quick login `http://localhost:5173/?as=<email>`.
- Không sửa `backend/.env`.
- Khoá cây giữ đúng như đợt 2: khoá advisory nằm trong cùng transaction với lệnh ghi; `lock_timeout` 5000 ms → 503 `Someone else is changing this workspace right now, try again in a moment`; LT001 → 409 `The target folder was just moved or deleted, refresh and try again`; không gọi S3, collab hay mạng khi đang giữ khoá.
- Tên test viết tiếng Việt như các test hiện có, identifier viết tiếng Anh. Commit message là một câu tiếng Anh, không có tiền tố kiểu `feat:`.

## Review Focus

- Sao chép hoặc import .docx lỗi giữa chừng (chép asset S3 lỗi, mammoth lỗi). Mục vừa tạo phải bị xoá, không có dòng audit, không vào hàng đợi index, và lỗi trả về giống hệt hiện nay (copy ném lại lỗi gốc, import trả 415). Test: "fill lỗi: xoá mục vừa tạo, không ghi audit, ném lại đúng lỗi" (Task 9).
- Tải video lên gốc khu VIDEOS, trùng tên với một mục ở gốc DOCS. Không được báo 409. Trùng tên trong gốc VIDEOS thì gợi ý tính theo các mục trong VIDEOS. Test ở Task 8.
- Không gọi I/O mạng khi đang giữ khoá cây. Lúc `fill` (chép asset, chuyển .docx) đang chạy, một transaction khác vẫn lấy được khoá của workspace. Test: "fill chạy sau khi đã nhả khoá cây" (Task 9).
- Người dùng bị khoá tài khoản nhưng còn token phiên xem hoặc link tải. Vẫn trả đúng 404 với message như hiện nay, sau khi việc kiểm tra `users.status` đã gộp vào `accessColumns`. Test ở Task 5.
- Kiểu FE sinh từ OpenAPI. Field ngày phải ra `string` chứ không phải `unknown`. Field FE dựa vào (`contentJson`, `metadata`) vẫn giữ kiểu cũ. `openapi:check` phải fail khi schema zod đổi mà chưa sinh lại. Test ở Task 11, kiểm tay ở Task 12.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/packages/db/src/audit.ts` | `AUDIT_ACTIONS`, `AuditAction`, `AuditRecord`, `writeAudit` |
| `backend/packages/shared/src/jobs.ts` | `JobPayloads`, `JobName`, `JobQueue`, `QueueJob`, các hàm `enqueue*`, tuỳ chọn job mặc định |
| `backend/packages/shared/src/object-store.ts` | `ObjectStore` (S3 API là interface), `contentDisposition` |
| `backend/apps/api/src/common/errors/map-unique.ts` | `mapUnique` |
| `backend/apps/api/src/content/node-tree.service.ts` | `NodeTree`: create, move, restore, withLock, mapConflict |
| `backend/apps/api/src/documents/document-assets.service.ts` | `DocumentAssets`, `remapAssets` |
| `backend/apps/api/src/videos/hls-sessions.service.ts` | `HlsSessions`: mở phiên, playlist, segment, khoá |
| `backend/apps/api/src/openapi/render-types.ts` | `stripDocs`, `renderTypes` (OpenAPI → TS, không comment) |
| `backend/apps/api/src/openapi/export.ts` | CLI `--write` / `--check` |
| `frontend/src/lib/api-schema.ts` | Kiểu sinh tự động (không sửa tay) |
| `frontend/src/lib/api-types.ts` | `ApiOk<P, M>` |
| Xoá: `backend/packages/shared/src/storage/*`, `backend/apps/api/src/files/storage.service.ts`, `backend/apps/worker/src/infra/storage.provider.ts`, `backend/apps/collab/src/index-queue.ts` | Thay bằng module mới |

Theo từ vựng codebase-design:

- `NodeTree` là module sâu. Interface có 5 method nhưng phía sau là: kiểm tra container, luật section, chuẩn hoá tên, tự đổi tên, khoá + timeout, map LT001/P2002, rollback khi `fill` lỗi, audit, index. Seam nằm ở interface Nest provider và test đi qua chính seam đó. Không có adapter thứ hai, nên không thêm interface/port nào.
- `ObjectStore`: hiện `BlobStorage` chỉ có một adapter, tức là seam giả định. Bỏ seam đó và coi S3 API là interface (MinIO/R2/S3 đều nói S3). `ObjectStore` chỉ giữ những thao tác có chiều sâu thật: upload nhiều phần từ file, xoá theo prefix, ký URL kèm content-disposition. Lệnh S3 đơn lẻ (multipart session, HeadBucket) vẫn gọi `store.s3.send` vì S3Client chính là interface.
- Deletion test cho `writeAudit` và `JobPayloads`: nếu xoá đi thì tên action và hình payload lại rải ra 3 app. Vì vậy hai module này đáng giữ dù nhỏ.

---

### Task 1: Ghi audit một chỗ và union `AuditAction` (3.3)

**Files:**
- Create: `backend/packages/db/src/audit.ts`; Modify: `backend/packages/db/src/index.ts` (export)
- Modify: `backend/apps/api/src/audit/audit.service.ts:10-72`
- Modify: `backend/apps/collab/src/server.ts:140-156` (khối `prisma.auditLog.create` trong `autoVersion`)
- Modify (đổi `action: string` → `AuditAction`): `backend/apps/api/src/content/shares.service.ts:161-180` (`auditShare`), `backend/apps/api/src/content/library.service.ts` (`auditTag`), `backend/apps/api/src/workspaces/workspaces.service.ts:347-366` (`auditMember`), `backend/apps/api/src/content/nodes.service.ts:20-39` (`ACTIVITY_ACTIONS: readonly AuditAction[]`)
- Test: `backend/apps/api/src/audit/audit.service.spec.ts`

**Interfaces:**
- Produces:
  - `AUDIT_ACTIONS` (mảng `as const`, đúng 46 giá trị đang dùng): `auth.login`, `auth.login_failed`, `auth.logout`, `auth.session_revoked`, `comment.create`, `comment.delete`, `comment.reply`, `comment.resolve`, `comment.reopen`, `document.copy`, `document.edit`, `document.export`, `document.import`, `document.version_create`, `document.version_restore`, `file.download`, `file.regenerate`, `file.upload`, `file.version_restore`, `node.create`, `node.delete_permanent`, `node.move`, `node.rename`, `node.restore`, `node.trash`, `node.view`, `share.add`, `share.remove`, `share.update`, `tag.create`, `tag.delete`, `tag.update`, `trash.empty`, `upload.abort`, `upload.start`, `user.update`, `video.original_access`, `video.play`, `video.retranscode`, `video.update_info`, `workspace.create`, `workspace.delete`, `workspace.member_add`, `workspace.member_remove`, `workspace.member_update`, `workspace.update`. Đây là audit action, khác với loại thông báo (`comment.mention`, `comment.new`, `share.added`, `video.ready`, `video.failed`); loại thông báo không đưa vào.
  - `type AuditAction = (typeof AUDIT_ACTIONS)[number]`
  - `interface AuditRecord { actorId: string | null; action: AuditAction; targetType?: string; targetId?: string; workspaceId?: string; metadata?: Prisma.InputJsonValue; ip?: string | null; userAgent?: string | null }`
  - `writeAudit(db: Pick<PrismaClient, 'auditLog'>, record: AuditRecord): Promise<void>`: một lệnh `auditLog.create`, lỗi thì ném ra (người gọi quyết định nuốt lỗi hay không). App role `luna_app` chỉ có INSERT nên hàm chỉ được tạo, không update.
  - `AuditEntry.action: AuditAction`. `AuditService.log` = `writeAudit(prisma.client, { ...entry, ip: ctx?.ip, userAgent: ctx?.userAgent })` bọc try/catch, giữ log lỗi `'Failed to write audit log'`.

- [ ] **Step 0: Chốt baseline xanh trước khi đụng code**

Run (trong `backend/`): `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: PASS. Đỏ ở đây là lỗi có sẵn: ghi lại và báo người giao việc, không sửa trong task này.

- [ ] **Step 1: Viết test unit cho `AuditService` (đỏ)**

```ts
describe('AuditService', () => {
  it('ghi qua writeAudit kèm ip và user agent của request', async () => {
    const create = vi.fn().mockResolvedValue({});
    const svc = new AuditService({ client: { auditLog: { create } } } as never, {} as never);
    await svc.log({ actorId: 'u1', action: 'node.create', targetType: 'node', targetId: 'n1', workspaceId: 'w1', metadata: { a: 1 }, ctx: { ip: '10.0.0.1', userAgent: 'ua' } });
    expect(create).toHaveBeenCalledWith({ data: { actorId: 'u1', action: 'node.create', targetType: 'node', targetId: 'n1', workspaceId: 'w1', metadata: { a: 1 }, ip: '10.0.0.1', userAgent: 'ua' } });
  });
  it('DB lỗi thì nuốt lỗi, không ném ra', async () => {
    const create = vi.fn().mockRejectedValue(new Error('down'));
    const svc = new AuditService({ client: { auditLog: { create } } } as never, {} as never);
    await expect(svc.log({ actorId: null, action: 'auth.login_failed' })).resolves.toBeUndefined();
  });
  it('AuditAction chỉ nhận action đã khai báo', () => {
    expectTypeOf<'node.create'>().toMatchTypeOf<AuditAction>();
    expectTypeOf<'node.bogus'>().not.toMatchTypeOf<AuditAction>();
  });
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run src/audit/audit.service.spec.ts`
Expected: FAIL, do chưa có `AuditAction` export từ `@luna/db`.

- [ ] **Step 3: Implement `audit.ts`, đưa `AuditService.log` qua `writeAudit`, đổi kiểu `action` ở 3 hàm bọc và `ACTIVITY_ACTIONS`**

- [ ] **Step 4: Collab dùng `writeAudit(prisma, { actorId: createdById, action: 'document.edit', ... })`, giữ `.catch((err) => logger.error({ err, nodeId }, 'Could not write edit log'))`**

- [ ] **Step 5: Build package, chạy test unit và test e2e của collab**

Run: `pnpm turbo run build --filter=@luna/db && pnpm --filter @luna/api exec vitest run src/audit/audit.service.spec.ts && pnpm --filter @luna/collab exec vitest run --config ./vitest.config.e2e.ts`
Expected: PASS. Test collab ở `server.e2e-spec.ts:518` (dòng `document.edit`) vẫn xanh. `pnpm typecheck` bắt được mọi action viết sai chính tả.

- [ ] **Step 6: Chạy gate backend, commit**

```bash
git add backend/packages/db/src backend/apps/api/src backend/apps/collab/src
git commit -m "Write audit logs through one typed function shared by api and collab"
```

---

### Task 2: Payload queue có kiểu và hàm enqueue dùng chung (3.2)

**Files:**
- Create: `backend/packages/shared/src/jobs.ts`, `backend/packages/shared/src/jobs.spec.ts`; Modify: `backend/packages/shared/src/index.ts`, `backend/packages/shared/src/constants.ts:18-53` (chuyển `ProcessUploadJob`, `TranscodeJob`, `RegenerateJob`, `transcodeJobOptions`, `transcodePriority` sang `jobs.ts`), `backend/packages/shared/src/search.ts:7-12` (`SEARCH_JOBS` giữ nguyên giá trị, `jobs.ts` dùng lại), `backend/packages/shared/package.json` (thêm `"bullmq": "^6.0.0"` vào dependencies, chỉ import type)
- Modify (producer): `backend/apps/api/src/infra/queue/search-queue.service.ts`, `backend/apps/api/src/files/uploads.service.ts:268-274`, `backend/apps/api/src/files/files.service.ts:281-290`, `backend/apps/api/src/files/transcode-queue.service.ts`, `backend/apps/api/src/content/trash.service.ts:167-181`, `backend/apps/collab/src/server.ts:33,348`, `backend/apps/worker/src/processors/file-process.processor.ts:103-107,218-222`
- Modify (consumer): `backend/apps/worker/src/processors/{search-index,file-process,video-transcode,maintenance,system}.processor.ts` (hàm `process`)
- Delete: `backend/apps/collab/src/index-queue.ts`; Modify: `backend/apps/collab/test/server.e2e-spec.ts:29` (import từ `@luna/shared`)

**Interfaces:**
- Produces (từ `@luna/shared`):
  - `interface JobPayloads { 'file-process': { 'process-upload': ProcessUploadJob; regenerate: RegenerateJob }; 'video-transcode': { transcode: TranscodeJob }; 'search-index': { 'index-node': { nodeId: string }; 'index-tree': { nodeId: string }; 'drop-workspace': { workspaceId: string }; 'reindex-all': Record<string, never> }; maintenance: { 'purge-trash': Record<string, never>; retention: Record<string, never>; 'clean-uploads': Record<string, never>; 'blob-gc': Record<string, never> }; system: { ping: Record<string, never> } }`. Key phải trùng giá trị `QUEUES`/`JOBS`/`SEARCH_JOBS`.
  - `type JobQueueName = keyof JobPayloads`; `type JobName<Q extends JobQueueName> = keyof JobPayloads[Q] & string`
  - `type QueueJob<Q> = { [N in JobName<Q>]: { name: N; data: JobPayloads[Q][N] } }[JobName<Q>]`: union có discriminant dùng trong processor.
  - `interface JobQueue<Q> { add<N extends JobName<Q>>(name: N, data: JobPayloads[Q][N], opts?: JobsOptions): Promise<unknown>; addBulk(jobs: Array<{ [N in JobName<Q>]: { name: N; data: JobPayloads[Q][N]; opts?: JobsOptions } }[JobName<Q>]>): Promise<unknown> }`. BullMQ `Queue` gán thẳng vào được. Nếu tsc từ chối thì thêm `asJobQueue<Q>(queue: Queue): JobQueue<Q>`.
  - `SEARCH_JOB_OPTS = { removeOnComplete: true, removeOnFail: 100 }`; `FILE_JOB_OPTS = { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 }`
  - `enqueueIndexNode(queue: JobQueue<'search-index'>, nodeId: string, opts?: { debounceMs?: number }): Promise<void>`. Có `debounceMs` thì thêm `delay: debounceMs, deduplication: { id: \`index-node-${nodeId}\`, ttl: debounceMs }` (đúng như collab hiện nay).
  - `enqueueFileJob<N extends JobName<'file-process'>>(queue: JobQueue<'file-process'>, name: N, data: JobPayloads['file-process'][N], jobId?: string): Promise<void>`: dùng `FILE_JOB_OPTS`, có `jobId` thì thêm vào.
  - `enqueueTranscode(queue: JobQueue<'video-transcode'>, job: TranscodeJob, sizeBytes: number | bigint, jobId?: string): Promise<void>`: dùng `transcodeJobOptions(sizeBytes, jobId)`.
- Không đổi gì về hành vi: tên job, payload, option và `jobId` (`upload-${uploadId}`, `transcode-${uploadId}`, `reindex-all-manual`, `blob-gc-now`) giữ nguyên từng byte. Nhánh `default` của từng processor giữ như cũ: search trả `{ skipped: job.name }`, các processor khác ném `Unknown job "<name>" on queue <queue>`.

- [ ] **Step 1: Viết test cho các hàm enqueue (đỏ)**

```ts
const fakeQueue = () => { const add = vi.fn().mockResolvedValue({}); return { add, addBulk: vi.fn() }; };
it('enqueueIndexNode không debounce: option mặc định của search', async () => {
  const q = fakeQueue(); await enqueueIndexNode(q, 'n1');
  expect(q.add).toHaveBeenCalledWith('index-node', { nodeId: 'n1' }, { removeOnComplete: true, removeOnFail: 100 });
});
it('enqueueIndexNode có debounce: delay và dedup theo nodeId', async () => {
  const q = fakeQueue(); await enqueueIndexNode(q, 'n1', { debounceMs: 1500 });
  expect(q.add).toHaveBeenCalledWith('index-node', { nodeId: 'n1' }, { delay: 1500, deduplication: { id: 'index-node-n1', ttl: 1500 }, removeOnComplete: true, removeOnFail: 100 });
});
it('enqueueFileJob process-upload giữ jobId và retry 3 lần', async () => {
  const q = fakeQueue(); await enqueueFileJob(q, 'process-upload', { uploadId: 'u1' }, 'upload-u1');
  expect(q.add).toHaveBeenCalledWith('process-upload', { uploadId: 'u1' }, { jobId: 'upload-u1', attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 });
});
it('enqueueTranscode ưu tiên theo dung lượng', async () => {
  const q = fakeQueue(); await enqueueTranscode(q, { nodeId: 'n', versionId: 'v' }, 120 * 1024 * 1024, 'transcode-v');
  expect(q.add).toHaveBeenCalledWith('transcode', { nodeId: 'n', versionId: 'v' }, transcodeJobOptions(120 * 1024 * 1024, 'transcode-v'));
});
it('payload sai kiểu bị tsc chặn', () => {
  expectTypeOf(enqueueFileJob<'regenerate'>).parameter(2).toEqualTypeOf<RegenerateJob>();
  expectTypeOf<JobName<'maintenance'>>().toEqualTypeOf<'purge-trash' | 'retention' | 'clean-uploads' | 'blob-gc'>();
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/shared exec vitest run src/jobs.spec.ts`
Expected: FAIL, do chưa có `./jobs.js`.

- [ ] **Step 3: Implement `jobs.ts` và export từ index**

- [ ] **Step 4: Đổi producer sang `JobQueue<Q>` và các hàm `enqueue*`; xoá `apps/collab/src/index-queue.ts`, collab gọi `enqueueIndexNode(searchQueue, nodeId, { debounceMs: config.COLLAB_INDEX_DELAY_MS })`**

- [ ] **Step 5: Cho `switch` trong processor chạy trên `const j = job as unknown as QueueJob<'<queue>'>`, bỏ hết `job.data as ...`**

- [ ] **Step 6: Build package, chạy test**

Run: `pnpm turbo run build --filter=@luna/shared && pnpm --filter @luna/shared exec vitest run src/jobs.spec.ts && pnpm --filter @luna/worker exec vitest run --config ./vitest.config.e2e.ts && pnpm --filter @luna/collab exec vitest run --config ./vitest.config.e2e.ts`
Expected: PASS. Test dedup của collab ở `server.e2e-spec.ts:196-203` vẫn xanh.

- [ ] **Step 7: Chạy gate backend, commit**

```bash
git add backend/packages/shared backend/apps backend/pnpm-lock.yaml
git commit -m "Type queue payloads in one JobPayloads map and share enqueue helpers across api, worker and collab"
```

---

### Task 3: Một `ObjectStore`, S3 API là interface (3.4)

**Files:**
- Create: `backend/packages/shared/src/object-store.ts`, `backend/packages/shared/src/object-store.spec.ts`
- Delete: `backend/packages/shared/src/storage/{blob-storage,s3-storage,index}.ts`; Modify: `backend/packages/shared/src/index.ts`, `backend/packages/shared/package.json` (thêm `"@aws-sdk/s3-request-presigner": "^3.1150.0"`)
- Modify: `backend/apps/api/src/infra/s3/s3.module.ts` (provide `ObjectStore`; bỏ token `S3`, `S3_PRESIGN`, `BUCKETS`)
- Delete: `backend/apps/api/src/files/storage.service.ts`; Modify: `backend/apps/api/src/files/files.module.ts` (bỏ `StorageService`)
- Modify (caller api): `files/files.service.ts`, `files/uploads.service.ts`, `files/files.controller.ts:46,56`, `documents/documents.service.ts`, `documents/documents.controller.ts:33,146`, `videos/videos.service.ts`, `videos/videos.controller.ts:39,270`, `videos/admin-videos.service.ts:100`, `health/infra.health.ts:27-60`
- Delete: `backend/apps/worker/src/infra/storage.provider.ts`; Modify: `backend/apps/worker/src/worker.module.ts:14,63`, `processors/{file-process,video-transcode,maintenance}.processor.ts`, `processors/maintenance.processor.spec.ts:6,25`
- Modify (chỉ setup test): `backend/apps/api/test/{uploads,documents,videos}.e2e-spec.ts` (`ctx.app.get(S3)` → `ctx.app.get(ObjectStore).s3`, `BUCKETS` → `.buckets`)

**Interfaces:**
- Produces (từ `@luna/shared`):
  - `interface ObjectRef { container: string; key: string }` (một dòng `Blob` thoả interface này về cấu trúc); `interface StoredObject extends ObjectRef { provider: 'S3' }`
  - `interface PresignGetOptions { expiresInSec: number; contentType?: string; disposition?: 'inline' | { type: 'inline' | 'attachment'; fileName: string }; cacheControl?: string }`
  - `class ObjectStore`:
    - `constructor(env: S3Env, clients?: { s3?: S3Client; presigner?: S3Client })`. Mặc định dùng `createS3Client(env)` và `createPresignClient(env)`.
    - `readonly s3: S3Client`, `readonly buckets: Record<BucketKey, string>`
    - `putFile(bucket: BucketKey, key: string, localPath: string, contentType: string): Promise<StoredObject>`: dùng `Upload` của lib-storage với `partSize` 16 MiB, `queueSize` 4, `ContentLength` lấy từ `stat`.
    - `putBuffer(bucket: BucketKey, key: string, body: Buffer, contentType: string): Promise<StoredObject>`
    - `copy(from: ObjectRef, bucket: BucketKey, key: string): Promise<StoredObject>`: `CopySource: \`${from.container}/${from.key}\``
    - `getStream(ref: ObjectRef): Promise<{ body: Readable; size?: number }>`
    - `delete(ref: ObjectRef): Promise<void>`: key kết thúc bằng `/` thì liệt kê theo prefix và xoá theo trang bằng `DeleteObjects` (`Quiet: true`), như `S3BlobStorage.delete` hiện tại.
    - `presignGet(ref: ObjectRef, opts: PresignGetOptions): Promise<{ url: string; expiresAt: Date }>`: ký bằng presigner (endpoint công khai). Disposition dạng object thì dùng `contentDisposition(type, fileName)`.
    - `presignUploadPart(ref: ObjectRef, uploadId: string, partNumber: number, expiresInSec: number): Promise<string>`
    - `destroy(): void`
  - `contentDisposition(type: 'inline' | 'attachment', fileName: string): string`: chuyển nguyên văn từ `storage.service.ts:9-17`.
- Giá trị phải giữ: URL preview/thumbnail/poster/sprite/asset ký `expiresInSec: 600`, `cacheControl: 'private, max-age=600'`, disposition `inline` mặc định. URL segment HLS ký `expiresInSec: 120`, `contentType: 'video/mp2t'`, `disposition: 'inline'` (chuỗi thô), `cacheControl: 'private, max-age=60'`. URL part upload ký `3600` giây.
- Các lệnh multipart (`CreateMultipartUpload`, `ListParts`, `CompleteMultipartUpload`, `AbortMultipartUpload`) và `HeadBucket` ở health vẫn gọi `store.s3.send(new …Command({ Bucket: store.buckets.tmp, … }))`.
- Bỏ nhánh `forRef`/`provider`. Mọi blob đều được đọc qua `ObjectStore`. Cột `blobs.provider` vẫn được ghi `'S3'` (lấy từ `StoredObject.provider`).

- [ ] **Step 1: Viết test unit cho `ObjectStore` (đỏ)**

```ts
const env = { S3_ENDPOINT: 'http://minio:9000', S3_PUBLIC_ENDPOINT: 'http://media.test', S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: true, S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's', S3_BUCKET_TMP: 'tmp', S3_BUCKET_HLS: 'hls', S3_BUCKET_PREVIEWS: 'pv', S3_BUCKET_THUMBNAILS: 'th', S3_BUCKET_ASSETS: 'as', S3_BUCKET_ORIGINALS: 'or' } as S3Env;
it('presignGet ký bằng endpoint công khai, kèm disposition hai dạng và cache 600 giây', async () => {
  const store = new ObjectStore(env, { s3: { send: vi.fn() } as never });
  const { url, expiresAt } = await store.presignGet({ container: 'pv', key: 'a/b' }, { expiresInSec: 600, contentType: 'application/pdf', disposition: { type: 'attachment', fileName: 'Báo cáo.pdf' }, cacheControl: 'private, max-age=600' });
  expect(url.startsWith('http://media.test/pv/a/b?')).toBe(true);
  expect(url).toContain('X-Amz-Expires=600');
  expect(decodeURIComponent(url)).toContain(`attachment; filename="Bao cao.pdf"; filename*=UTF-8''B%C3%A1o%20c%C3%A1o.pdf`);
  expect(Math.abs(expiresAt.getTime() - Date.now() - 600_000)).toBeLessThan(2000);
});
it('delete key thường gửi đúng một DeleteObjectCommand', async () => { /* send nhận DeleteObjectCommand { Bucket: 'or', Key: 'x' } */ });
it('delete prefix xoá theo trang cho tới khi hết', async () => { /* ListObjectsV2 trả 2 trang (IsTruncated + NextContinuationToken) → DeleteObjectsCommand gọi 2 lần, Quiet: true */ });
it('copy dùng CopySource container/key và trả provider S3', async () => { /* expect(result).toEqual({ provider: 'S3', container: 'as', key: 'docs/n/1' }) */ });
it('contentDisposition bỏ dấu và ký tự cấm cho filename ASCII', () => {
  expect(contentDisposition('attachment', 'Đơn "x".pdf')).toBe(`attachment; filename="Don _x_.pdf"; filename*=UTF-8''${encodeURIComponent('Đơn "x".pdf')}`);
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/shared exec vitest run src/object-store.spec.ts`
Expected: FAIL, do chưa có `./object-store.js`.

- [ ] **Step 3: Implement `object-store.ts`, xoá `storage/`, export từ index**

- [ ] **Step 4: API: `S3Module` provide `{ provide: ObjectStore, inject: [APP_CONFIG], useFactory: (c) => new ObjectStore(c) }`, `onModuleDestroy` gọi `store.destroy()`; caller đổi sang `ObjectStore`; xoá `StorageService`**

- [ ] **Step 5: Worker: provide `ObjectStore` từ `WORKER_CONFIG`; processor đổi `storage.originals.putFile` → `store.putFile('originals', …)`, `storage.bucket(b).putFile` → `store.putFile(b, …)`, `forRef(x).delete/getStream` → `store.delete/getStream`; xoá `storage.provider.ts`**

- [ ] **Step 6: Sửa setup của các e2e đang lấy `S3`/`BUCKETS`, giữ nguyên assertion. `vi.spyOn(store.s3, 'send')` ở `uploads.e2e-spec.ts:226` vẫn chạy được vì `s3` là cùng một client**

- [ ] **Step 7: Build, chạy test**

Run: `pnpm turbo run build --filter=@luna/shared && pnpm --filter @luna/shared exec vitest run && pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/uploads.e2e-spec.ts test/documents.e2e-spec.ts test/videos.e2e-spec.ts && pnpm --filter @luna/worker exec vitest run --config ./vitest.config.e2e.ts`
Expected: PASS.

- [ ] **Step 8: Kiểm không còn đường vòng; chạy gate; commit**

Run: `grep -rn "BlobStorage\|forRef\|S3_PRESIGN\|StorageService" apps packages --include=*.ts | grep -v dist/`
Expected: không có dòng nào.

```bash
git add backend/packages/shared backend/apps backend/pnpm-lock.yaml
git commit -m "Replace the single-adapter BlobStorage seam with one ObjectStore shared by api and worker"
```

---

### Task 4: `requireNode(..., { types })` và `mapUnique` (3.6)

**Files:**
- Modify: `backend/apps/api/src/content/content-access.service.ts:85-103`
- Modify: `backend/apps/api/src/documents/documents.service.ts:265-267,358-362` (bỏ `requireDocument`, `importDocx` dùng `AS_FILE_ONLY`), `documents/versions.service.ts`, `documents/comments.service.ts` (gọi `access.requireNode(..., AS_DOCUMENT)`)
- Modify: `backend/apps/api/src/videos/videos.service.ts:320-324` (bỏ `requireVideo`), `backend/apps/api/src/files/files.service.ts:343-347` (bỏ `requireFile`), `backend/apps/api/src/content/nodes.service.ts:255-256` (`updateDetails` dùng `{ types: [type] }`)
- Create: `backend/apps/api/src/common/errors/map-unique.ts`, `backend/apps/api/src/common/errors/map-unique.spec.ts`
- Modify: `backend/apps/api/src/content/shares.service.ts:94-100`, `workspaces/workspaces.service.ts:117-122,207-212`, `content/library.service.ts:196-205` (`withTagConflict` đổi thành gọi `mapUnique`)
- Test: `backend/apps/api/test/node-types.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `requireNode(user: Pick<AuthenticatedUser, 'id'>, nodeId: string, min: ContentRole, opts?: { allowDeleted?: boolean; types?: readonly NodeType[]; notFound?: string }): Promise<NodeAccess & { role: ContentRole }>`. Thứ tự kiểm giữ như các hàm bọc cũ: tồn tại/xoá → quyền (403) → loại (404 với `opts.notFound ?? 'Item not found'`).
  - Hằng số export từ `content-access.service.ts`: `AS_DOCUMENT = { types: ['DOCUMENT'], notFound: 'Document not found' }`, `AS_VIDEO = { types: ['VIDEO'], notFound: 'Video not found' }`, `AS_FILE = { types: ['FILE', 'VIDEO'], notFound: 'File not found' }`, `AS_FILE_ONLY = { types: ['FILE'], notFound: 'File not found' }` (tất cả `as const`).
  - `mapUnique<T>(fn: () => Promise<T>, message: string): Promise<T>`: bắt lỗi `PrismaClientKnownRequestError` có `code === 'P2002'` và ném `AppError.conflict(message)`; lỗi khác ném lại nguyên instance. Message giữ nguyên văn: `'This item is already shared with this user; update the role instead'`, `` `Slug "${body.slug}" is already taken` ``, `'User is already a member of this workspace'`, `'A tag with this name already exists in this workspace'`.

- [ ] **Step 1: Viết test chốt hành vi khi gọi sai loại mục (chạy trên code hiện tại phải xanh ngay)**

```ts
it.each([
  ['GET', '/api/v1/documents/:folder', 404, 'Document not found'],
  ['GET', '/api/v1/videos/:doc', 404, 'Video not found'],
  ['GET', '/api/v1/files/:folder', 404, 'File not found'],
  ['POST', '/api/v1/files/:doc/convert-to-document', 404, 'File not found'],
  ['PATCH', '/api/v1/videos/:doc', 404, 'Item not found'],
])('%s %s sai loại → %d %s', async (method, path, status, message) => { /* editor gọi; expect status và res.body.error.message */ });
it('người chỉ xem gọi route cần EDITOR trên mục sai loại: 403 trước 404', async () => {
  /* viewer PATCH /api/v1/videos/:doc { title, description } → 403 'You only have view access to this item' */
});
```

- [ ] **Step 2: Chạy, xác nhận xanh trên code cũ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/node-types.e2e-spec.ts`
Expected: PASS. Nếu FAIL thì test hiểu sai hành vi hiện tại: sửa test, không sửa code.

- [ ] **Step 3: Viết test `mapUnique` (đỏ)**

```ts
const p2002 = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7' });
it('P2002 → 409 với message cho trước', async () => {
  await expect(mapUnique(() => Promise.reject(p2002()), 'Taken')).rejects.toMatchObject({ status: 409, message: 'Taken' });
});
it('lỗi khác ném lại đúng instance', async () => { const e = new Error('x'); await expect(mapUnique(() => Promise.reject(e), 'T')).rejects.toBe(e); });
it('thành công trả giá trị', async () => { await expect(mapUnique(async () => 7, 'T')).resolves.toBe(7); });
```

Run: `pnpm --filter @luna/api exec vitest run src/common/errors/map-unique.spec.ts`
Expected: FAIL, do chưa có module. Thuộc tính status của `AppError` lấy theo `app-error.ts`; nếu không phải `status` thì chỉnh assertion cho khớp.

- [ ] **Step 4: Implement `mapUnique` và option `types`/`notFound`; xoá 3 hàm bọc; đổi 4 chỗ bắt P2002**

- [ ] **Step 5: Chạy test, gate, commit**

Run: `pnpm --filter @luna/api exec vitest run src/common/errors/map-unique.spec.ts && pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/node-types.e2e-spec.ts test/workspaces.e2e-spec.ts test/content.e2e-spec.ts test/documents.e2e-spec.ts test/videos.e2e-spec.ts`
Expected: PASS.

```bash
git add backend/apps/api/src backend/apps/api/test/node-types.e2e-spec.ts
git commit -m "Check node types inside requireNode and map unique violations through one helper"
```

---

### Task 5: Gộp kiểm tra `users.status` vào `accessColumns` (3.6)

**Files:**
- Modify: `backend/packages/db/src/access.ts:14-39`, `backend/packages/db/src/documents.ts:13-39` (`resolveDocumentAccess` bỏ `JOIN users … ACTIVE`)
- Modify: `backend/apps/api/src/content/content-access.service.ts` (`AccessRow.user_active`, `NodeAccess.userActive`, option `inactiveUser`)
- Modify: `backend/apps/api/src/videos/videos.service.ts:326-347` (`requireSession` bỏ truy vấn `user.findUnique`), `backend/apps/api/src/files/files.service.ts:214-224` (`redeemDownloadLink` bỏ truy vấn user)
- Modify: `backend/apps/api/src/content/access-rules.spec.ts`
- Test: `backend/apps/api/test/videos.e2e-spec.ts`, `backend/apps/api/test/uploads.e2e-spec.ts` (đặt cạnh các test `download-link` đang có)

**Interfaces:**
- Consumes: `requireNode(user: Pick<AuthenticatedUser,'id'>, …)`, `AS_VIDEO`, `AS_FILE` (Task 4).
- Produces:
  - `accessColumns(userId)` thêm cột `(SELECT u.status = 'ACTIVE' FROM users u WHERE u.id = ${userId}::uuid) AS user_active`.
  - `effectiveRole(r: { member_role: string | null; share_role: string | null; user_active?: boolean | null }): ContentRole | null`: trả `null` khi `user_active === false` hoặc `null` (user không tồn tại). Khi không có field thì giữ hành vi cũ.
  - `NodeAccess.userActive: boolean`
  - Option mới của `requireNode`: `inactiveUser?: string`. Khi `!access.userActive` mà có option này thì ném `AppError.notFound(inactiveUser)`; không có option thì rơi xuống nhánh `'Item not found'` như cũ.
  - `requireSession` dùng `access.requireNode({ id: s.userId }, nodeId, 'VIEWER', { ...AS_VIDEO, inactiveUser: 'Playback session is invalid or has expired' })`. `redeemDownloadLink` truyền `{ id: grant.userId }` cùng `inactiveUser: 'Download link is invalid or has expired'` xuống chỗ kiểm quyền file.

- [ ] **Step 1: Viết test chốt hành vi cho người dùng bị khoá (chạy trên code cũ phải xanh)**

```ts
it('tài khoản bị khoá giữa phiên xem: playlist và khoá trả 404 phiên hết hạn', async () => {
  /* viewer mở playback → admin PATCH /api/v1/admin/users/:id { status: 'DISABLED' } →
     GET master.m3u8?s=token → 404, error.message === 'Playback session is invalid or has expired';
     GET key?s=token → 404 cùng message */
});
it('tài khoản bị khoá sau khi lấy link tải: link trả 404 hết hạn', async () => {
  /* editor POST download-link → khoá editor → GET /api/v1/downloads/:token → 404 'Download link is invalid or has expired' */
});
```

Unit trong `access-rules.spec.ts`: `effectiveRole({ member_role: 'ADMIN', share_role: null, user_active: false })` → `null`; `user_active: null` → `null`; `user_active: true` → `'OWNER'`.

- [ ] **Step 2: Chạy, xác nhận test e2e xanh trên code cũ, unit đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/videos.e2e-spec.ts test/uploads.e2e-spec.ts && pnpm --filter @luna/api exec vitest run src/content/access-rules.spec.ts`
Expected: e2e PASS; unit FAIL (`user_active` chưa được xét).

- [ ] **Step 3: Implement cột `user_active`, `effectiveRole`, `userActive`, `inactiveUser`; bỏ 2 truy vấn user riêng và `JOIN users` trong `resolveDocumentAccess`**

`admin-videos.service.ts:88` giữ nguyên. Chỗ đó kiểm `isSystemAdmin` chứ không kiểm quyền trên mục.

- [ ] **Step 4: Build, chạy test, gồm cả test collab cho user bị khoá (`server.e2e-spec.ts:270`)**

Run: `pnpm turbo run build --filter=@luna/db && pnpm --filter @luna/api exec vitest run src/content/access-rules.spec.ts && pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/videos.e2e-spec.ts test/uploads.e2e-spec.ts test/permissions-matrix.e2e-spec.ts && pnpm --filter @luna/collab exec vitest run --config ./vitest.config.e2e.ts`
Expected: PASS.

- [ ] **Step 5: Gate, commit**

```bash
git add backend/packages/db/src backend/apps/api/src backend/apps/api/test
git commit -m "Resolve the user's account status in the same access query as their roles"
```

---

### Task 6: Tách `DocumentAssets` (3.6)

**Files:**
- Create: `backend/apps/api/src/documents/document-assets.service.ts`
- Modify: `backend/apps/api/src/documents/documents.service.ts:45-62` (hằng số, `UploadedAsset`), `:234-263` (`uploadAsset`, `listAssets`), `:313-336` (ảnh trong mammoth), `:432-472` (`copyAssets`), `:488-572` (`storeAsset`, `assetDto`, `withFreshAssetUrls`), `:575-586` (`remapAssets`)
- Modify: `backend/apps/api/src/documents/documents.module.ts` (provider), `backend/apps/api/src/documents/versions.service.ts` (nếu đang dùng `withFreshAssetUrls`/`remapAssets` qua `DocumentsService`)
- Test: `backend/apps/api/test/documents.e2e-spec.ts` (đã có: ảnh nhúng `:293`, import `:568`, copy `:646`)

**Interfaces:**
- Consumes: `ObjectStore.putBuffer/copy/presignGet` (Task 3).
- Produces:
  - `interface AssetDto { id: string; fileName: string; mime: string; size: number; url: string; isImage: boolean }`
  - `class DocumentAssets`:
    - `upload(userId: string, nodeId: string, file: UploadedAsset | undefined): Promise<AssetDto>`: giữ đủ 3 lỗi: `'Attach a file in the "file" field'`, 413 `'Embedded files are limited to 20 MB'` + `{ maxBytes }`, 415 `'Only images (PNG, JPEG, WebP, GIF), PDF and Office files can be embedded'`.
    - `list(nodeId: string): Promise<AssetDto[]>`
    - `copyAll(userId: string, fromNodeId: string, toNodeId: string): Promise<Map<string, string>>`
    - `withFreshUrls(nodeId: string, json: DocJSON): Promise<DocJSON>`
    - `docxImage(userId: string, nodeId: string): (image: { readAsBase64String(): Promise<string>; contentType: string }) => Promise<{ src: string }>`
  - `remapAssets(json: DocJSON, ids: Map<string, string>): DocJSON` (pure, export)
- Việc kiểm quyền vẫn nằm ở `DocumentsService`, chạy trước khi gọi `DocumentAssets`. Key S3 giữ dạng `docs/${nodeId}/${id}` trong bucket `assets`. URL ký: 600 giây, disposition `inline` nếu là ảnh, ngược lại `attachment`.

- [ ] **Step 1: Chạy test documents làm mốc**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/documents.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 2: Chuyển code sang `DocumentAssets`; `DocumentsService` chỉ còn gọi `assets.*`; bỏ injection `ObjectStore` khỏi `DocumentsService` nếu không còn dùng**

- [ ] **Step 3: Chạy lại test documents và versions**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/documents.e2e-spec.ts`
Expected: PASS, không phải sửa assertion nào.

- [ ] **Step 4: Gate, commit**

```bash
git add backend/apps/api/src/documents
git commit -m "Move embedded document asset storage into a DocumentAssets module"
```

---

### Task 7: Tách `HlsSessions` (3.6)

**Files:**
- Create: `backend/apps/api/src/videos/hls-sessions.service.ts`
- Modify: `backend/apps/api/src/videos/videos.service.ts:23-39` (hằng số, `Session`), `:126-140` (tạo phiên trong `startPlayback`), `:180-256` (`masterPlaylist`, `mediaPlaylist`, `segmentUrl`, `key`), `:326-364` (`requireSession`, `readPlaylist`)
- Modify: `backend/apps/api/src/videos/videos.controller.ts:102-158` (4 route HLS gọi thẳng `HlsSessions`), `backend/apps/api/src/videos/videos.module.ts`
- Test: `backend/apps/api/test/videos.e2e-spec.ts` (đã có `:187`, `:234`, `:259`, `:277`, `:290`, `:368`, cộng 2 test ở Task 5)

**Interfaces:**
- Consumes: `ObjectStore.getStream/presignGet` (Task 3); `requireNode(..., { ...AS_VIDEO, inactiveUser })` (Task 5); `playbackKey`, `playbackIndexKey` (`playback-keys.ts`, giữ nguyên).
- Produces:
  - `class HlsSessions`:
    - `open(input: { userId: string; sessionId: string; nodeId: string; hls: ObjectRef }): Promise<{ token: string; masterUrl: string; expiresAt: Date }>`
    - `masterPlaylist(nodeId: string, token: string): Promise<string>`
    - `mediaPlaylist(nodeId: string, rendition: string, token: string): Promise<string>`
    - `segmentUrl(nodeId: string, rendition: string, segment: string, token: string): Promise<string>`
    - `key(nodeId: string, token: string): Promise<Buffer>`
  - Hằng số chuyển nguyên văn: `SESSION_IDLE_SEC = 900`, `SESSION_MAX_SEC = 28800`, `SEGMENT_URL_TTL_SEC = 120`, `MAX_KEY_FETCHES = 30`, `RENDITION_RE`, `SEGMENT_RE`, cache playlist `hlspl:${prefix}${path}` 600 giây, bộ đếm `pb:${token}:keys`. `segmentUrl` không kiểm quyền mỗi lần gọi; `master`, `media`, `key` thì có.
  - `VideosService.startPlayback` gọi `hls.open(...)` rồi ghép response như cũ. `VideosService` không giữ `S3Client` hay `REDIS` cho phần HLS nữa (vẫn giữ `REDIS` cho dedup lượt xem `video:view:*`).

- [ ] **Step 1: Chạy test videos làm mốc**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/videos.e2e-spec.ts test/session-revocation.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 2: Chuyển code sang `HlsSessions`, controller gọi thẳng `HlsSessions`**

- [ ] **Step 3: Chạy lại test**

Run: như Step 1.
Expected: PASS, không phải sửa assertion nào.

- [ ] **Step 4: Gate, commit**

```bash
git add backend/apps/api/src/videos
git commit -m "Move HLS playback sessions into an HlsSessions module"
```

---

### Task 8: Test chốt hành vi cây thư mục trước khi gom vào `NodeTree` (3.1, bước 1)

**Files:**
- Create: `backend/apps/api/test/node-tree.e2e-spec.ts`
- Modify: `backend/apps/api/test/tree-races.e2e-spec.ts` (thêm 2 ca 503)

**Interfaces:**
- Consumes: `createTestApp`, `loginAs`, `resetDatabase` (`create-test-app.ts`); `lockWorkspaceTree` (`@luna/db`); `getQueueToken` (`@nestjs/bullmq`) để đọc hàng `search-index` (api e2e không chạy worker nên job nằm ở trạng thái `waiting`/`delayed`).

Test ở task này chạy trên code hiện tại phải xanh ngay. Đỏ nghĩa là test hiểu sai hành vi: sửa test, không sửa code.

- [ ] **Step 1: Viết test**

```ts
const auditOf = (targetId: string) => ctx.prisma.auditLog.findMany({ where: { targetId }, orderBy: { id: 'asc' } });
const indexJobsFor = async (nodeId: string) => (await searchQueue.getJobs(['waiting', 'delayed'])).filter((j) => j.data.nodeId === nodeId).map((j) => j.name);

it('tạo folder: đúng một dòng node.create {type, name, parentId} và một job index-node', async () => {
  const id = (await createFolder(alice, 'Kế hoạch', f).expect(201)).body.id;
  expect((await auditOf(id)).map((r) => [r.action, r.metadata])).toEqual([['node.create', { type: 'FOLDER', name: 'Kế hoạch', parentId: f }]]);
  expect(await indexJobsFor(id)).toEqual(['index-node']);
});
it('tạo tài liệu ở gốc: node.create kèm format, section lưu là DOCS', async () => {
  const res = await createDocument(alice, 'Ghi chú', null, 'LATEX').expect(201);
  const [row] = await auditOf(res.body.node.id);
  expect(row).toMatchObject({ action: 'node.create', metadata: { type: 'DOCUMENT', format: 'LATEX', name: 'Ghi chú', parentId: null } });
  expect((await ctx.prisma.node.findUniqueOrThrow({ where: { id: res.body.node.id } })).section).toBe('DOCS');
});
it('sao chép tài liệu chỉ ghi document.copy, không ghi node.create', async () => { /* actions === ['document.copy'] */ });
it('import .docx chỉ ghi document.import, không ghi node.create', async () => { /* dùng sample.docx + seed giống documents.e2e-spec.ts:546-565; actions === ['document.import'] */ });
it('bắt đầu upload: chỉ ghi upload.start, chưa đánh chỉ mục', async () => {
  const id = (await startUpload(alice, { fileName: 'a.pdf', size: 10 }).expect(201)).body.nodeId;
  expect((await auditOf(id)).map((r) => r.action)).toEqual(['upload.start']);
  expect(await indexJobsFor(id)).toEqual([]);
});
it('video ở gốc VIDEOS trùng tên với mục ở gốc DOCS: không 409', async () => {
  await createFolder(alice, 'Đào tạo.mp4', null).expect(201);
  await startUpload(alice, { fileName: 'Đào tạo.mp4', size: 10, mime: 'video/mp4', kind: 'VIDEO' }).expect(201);
});
it('video trùng tên trong gốc VIDEOS: 409 với gợi ý tính trong VIDEOS', async () => {
  const dup = await startUpload(alice, { fileName: 'Đào tạo.mp4', size: 10, mime: 'video/mp4', kind: 'VIDEO' }).expect(409);
  expect(dup.body.error.details.suggestion).toBe('Đào tạo (1).mp4');
});
it('tài liệu vào folder thuộc VIDEOS: 400 với message khu Video', async () => {
  /* folder VIDEOS → POST documents { parentId } → 400, message 'This folder is in the Video area, which only holds videos' */
});
it('di chuyển ghi node.move {from, to}; chuyển vào đúng cha hiện tại thì không ghi gì', async () => { /* actions sau 2 lần move: ['node.create', 'node.move'] */ });
it('khôi phục phải đổi tên ghi node.restore {restoredTo, movedToRoot, renamedTo}', async () => {
  /* tạo 'X' trong f, trash, tạo 'X' mới trong f, restore → metadata { restoredTo: f, movedToRoot: false, renamedTo: 'X (1)' } */
});
```

Trong `tree-races.e2e-spec.ts` (giữ khoá bằng `lockWorkspaceTree` như test `:249`):

```ts
it('tạo tài liệu khi khoá cây bị giữ quá lâu: 503, không tạo gì', ...);
it('bắt đầu upload khi khoá cây bị giữ quá lâu: 503, không có upload session', ...);
```

Assertion giống test 503 đang có: `code: 'SERVICE_UNAVAILABLE'`, message `'Someone else is changing this workspace right now, try again in a moment'`, và đếm `node`/`uploadSession` không đổi.

- [ ] **Step 2: Chạy, xác nhận xanh trên code cũ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/node-tree.e2e-spec.ts test/tree-races.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/api/test/node-tree.e2e-spec.ts backend/apps/api/test/tree-races.e2e-spec.ts
git commit -m "Pin current tree create, move and restore behaviour with characterization tests"
```

---

### Task 9: `NodeTree.create` thay 4 đường tạo mục (3.1, bước 2)

**Files:**
- Create: `backend/apps/api/src/content/node-tree.service.ts`; Modify: `backend/apps/api/src/content/content.module.ts` (provide + export `NodeTree`)
- Modify: `backend/apps/api/src/content/nodes.service.ts:205-242` (`createFolder`), `:374-463` (chuyển `withTreeLock`, `requireContainer`, `mapNameConflict`, `siblingKeys` sang `NodeTree`; `updateDetails` và `trash` gọi `tree.mapConflict`/`tree.withLock`)
- Modify: `backend/apps/api/src/documents/documents.service.ts:82-158` (`create`, `copy`), `:265-356` (`importDocx`), `:392-420` (xoá `createNode`)
- Modify: `backend/apps/api/src/files/uploads.service.ts:83-117`
- Modify: `backend/apps/api/src/content/trash.service.ts:128,149` (`this.nodes.withTreeLock` → `this.tree.withLock`)
- Test: `backend/apps/api/test/node-tree.e2e-spec.ts`

**Interfaces:**
- Consumes: `writeAudit`/`AuditService.log` + `AuditAction` (Task 1); `SearchQueueService.node` (Task 2); `requireNode` (Task 4); `DocumentAssets.copyAll/docxImage` (Task 6); `isNameConflict`, `isTreeViolation`, `isTreeBusy` (`conflicts.ts`, giữ nguyên); `lockWorkspaceTree`; `nameKey`, `suggestName`.
- Produces (`node-tree.service.ts`):
  - `type NodeExtra = { description?: string | null; status?: NodeStatus; document?: Prisma.DocumentCreateWithoutNodeInput }`
  - `interface NewNode { workspaceId: string; parentId: string | null; section?: NodeSection; type: NodeType; name: string; autoRename?: boolean; extra?: NodeExtra | (() => Promise<NodeExtra>) }`
  - `interface CreatedNode { id: string; workspaceId: string; parentId: string | null; section: NodeSection; type: NodeType; name: string }`
  - `type Announce = false | { action: AuditAction; metadata: (node: CreatedNode) => Prisma.InputJsonObject }`
  - `interface NameScope { workspaceId: string; parentId: string | null; section: NodeSection; name: string; excludeId?: string }`
  - `class NodeTree`:
    - `create(user: AuthenticatedUser, input: NewNode, ctx: RequestContext, opts?: { fill?: (node: CreatedNode) => Promise<void>; announce?: Announce }): Promise<CreatedNode>`
    - `move(user, nodeId, targetParentId, ctx): Promise<void>` (Task 10)
    - `restore(user, root: NodeAccess, ctx): Promise<{ parentId: string | null; name: string }>` (Task 10)
    - `withLock<T>(workspaceId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>`: chuyển nguyên văn từ `withTreeLock` (lock 5000 ms, `maxWait` 5000, `timeout = DB_STATEMENT_TIMEOUT_MS ?? 30000`, `isTreeBusy` → 503).
    - `mapConflict(err: unknown, scope: NameScope): Promise<unknown>`: chuyển nguyên văn từ `mapNameConflict` (LT001 trước, rồi P2002 + gợi ý).
- Thứ tự bên trong `create` (giữ đúng thứ tự cũ của từng đường):
  1. `requireContainer(user, workspaceId, parentId, section)`: lấy section của container (gốc: `section ?? 'DOCS'` + `requireMember(..., 'MEMBER')`).
  2. `extra` dạng hàm thì gọi ở bước này: sau kiểm container, trước khi lấy khoá, ngoài khoá. Copy cần thứ tự này vì phải kiểm quyền trên folder đích trước khi gọi collab snapshot.
  3. `withLock`: nếu `autoRename` thì tính `siblingKeys(tx)` rồi `suggestName` khi bị trùng; sau đó `tx.node.create` với `section` lấy từ container, `nameNormalized: nameKey(name)`, `createdById`, `updatedById`, cộng `extra`. Lỗi thì `throw await mapConflict(err, scope)`.
  4. Có `fill` thì chạy sau khi transaction đã commit. `fill` ném lỗi thì `prisma.node.delete({ where: { id } }).catch(() => undefined)` rồi ném lại đúng lỗi đó.
  5. `announce !== false` thì ghi audit (mặc định `{ action: 'node.create', metadata: n => ({ type: n.type, name: n.name, parentId: n.parentId }) }`) rồi `search.node(id)`. `announce: false` thì bỏ qua cả audit lẫn index.
- Cách từng caller dùng:
  - Folder: `{ section: body.section, type: 'FOLDER' }`, announce mặc định.
  - Document create: `{ section: 'DOCS', type: 'DOCUMENT', extra: { document: … } }`, announce `metadata: n => ({ type: 'DOCUMENT', format: body.format, name: n.name, parentId: n.parentId })`.
  - Copy: tên tự động `` `${source.name} (bản sao)` `` đi kèm `autoRename: true`; `body.name` có thì `autoRename: false`. `extra` là hàm gọi `latestContent` và giữ `json` trong closure. `fill` gọi `assets.copyAll` + `writeContent`. `announce` dùng `'document.copy'` với metadata như cũ.
  - Import: tên là `base` đi kèm `autoRename: true`. `fill` chạy mammoth và map lỗi không phải `AppError` thành 415. `announce` dùng `'document.import'`.
  - Upload: `{ section: kind === 'VIDEO' ? 'VIDEOS' : 'DOCS', type: kind, extra: { description, status: 'UPLOADING' } }`, `announce: false`. Phần multipart và dọn dẹp giữ nguyên ở `UploadsService`.
- Thay đổi có chủ ý: `autoRename` tính tên bên trong khoá, giống restore. Không có race thì response như cũ. Có race thì không còn 409, vì tên được chọn sau khi đã giữ khoá.

- [ ] **Step 1: Viết test qua interface `NodeTree` (đỏ)**

```ts
const tree = () => ctx.app.get(NodeTree);
const reqCtx = { ip: '127.0.0.1', userAgent: 'vitest' };
it('fill lỗi: xoá mục vừa tạo, không ghi audit, ném lại đúng lỗi', async () => {
  const boom = new Error('copy failed');
  await expect(tree().create(aliceUser, { workspaceId: wsId, parentId: f, type: 'FOLDER', name: 'Hỏng' }, reqCtx, { fill: () => Promise.reject(boom) })).rejects.toBe(boom);
  expect(await ctx.prisma.node.count({ where: { workspaceId: wsId, name: 'Hỏng' } })).toBe(0);
  expect(await ctx.prisma.auditLog.count({ where: { metadata: { path: ['name'], equals: 'Hỏng' } } })).toBe(0);
});
it('fill chạy sau khi đã nhả khoá cây', async () => {
  let free: boolean | undefined;
  await tree().create(aliceUser, { workspaceId: wsId, parentId: f, type: 'FOLDER', name: `Rảnh ${seq}` }, reqCtx, {
    fill: async () => {
      const [r] = await ctx.prisma.$transaction((tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${TREE_LOCK_NAMESPACE}::int, hashtext(${wsId})) AS ok`);
      free = r!.ok;
    },
  });
  expect(free).toBe(true);
});
it('extra dạng hàm chạy sau kiểm tra container: người chỉ xem bị 403 và extra không được gọi', async () => {
  const extra = vi.fn();
  await expect(tree().create(viewerUser, { workspaceId: wsId, parentId: f, type: 'DOCUMENT', name: 'x', extra }, reqCtx)).rejects.toMatchObject({ status: 403 });
  expect(extra).not.toHaveBeenCalled();
});
it('autoRename trong khoá: hai lần tạo đồng thời cùng tên đều thành công, tên khác nhau', async () => {
  const input = { workspaceId: wsId, parentId: f, type: 'FOLDER' as const, name: `Song song ${seq}`, autoRename: true };
  const [a, b] = await Promise.all([tree().create(aliceUser, input, reqCtx), tree().create(aliceUser, input, reqCtx)]);
  expect(new Set([a.name, b.name]).size).toBe(2);
});
```

`aliceUser`/`viewerUser` lấy từ `toAuthenticatedUser(await ctx.prisma.user.findUniqueOrThrow({ where: { id: alice.userId } }))`.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/node-tree.e2e-spec.ts`
Expected: FAIL, do chưa có `NodeTree` (các test của Task 8 vẫn xanh).

- [ ] **Step 3: Implement `NodeTree.create`, `withLock`, `mapConflict` (cùng `requireContainer`, `siblingKeys` private)**

- [ ] **Step 4: Chuyển `createFolder`, `documents.create/copy/importDocx`, `uploads.create` sang `tree.create`; xoá `DocumentsService.createNode`; `trash.service` và `nodes.trash` dùng `tree.withLock`**

- [ ] **Step 5: Chạy test cây, documents, uploads, races**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/node-tree.e2e-spec.ts test/tree-races.e2e-spec.ts test/content.e2e-spec.ts test/documents.e2e-spec.ts test/uploads.e2e-spec.ts test/permissions-matrix.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 6: Gate, commit**

```bash
git add backend/apps/api/src backend/apps/api/test/node-tree.e2e-spec.ts
git commit -m "Create every tree node through NodeTree so container, section, naming, lock, audit and indexing live in one place"
```

---

### Task 10: `NodeTree.move` / `restore` dùng chung `placeAt`, xoá đường cũ (3.1, bước 3)

**Files:**
- Modify: `backend/apps/api/src/content/node-tree.service.ts`
- Modify: `backend/apps/api/src/content/nodes.service.ts:295-349` (`move` gọi `tree.move` rồi trả `dto.one`)
- Modify: `backend/apps/api/src/content/trash.service.ts:60-121` (`restore`: quyền và `requireTrashRoot` vẫn ở đây; khoá và ghi chuyển sang `tree.restore`)
- Test: `backend/apps/api/test/node-tree.e2e-spec.ts`, `tree-races.e2e-spec.ts`, `content.e2e-spec.ts`

**Interfaces:**
- Consumes: `withLock`, `mapConflict`, `siblingKeys` (Task 9).
- Produces:
  - `private placeAt(tx: Prisma.TransactionClient, node: { id: string; workspaceId: string; section: NodeSection; name: string }, parentId: string | null, opts: { autoRename: boolean; userId: string }): Promise<string>`: trả tên cuối cùng; update `parentId`, `updatedById`, và `name`/`nameNormalized` khi `autoRename` đổi tên.
  - `move(user, nodeId, targetParentId, ctx): Promise<void>`: chuyển nguyên văn các bước cũ. `requireNode` EDITOR → chặn chuyển vào chính nó (400 `'Cannot move an item into itself'`) → `requireContainer(target, node.section)` → cùng cha thì return luôn, không audit. Trong khoá: `FOR UPDATE` (mục đã xoá/đã chuyển → 409 `'This item was just moved or deleted, refresh and try again'`) → kiểm vòng (400 `'Cannot move a folder into its own subfolder'`) → `placeAt(..., { autoRename: false })`. Ngoài khoá, sau commit: audit `node.move {from, to}` → `search.tree` → `collab.accessChanged({ workspaceId })`.
  - `restore(user, root, ctx): Promise<{ parentId: string | null; name: string }>`. Trong khoá: `FOR UPDATE` lấy `deleted_root_id` (404/400 như cũ) → cha `FOR SHARE`, cha đã bị xoá thì về gốc → `placeAt(..., { autoRename: true })` → bỏ xoá các mục con theo `deletedRootId`. Sau commit: audit `node.restore {restoredTo, movedToRoot, renamedTo}` → `search.tree`. Restore không phát `collab.accessChanged` (giữ như hiện tại).
  - Sau task này `NodesService` không còn method nào về khoá/tên. `NodeTree` là đường duy nhất gọi `lockWorkspaceTree` ở API.

- [ ] **Step 1: Thêm test qua interface (đỏ)**

```ts
it('restore qua NodeTree trả tên cuối cùng và parentId thực tế', async () => {
  /* trash 'Y' trong f, tạo 'Y' mới trong f → tree().restore(aliceUser, rootAccess, reqCtx) → { parentId: f, name: 'Y (1)' } */
});
```

`rootAccess` lấy bằng `ctx.app.get(ContentAccessService).resolveMany(alice.userId, [id])`.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/node-tree.e2e-spec.ts`
Expected: FAIL, do chưa có `NodeTree.restore`.

- [ ] **Step 3: Implement `placeAt`, `move`, `restore`; `NodesService.move` và `TrashService.restore` gọi xuống `NodeTree`**

- [ ] **Step 4: Kiểm không còn khoá hay xử lý tên ngoài `NodeTree`**

Run: `grep -rn "lockWorkspaceTree\|siblingKeys\|suggestName\|isNameConflict\|isTreeViolation" apps/api/src --include=*.ts`
Expected: chỉ còn trong `node-tree.service.ts`, `conflicts.ts`, `node-names.ts`.

- [ ] **Step 5: Chạy test**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/node-tree.e2e-spec.ts test/tree-races.e2e-spec.ts test/tree-guard.e2e-spec.ts test/content.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 6: Gate, commit**

```bash
git add backend/apps/api/src backend/apps/api/test/node-tree.e2e-spec.ts
git commit -m "Route move and restore through NodeTree.placeAt and remove the old tree helpers from NodesService"
```

---

### Task 11: Xuất OpenAPI thành kiểu TS cho FE, có lệnh kiểm trong CI (3.5, bước 1)

**Files:**
- Modify: `backend/apps/api/src/common/swagger/zod-openapi.ts:7-14` (`z.date()` → `{ type: 'string', format: 'date-time' }`); Create: `backend/apps/api/src/common/swagger/zod-openapi.spec.ts`
- Modify: `backend/apps/api/src/setup-app.ts:15-24` (tách `applyGlobalPrefix(app)` để export dùng chung)
- Modify: `backend/apps/api/src/common/swagger/openapi-document.ts:237` (`buildOpenApiDocument(app, config: Pick<AppConfig, 'ACCESS_TOKEN_TTL_SEC' | 'RATE_LIMIT_USER_PER_MIN' | 'RATE_LIMIT_ANON_PER_MIN' | 'BODY_LIMIT' | 'API_PUBLIC_URL'>)`)
- Create: `backend/apps/api/src/openapi/render-types.ts`, `backend/apps/api/src/openapi/render-types.spec.ts`, `backend/apps/api/src/openapi/export.ts`
- Modify: `backend/apps/api/package.json` (devDependency `openapi-typescript` pin bản chính xác bằng `pnpm --filter @luna/api add -D -E openapi-typescript@7`; script `"openapi:types": "node dist/openapi/export.js --write"`, `"openapi:check": "node dist/openapi/export.js --check"`)
- Modify: `.github/workflows/ci.yml` (job `backend`, sau `pnpm build`: `- run: pnpm --filter @luna/api openapi:check`)
- Create (sinh ra): `frontend/src/lib/api-schema.ts`; Create: `frontend/src/lib/api-types.ts`
- Modify: `frontend/eslint.config.mjs` (thêm `"src/lib/api-schema.ts"` vào `globalIgnores`)

**Interfaces:**
- Produces:
  - `toOpenApi` truyền thêm `override` vào `z.toJSONSchema`: schema zod kiểu `date` → `type: 'string', format: 'date-time'`. Thay đổi này chỉ chạm tài liệu `/api/docs-json`, không đổi response.
  - `stripDocs(doc: OpenAPIObject): OpenAPIObject`: bản sao sâu, bỏ mọi key `description`, `summary`, `example`, `examples`.
  - `renderTypes(doc: OpenAPIObject): Promise<string>`: `astToString(await openapiTS(stripDocs(doc)))` qua Node API (không dùng CLI để khỏi có header comment), kết thúc bằng một dấu xuống dòng.
  - `export.ts`: `NestFactory.create(AppModule, { preview: true, logger: false })`, gọi `applyGlobalPrefix(app)`, rồi `buildOpenApiDocument(app, loadAppConfig())` và `renderTypes`. Đường dẫn đích là `path.resolve(<thư mục của file>, '../../../../../frontend/src/lib/api-schema.ts')`. Với `--write`, ghi file. Với `--check`, so với file đang có: khác thì in `api-schema.ts is out of date, run pnpm --filter @luna/api openapi:types` rồi `process.exit(1)`.
  - FE: `type ApiOk<P extends keyof paths, M extends keyof paths[P]>` = body JSON của response 200 hoặc 201 ở `paths[P][M]`.

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('z.date() ra chuỗi date-time trong OpenAPI', () => {
  expect(toOpenApi(z.object({ at: z.date(), maybe: z.date().nullable() }))).toMatchObject({ properties: { at: { type: 'string', format: 'date-time' } } });
});
it('renderTypes không sinh comment và có path của API', async () => {
  const doc = { openapi: '3.0.0', info: { title: 't', version: '1', description: 'mô tả' }, paths: { '/api/v1/nodes/{id}': { get: { summary: 'Lấy mục', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', description: 'node', properties: { createdAt: { type: 'string', format: 'date-time' } } } } } } } } } } };
  const out = await renderTypes(doc as never);
  expect(out).toContain('"/api/v1/nodes/{id}"');
  expect(out).not.toMatch(/^\s*(\/\/|\/\*|\*)/m);
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run src/common/swagger/zod-openapi.spec.ts src/openapi/render-types.spec.ts`
Expected: FAIL (date ra `{}`, chưa có `render-types`).

- [ ] **Step 3: Implement override, `applyGlobalPrefix`, `render-types.ts`, `export.ts`, script và bước CI**

- [ ] **Step 4: Build rồi sinh file**

Run: `pnpm build && pnpm --filter @luna/api openapi:types && grep -c '"/api/v1/' ../frontend/src/lib/api-schema.ts`
Expected: con số > 80 (mỗi route một dòng). Nếu preview mode không ra path nào thì fallback: dựng `Test.createTestingModule({ imports: [AppModule] })` và override `PrismaService`, `REDIS`, `ObjectStore` bằng `{}`. Ghi lại cách đã chọn vào commit message.

- [ ] **Step 5: Xác nhận lệnh kiểm phát hiện được file cũ**

Run: `pnpm --filter @luna/api openapi:check; echo "exit=$?"; echo 'export {};' >> ../frontend/src/lib/api-schema.ts; pnpm --filter @luna/api openapi:check; echo "exit=$?"; git checkout ../frontend/src/lib/api-schema.ts 2>/dev/null || pnpm --filter @luna/api openapi:types`
Expected: lần đầu `exit=0`, lần hai `exit=1` kèm message out of date.

- [ ] **Step 6: Viết `api-types.ts`; kiểm FE; gate backend; commit**

Run (trong `frontend/`): `pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS (chưa ai dùng kiểu mới).

```bash
git add backend/apps/api .github/workflows/ci.yml backend/pnpm-lock.yaml frontend/src/lib/api-schema.ts frontend/src/lib/api-types.ts frontend/eslint.config.mjs
git commit -m "Generate frontend API types from the OpenAPI document and fail CI when they drift"
```

---

### Task 12: Cho DTO ở FE thành alias của kiểu sinh ra (3.5, bước 2)

**Files:**
- Modify: `frontend/src/lib/types.ts` (toàn bộ), `frontend/src/lib/documents.ts:6-95` (DTO), `frontend/src/lib/search.ts:4-22` (`SearchPart`, `SearchHit`, `SearchResult`)
- Chỉ sửa backend nếu bắt buộc: `backend/apps/api/src/**/*.schemas.ts`, khi schema zod của response viết sai so với response thật (sửa tài liệu, không sửa service), sau đó chạy lại `openapi:types`.

**Interfaces:**
- Consumes: `ApiOk` (Task 11).
- Tên export giữ nguyên để 38 file đang import không phải sửa. Bảng ánh xạ:

| Tên FE | Kiểu sinh |
|---|---|
| `NodeItem` | `ApiOk<'/api/v1/nodes/{id}', 'get'>` |
| `UserSummary` | `ApiOk<'/api/v1/users', 'get'>[number]` |
| `Me` | `ApiOk<'/api/v1/me', 'get'>` |
| `Workspace` | `ApiOk<'/api/v1/workspaces/{wsId}', 'get'>` |
| `Member` | `ApiOk<'/api/v1/workspaces/{wsId}/members', 'get'>[number]` |
| `Tag` | `NodeItem['tags'][number]` |
| `FileDetail`, `FileDuplicate`, `FileVersion`, `FilePreview` | `'/api/v1/files/{id}'` get; `FileDetail['duplicates'][number]`; `'/api/v1/files/{id}/versions'` get `[number]`; `'/api/v1/files/{id}/preview'` get |
| `Share` | `ApiOk<'/api/v1/nodes/{id}/shares/{shareId}', 'patch'>` |
| `TrashItem` | `ApiOk<'/api/v1/workspaces/{wsId}/trash', 'get'>[number]` |
| `AdminUser`, `AuditItem`, `AdminStats`, `AdminVideo` | `'/api/v1/admin/users/{id}'` patch; `'/api/v1/admin/audit-logs'` get `['items'][number]`; `'/api/v1/admin/stats'` get; `'/api/v1/admin/videos'` get `[number]` |
| `VideoDetail`, `VideoRendition`, `Playback` | `'/api/v1/videos/{id}'` get; `NonNullable<VideoDetail['video']>['renditions'][number]`; `'/api/v1/videos/{id}/playback'` post |
| `ActivityItem` | `ApiOk<'/api/v1/nodes/{id}/activity', 'get'>['items'][number]` |
| Enum (`NodeType`, `NodeSection`, `ContentRole`, `WorkspaceRole`, `WorkspaceKind`, `ShareRole`, `PreviewKind`) | lấy từ field tương ứng, ví dụ `NodeItem['type']`, `Member['role']`, `FileVersion['previewKind']` |
| `DocumentDetail`, `CollabToken`, `DocAsset`, `DocVersion`, `DocVersionDetail`, `DocDiff`, `DocThread`, `DocComment`, `AppNotification` | route tương ứng trong `documents.controller.ts`, `comments.controller.ts`, `notifications.controller.ts` |

- Giữ viết tay: `Page<T>`, `NodeEvent` (payload SSE, không có trong OpenAPI), `MeWorkspace`, `DocJSON`, `TokenResponse` ở `api.ts`.
- Khi kiểu sinh lỏng hơn kiểu tay (`unknown`, `Record<string, unknown>`) ở field FE đang dựa vào (`contentJson`, `metadata`), dùng `Omit<Gen, 'field'> & { field: HandType }`.
- Khi kiểu sinh khác kiểu tay đến mức FE không compile được, kiểm response thật trước (`curl` với dev token, hoặc đọc assertion e2e). Nếu schema zod sai thì sửa schema zod và sinh lại. Không đổi service, không đổi component chỉ để khớp kiểu.

- [ ] **Step 1: Đổi `types.ts`, `documents.ts`, `search.ts` thành alias theo bảng**

- [ ] **Step 2: Kiểm FE**

Run (trong `frontend/`): `pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 3: Nếu đã sửa schema zod: sinh lại, chạy `openapi:check` và gate backend**

Run (trong `backend/`): `pnpm build && pnpm --filter @luna/api openapi:types && pnpm --filter @luna/api openapi:check && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 4: Smoke trên trình duyệt**

Chạy `pnpm dev` trong `backend/` và trong `frontend/`. Mở `http://localhost:5173/?as=<email admin dev>` và kiểm: cây thư mục, mở một tài liệu, một file PDF, phát một video, trang thùng rác, trang admin (thống kê, nhật ký). Không có lỗi console mới so với `main`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib backend/apps/api/src frontend/src/lib/api-schema.ts
git commit -m "Derive frontend DTO types from the generated OpenAPI types"
```

---

### Task 13: Kiểm tra cuối đợt

- [ ] **Step 1: Gate backend đầy đủ, có cả build và `openapi:check`**

Run (trong `backend/`): `pnpm lint && pnpm format:check && pnpm build && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm --filter @luna/api openapi:check`
Expected: PASS.

- [ ] **Step 2: `pnpm test:http` trên dev stack**

Run (trong `backend/`, khi `pnpm dev` đang chạy): `pnpm test:http`
Expected: mọi request pass, `with-cleanup.sh` dọn dữ liệu test.

- [ ] **Step 3: FE**

Run (trong `frontend/`): `pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 4: Rà lần cuối**

Run: `git diff main --stat` và `git diff main -- '*.ts' '*.tsx' | grep -E '^\+\s*(//|/\*)'`
Expected: lệnh thứ hai không ra dòng nào (không có comment mới).
