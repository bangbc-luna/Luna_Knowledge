# Gia cố đợt 2: DB và bảo mật — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng race trên cây thư mục, sửa index/FK/ràng buộc, thêm job dọn dữ liệu cũ, và làm xong các mục bảo mật 2.10–2.18. Không đổi hành vi phân quyền hay response API.

**Architecture:** Có hai lớp bảo vệ cây thư mục. Lớp thứ nhất là API: mọi thao tác create/move/trash/restore chạy trong transaction có `pg_advisory_xact_lock` theo workspace. Lớp thứ hai là trigger `nodes_set_path`: trigger đọc cha bằng `FOR SHARE` và `RAISE` (SQLSTATE `LT001`) khi cha không hợp lệ hoặc khi move tạo vòng. Thay đổi schema đi theo từng migration Prisma; mỗi migration tự sửa dữ liệu cũ trước khi thêm ràng buộc, và có một test e2e chạy các migration này trên dữ liệu bẩn. App chuyển sang role DB riêng `luna_app` (không phải owner) và mất quyền UPDATE/DELETE/TRUNCATE trên `audit_logs`. Việc dọn audit log cũ đi qua hàm `SECURITY DEFINER`. Phần hạ tầng (MinIO, mạng, Redis, Traefik, header của FE) sửa trong compose và next.config.

**Tech Stack:** NestJS 12 (ESM), Prisma 7 + `@prisma/adapter-pg`, PostgreSQL 16 + ltree, BullMQ, Hocuspocus, Redis (ioredis), MinIO (pgsty fork), Traefik 3.6, Next.js 16, Vitest + testcontainers.

**Spec:** `docs/superpowers/specs/2026-10-30-hardening-design.md` (mục 5 "Đợt 2", cùng các ghi chú ở mục 2, 3, 8)

## Global Constraints

- Không viết comment trong code mới hay code sửa (TS, TSX, SQL migration mới, shell script mới). Đây là quy ước của chủ dự án.
- Làm trên branch `hardening/wave2-db-security`, tách từ `main` sau khi đợt 1 đã merge. Mỗi task commit riêng. Thư mục gốc của lệnh git là repo `Luna_Knowledge`; các lệnh pnpm chạy trong `backend/`, trừ khi step ghi khác.
- Mọi thay đổi schema đi qua migration Prisma (`pnpm --filter @luna/db exec prisma migrate dev --create-only --name <name>`, sau đó sửa SQL). Migration phải chạy được trên DB đang có dữ liệu.
- Dùng `CREATE INDEX` thường, không dùng `CONCURRENTLY`. Lý do: Prisma chạy cả file migration trong một batch nên `CONCURRENTLY` lỗi; hơn nữa service `migrate` chạy xong thì api/collab/worker mới khởi động (`depends_on: service_completed_successfully`), nên lúc đó không có traffic.
- Sau mỗi migration, `schema.prisma` phải khớp DB: `pnpm --filter @luna/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` in ra "No difference detected" (chạy trên DB dev đã `migrate deploy`).
- Không đổi hành vi phân quyền hay response API mà FE đang dùng. Lỗi mới chỉ được xuất hiện trong tình huống race.
- Đọc `frontend/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md` và `.../02-guides/content-security-policy.md` trước khi sửa `next.config.ts` (xem `frontend/AGENTS.md`).
- Tên test viết tiếng Việt theo quy ước hiện có, identifier viết tiếng Anh.
- Hai mốc giữ dữ liệu là env, mặc định 30 ngày: `WORKSPACE_PURGE_DAYS` (xoá hẳn workspace xoá mềm, kèm blob) và `AUTO_VERSION_THIN_DAYS` (phiên bản tự lưu cũ hơn mốc này chỉ giữ 1 bản/ngày; bản lưu tay giữ nguyên). Các mốc cố định: audit log giữ 1 năm, thông báo đã đọc giữ 90 ngày, `recent_views` giữ 50 mục/người.
- Đợt kết thúc khi `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:http` đều xanh. FE thêm `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Review Focus

- DB prod đã có dữ liệu "bẩn": mục còn sống dưới cha đã xoá, tham chiếu mồ côi tới blob/user/phiên bản, số âm, thread RESOLVED nhưng thiếu `resolved_at`, `mentions` NULL. Migration vẫn phải chạy qua và sửa dữ liệu theo cách an toàn. Test: `migration-upgrade.e2e-spec.ts` (Task 1 tạo; Task 3, 4, 5, 8 bổ sung ca).
- CSP chặn tính năng thật: upload PUT lên media host, ảnh avatar Google, HLS qua URL ký của media host, WebSocket collab, font KaTeX, worker `blob:` của hls.js. Test: script `check:headers` kiểm từng directive, kèm danh sách smoke trên trình duyệt (Task 15).
- Chuyển prod sang app role: collab ghi audit, worker transcode/GC, backup/restore và script dọn test phải vẫn chạy. Test: `db-roles.e2e-spec.ts` chạy các luồng tiêu biểu bằng app role (Task 8), và Task 17 chạy `pnpm test:http` trên dev với app role.
- Một người đăng nhập trên hai thiết bị rồi đăng xuất ở một thiết bị: chỉ SSE, collab và phiên xem của phiên đó bị đóng, phiên còn lại vẫn chạy. Test: "đăng xuất một phiên không đóng phiên còn lại" (Task 10).
- Hai mục trùng tên được khôi phục cùng lúc vào cùng một folder: cả hai phải thành công với tên khác nhau, không trả 500 do unique. Test ở Task 2.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/packages/db/prisma/migrations/<ts>_tree_guard/migration.sql` | Trigger path mới, sửa mục sống dưới cha đã xoá |
| `backend/packages/db/prisma/migrations/<ts>_indexes/migration.sql` | 2.2, 2.3, 2.8 |
| `backend/packages/db/prisma/migrations/<ts>_foreign_keys/migration.sql` | 2.4, 2.5, index `restored_from_id` |
| `backend/packages/db/prisma/migrations/<ts>_constraints/migration.sql` | 2.9 (CHECK, NOT NULL) |
| `backend/packages/db/prisma/migrations/<ts>_app_role_audit/migration.sql` | Role `luna_app`, REVOKE, trigger TRUNCATE, `purge_audit_logs` |
| `backend/packages/db/src/tree-lock.ts` | `lockWorkspaceTree` |
| `backend/packages/db/src/roles.ts` | `APP_DB_ROLE`, `ensureAppLogin` |
| `backend/packages/db/src/maintenance.ts` | Các hàm dọn dữ liệu (2.7) |
| `backend/apps/api/test/db-helpers.ts` | `waitForLockWait`, `treeInvariants`, `indexesUsed` |
| `backend/apps/api/test/migration-upgrade.e2e-spec.ts` | Chạy các migration đợt 2 trên dữ liệu bẩn |
| `backend/apps/api/test/tree-guard.e2e-spec.ts` | Test ở mức trigger |
| `backend/apps/api/test/tree-races.e2e-spec.ts` | Race qua HTTP |
| `backend/apps/api/test/db-indexes.e2e-spec.ts` | EXPLAIN, FK có index |
| `backend/apps/api/test/db-integrity.e2e-spec.ts` | FK, unique, CHECK |
| `backend/apps/api/test/db-roles.e2e-spec.ts` | Quyền của app role |
| `backend/apps/api/test/retention.e2e-spec.ts` | Hàm dọn dữ liệu |
| `backend/apps/api/test/session-revocation.e2e-spec.ts` | Đăng xuất đóng SSE, phát sự kiện collab |
| `backend/apps/api/src/infra/redis/session-revocations.service.ts` | Pub/sub thu hồi phiên |
| `backend/apps/api/src/videos/playback-keys.ts` | Khoá Redis của phiên xem và hàm thu hồi |
| `backend/apps/api/src/auth/decorators/current-session.decorator.ts` | `@CurrentSession()` |
| `backend/scripts/db-app-login.ts` | Tạo hoặc cập nhật login của app role khi deploy |
| `backend/docker/minio/app-user.sh` | Tạo user/policy MinIO cho app |
| `frontend/security-headers.ts`, `frontend/scripts/check-security-headers.mjs` | Header bảo mật và script kiểm tra |

---

### Task 1: Trigger bảo vệ cây thư mục và khung test nâng cấp migration (2.1, phần DB)

**Files:**
- Create: `backend/packages/db/prisma/migrations/<ts>_tree_guard/migration.sql`
- Create: `backend/apps/api/test/db-helpers.ts`
- Create: `backend/apps/api/test/tree-guard.e2e-spec.ts`
- Create: `backend/apps/api/test/migration-upgrade.e2e-spec.ts`
- Modify: `backend/apps/api/package.json` (devDependencies `pg` `^8.16.3`, `@types/pg` `^8.15.5`)

**Interfaces:**
- Produces (dùng ở Task 2, 3, 7):
  - `waitForLockWait(prisma: PrismaClient, timeoutMs: number): Promise<void>`: poll `SELECT count(*) FROM pg_locks WHERE NOT granted` cho tới khi > 0; quá `timeoutMs` thì reject.
  - `treeInvariants(prisma: PrismaClient): Promise<{ liveUnderDeleted: number; badPaths: number; cycles: number }>`. `liveUnderDeleted` đếm mục sống dưới cha đã xoá. `badPaths` đếm mục có `path` khác `parent.path || text2ltree(replace(id::text,'-',''))`. `cycles` đếm mục có `parent_id` nằm trong cây con của chính nó.
  - Lỗi trigger: SQLSTATE `LT001`. Message bắt đầu bằng một trong các chuỗi: `tree: parent not found`, `tree: parent is not a folder`, `tree: parent is in another workspace or section`, `tree: parent is in the trash`, `tree: move would create a cycle`.
  - Trong `migration-upgrade.e2e-spec.ts`: `const WAVE2: string[]` là danh sách tên thư mục migration đợt 2 theo thứ tự. Mỗi task sau thêm tên migration của mình vào đây, cùng dữ liệu seed và assert.

- [ ] **Step 1: Tạo branch**

Run: `git switch -c hardening/wave2-db-security`

- [ ] **Step 2: Viết test ở mức trigger (đỏ)**

`tree-guard.e2e-spec.ts` dùng `createTestApp`, `resetDatabase`; tạo user, workspace, node bằng `ctx.prisma` (đi qua trigger). Các test:

```ts
it('không tạo được mục dưới folder đã vào thùng rác', async () => {
  await ctx.prisma.node.update({ where: { id: folder }, data: { deletedAt: new Date(), deletedRootId: folder } });
  await expect(createNode({ parentId: folder })).rejects.toThrow(/tree: parent is in the trash/);
});
it('không tạo được mục dưới mục không phải FOLDER', ...toThrow(/tree: parent is not a folder/));
it('không gắn được vào cha khác workspace hoặc khác section', ...toThrow(/another workspace or section/));
it('move tạo vòng bị chặn ở trigger', async () => {
  await expect(ctx.prisma.node.update({ where: { id: a }, data: { parentId: childOfA } }))
    .rejects.toThrow(/tree: move would create a cycle/);
});
it('trigger chờ transaction đang xoá cha commit rồi mới quyết định', async () => {
  let insert!: Promise<unknown>;
  await ctx.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE nodes SET deleted_at = now(), deleted_root_id = id WHERE id = ${folder}::uuid`;
    insert = createNode({ parentId: folder }).catch((e: Error) => e);
    await waitForLockWait(ctx.prisma, 5000);
  }, { timeout: 15_000 });
  expect(String(await insert)).toMatch(/tree: parent is in the trash/);
  expect((await treeInvariants(ctx.prisma)).liveUnderDeleted).toBe(0);
});
it('di chuyển về gốc và khôi phục mục gốc của thùng rác vẫn chạy', ...);
```

- [ ] **Step 3: Viết khung test nâng cấp migration (đỏ)**

`migration-upgrade.e2e-spec.ts` khởi động `PostgreSqlContainer('postgres:16-alpine')` riêng và dùng `pg.Client`. Trong `beforeAll`: chạy (`client.query(sql)`) mọi `migration.sql` trong `packages/db/prisma/migrations` không có tên trong `WAVE2`, theo thứ tự tên thư mục; sau đó seed dữ liệu bẩn bằng SQL thô (id dùng `gen_random_uuid()`). Test đầu tiên:

```ts
it('các migration đợt 2 chạy được trên dữ liệu cũ', async () => {
  for (const name of WAVE2) await client.query(await readFile(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
});
it('mục còn sống dưới folder đã xoá được đưa vào thùng rác cùng folder đó', async () => {
  const { rows: [c] } = await client.query('SELECT deleted_at, deleted_root_id FROM nodes WHERE id = $1', [liveChild]);
  expect(c.deleted_root_id).toBe(trashedFolder);
  expect(c.deleted_at).not.toBeNull();
});
```

Seed cho task này: user, workspace, folder F, folder con C (insert khi F còn sống), sau đó `UPDATE nodes SET deleted_at = now(), deleted_root_id = F WHERE id = F` (chỉ F).

- [ ] **Step 4: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/tree-guard.e2e-spec.ts test/migration-upgrade.e2e-spec.ts`
Expected: FAIL. Các test trigger không thấy lỗi `tree: ...`; `WAVE2` rỗng nên test sửa dữ liệu thấy `deleted_root_id` null.

- [ ] **Step 5: Viết migration `tree_guard`**

Tạo bằng `prisma migrate dev --create-only --name tree_guard`, thêm tên thư mục vào `WAVE2`. Nội dung (thân trigger do spec chốt nên ghi đủ):

```sql
UPDATE nodes c
   SET deleted_at = a.deleted_at, deleted_by = a.deleted_by, deleted_root_id = a.deleted_root_id
  FROM (SELECT DISTINCT ON (c2.id) c2.id AS child_id, p.deleted_at, p.deleted_by, p.deleted_root_id
          FROM nodes c2 JOIN nodes p ON c2.path <@ p.path AND p.id <> c2.id
         WHERE c2.deleted_at IS NULL AND p.deleted_at IS NOT NULL
         ORDER BY c2.id, nlevel(p.path) DESC) a
 WHERE c.id = a.child_id;

CREATE OR REPLACE FUNCTION nodes_set_path() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  label ltree := text2ltree(replace(NEW.id::text, '-', ''));
  p_path ltree; p_type "NodeType"; p_ws uuid; p_section "NodeSection"; p_deleted timestamptz;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := label;
    RETURN NEW;
  END IF;
  SELECT path, type, workspace_id, section, deleted_at
    INTO p_path, p_type, p_ws, p_section, p_deleted
    FROM nodes WHERE id = NEW.parent_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tree: parent not found' USING ERRCODE = 'LT001';
  END IF;
  IF p_type <> 'FOLDER' THEN
    RAISE EXCEPTION 'tree: parent is not a folder' USING ERRCODE = 'LT001';
  END IF;
  IF p_ws <> NEW.workspace_id OR p_section <> NEW.section THEN
    RAISE EXCEPTION 'tree: parent is in another workspace or section' USING ERRCODE = 'LT001';
  END IF;
  IF NEW.deleted_at IS NULL AND p_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'tree: parent is in the trash' USING ERRCODE = 'LT001';
  END IF;
  IF TG_OP = 'UPDATE' AND p_path <@ OLD.path THEN
    RAISE EXCEPTION 'tree: move would create a cycle' USING ERRCODE = 'LT001';
  END IF;
  NEW.path := p_path || label;
  RETURN NEW;
END
$$;
```

Hai trigger `nodes_path_on_insert`/`nodes_path_on_move` giữ nguyên vì chúng đã trỏ tới hàm này.

- [ ] **Step 6: Chạy test, xác nhận xanh; kiểm schema**

Run: lệnh ở Step 4, sau đó `pnpm --filter @luna/db exec prisma migrate deploy` và lệnh `migrate diff` ở Global Constraints.
Expected: PASS; "No difference detected".

- [ ] **Step 7: Chạy lại e2e cũ (nhanh phát hiện seed hoặc test chèn node sai cha)**

Run: `pnpm --filter @luna/api test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/packages/db/prisma/migrations backend/apps/api/test backend/apps/api/package.json backend/pnpm-lock.yaml
git commit -m "Guard the content tree in the path trigger: lock the parent, reject trashed or foreign parents and cycles"
```

---

### Task 2: Khoá cây theo workspace ở API (2.1 phần app; 2.9 restore lấy `siblingKeys` trong transaction)

**Files:**
- Create: `backend/packages/db/src/tree-lock.ts`; Modify: `backend/packages/db/src/index.ts` (export)
- Modify: `backend/apps/api/src/content/conflicts.ts`
- Modify: `backend/apps/api/src/content/nodes.service.ts:199-234` (createFolder), `:287-336` (move), `:338-356` (trash), `:383-416` (mapNameConflict, siblingKeys)
- Modify: `backend/apps/api/src/content/trash.service.ts:60-91` (restore)
- Modify: `backend/apps/api/src/documents/documents.service.ts:362-386` (createNode)
- Modify: `backend/apps/api/src/files/uploads.service.ts:80-111`
- Test: `backend/apps/api/test/tree-races.e2e-spec.ts`

**Interfaces:**
- Consumes: `waitForLockWait`, `treeInvariants` (Task 1); SQLSTATE `LT001`.
- Produces:
  - `TREE_LOCK_NAMESPACE = 7101`
  - `lockWorkspaceTree(tx: Pick<PrismaClient, '$executeRaw'>, workspaceId: string): Promise<void>`: chạy `SELECT pg_advisory_xact_lock(7101, hashtext(${workspaceId}))` qua `$executeRaw`. Không dùng `$queryRaw` vì không deserialize được kiểu `void`.
  - `isTreeViolation(err: unknown): boolean`: tìm `LT001` hoặc `tree: ` trong `err.message`/`err.meta`. Viết test trước để xem lỗi thật từ adapter có dạng thế nào.
  - `NodesService.withTreeLock<T>(workspaceId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>`
  - `NodesService.siblingKeys(workspaceId, parentId, excludeId?, section = 'DOCS', db: Prisma.TransactionClient = this.prisma.client)`
  - `mapNameConflict` kiểm `isTreeViolation` trước; nếu đúng thì trả `AppError.conflict('The target folder was just moved or deleted, refresh and try again')` (409).

- [ ] **Step 1: Viết test race qua HTTP (đỏ)**

```ts
it('tạo folder vào folder đang bị xoá: chờ xoá xong rồi trả 409, không có mục sống dưới cha đã xoá', async () => {
  let res!: Promise<request.Response>;
  await ctx.prisma.$transaction(async (tx) => {
    await lockWorkspaceTree(tx, wsId);
    await tx.$executeRaw`UPDATE nodes SET deleted_at = now(), deleted_root_id = ${f}::uuid WHERE path <@ (SELECT path FROM nodes WHERE id = ${f}::uuid)`;
    res = createFolder(alice, 'Con', f).then((r) => r);
    await waitForLockWait(ctx.prisma, 5000).catch(() => undefined);
  }, { timeout: 15_000 });
  expect((await res).status).toBe(409);
  expect(await treeInvariants(ctx.prisma)).toEqual({ liveUnderDeleted: 0, badPaths: 0, cycles: 0 });
});
it('tạo tài liệu vào folder đang bị xoá cũng trả 409', ...);
it('hai lần di chuyển chéo A→B và B→A cùng lúc: đúng một lần thành công, cây không có vòng', async () => {
  for (let i = 0; i < 10; i++) {
    const [a, b] = await twoRootFolders(i);
    const [r1, r2] = await Promise.all([move(alice, a, b), move(alice, b, a)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    expect(await treeInvariants(ctx.prisma)).toEqual({ liveUnderDeleted: 0, badPaths: 0, cycles: 0 });
  }
});
it('khôi phục đồng thời hai mục trùng tên vào cùng folder: cả hai thành công, tên khác nhau', async () => {
  for (let i = 0; i < 5; i++) {
    const [x, y] = await twoTrashedSameName(i);
    const [r1, r2] = await Promise.all([restore(alice, x), restore(alice, y)]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.body.name).not.toBe(r2.body.name);
  }
});
```

Mã thành công của route restore lấy theo `content.e2e-spec.ts` (`POST nodes/:id/restore`); nếu route hiện trả 200 thì sửa trong test cho khớp.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/tree-races.e2e-spec.ts`
Expected: FAIL. Test đầu nhận 500 thay vì 409 (trigger đã chặn nhưng API chưa map lỗi). Restore đồng thời thỉnh thoảng nhận 500 (P2002).

- [ ] **Step 3: Implement `lockWorkspaceTree`, `isTreeViolation`, `withTreeLock`, tham số `db` của `siblingKeys`**

- [ ] **Step 4: Đưa mọi thao tác ghi cây vào `withTreeLock`**

- `createFolder`, `documents.createNode` (create, copy, importDocx; copy sang workspace khác thì khoá workspace đích), `uploads.create` (nhánh tạo node mới): tạo node bên trong `withTreeLock`.
- `move`: giữ `FOR UPDATE` và kiểm tra `inside`, nhưng chạy trong `withTreeLock(node.workspaceId, …)`.
- `trash`: câu `UPDATE … deleted_at` chạy trong `withTreeLock`.
- `restore`: `withTreeLock(node.workspaceId, async (tx) => …)`. Đọc cha bằng `SELECT deleted_at FROM nodes WHERE id = $1 FOR SHARE`, gọi `this.nodes.siblingKeys(…, tx)`.
- Audit, search, `collab.accessChanged` vẫn gọi sau khi transaction commit, như hiện tại.

- [ ] **Step 5: Chạy test race và toàn bộ e2e content**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/tree-races.e2e-spec.ts test/content.e2e-spec.ts test/documents.e2e-spec.ts test/uploads.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/packages/db/src backend/apps/api/src backend/apps/api/test/tree-races.e2e-spec.ts
git commit -m "Serialize tree writes per workspace with an advisory lock and map tree violations to 409"
```

---

### Task 3: Index cho audit, thông báo, nodes và các khoá ngoại (2.2, 2.3, 2.8)

**Files:**
- Modify: `backend/packages/db/prisma/schema.prisma` (models `AuditLog`, `Notification`, `Node`, `Favorite`, `RecentView`, `VideoWatch`, `UploadSession`, `FileVersion`)
- Create: migration `<ts>_indexes` (sinh bằng `migrate dev --create-only`, kiểm lại SQL)
- Modify: `backend/apps/api/test/db-helpers.ts`
- Test: `backend/apps/api/test/db-indexes.e2e-spec.ts`; thêm tên migration vào `WAVE2`

**Interfaces:**
- Produces: `indexesUsed(prisma: PrismaClient, sql: string, ...params: unknown[]): Promise<string[]>`. Trong một transaction, chạy `SET LOCAL enable_seqscan = off` rồi `EXPLAIN (FORMAT JSON) <sql>`, gom mọi `"Index Name"` trong plan.
- Tên index (Prisma đặt theo quy ước):
  - `audit_logs_target_id_id_idx` `(target_id, id DESC)`, `audit_logs_workspace_id_id_idx`, `audit_logs_actor_id_id_idx`, `audit_logs_action_id_idx`, `audit_logs_created_at_idx` (BRIN: `@@index([createdAt], type: Brin)`). Bỏ `audit_logs_{workspace_id,actor_id,action}_created_at_idx`.
  - `notifications_user_id_id_idx` `(user_id, id DESC)`; `notifications_unread_idx` `(user_id) WHERE read_at IS NULL` (`map:` + `where: raw(...)`). Bỏ `notifications_user_id_read_at_created_at_idx`.
  - `nodes_workspace_id_idx`; `nodes_deleted_root_id_idx` `(deleted_root_id) WHERE deleted_root_id IS NOT NULL`. Bỏ `nodes_workspace_id_deleted_root_id_idx`.
  - `favorites_node_id_idx`, `recent_views_node_id_idx`, `video_watch_progress_node_id_idx`, `upload_sessions_node_id_idx`, `file_versions_original_blob_id_idx`, `file_versions_preview_blob_id_idx`, `file_versions_thumbnail_blob_id_idx`.

- [ ] **Step 1: Viết test (đỏ)**

```ts
it.each([
  ['SELECT * FROM audit_logs WHERE target_id = $1 AND action = ANY($2) ORDER BY id DESC LIMIT 21', ['x', ['node.move']], 'audit_logs_target_id_id_idx'],
  ['SELECT * FROM audit_logs WHERE workspace_id = $1::uuid ORDER BY id DESC LIMIT 51', [uuid], 'audit_logs_workspace_id_id_idx'],
  ['SELECT * FROM audit_logs WHERE actor_id = $1::uuid ORDER BY id DESC LIMIT 51', [uuid], 'audit_logs_actor_id_id_idx'],
  ['SELECT * FROM audit_logs WHERE action = $1 ORDER BY id DESC LIMIT 51', ['node.view'], 'audit_logs_action_id_idx'],
  ['SELECT * FROM audit_logs WHERE created_at >= $1 AND created_at < $2', [from, to], 'audit_logs_created_at_idx'],
  ['SELECT * FROM notifications WHERE user_id = $1::uuid ORDER BY id DESC LIMIT 21', [uuid], 'notifications_user_id_id_idx'],
  ['SELECT count(*) FROM notifications WHERE user_id = $1::uuid AND read_at IS NULL', [uuid], 'notifications_unread_idx'],
  ['SELECT id FROM nodes WHERE deleted_root_id = $1::uuid', [uuid], 'nodes_deleted_root_id_idx'],
  ['SELECT id FROM nodes WHERE workspace_id = $1::uuid', [uuid], 'nodes_workspace_id_idx'],
])('truy vấn %s dùng index %s', async (sql, params, index) => {
  expect(await indexesUsed(ctx.prisma, sql, ...params)).toContain(index);
});
it('mọi khoá ngoại trong danh sách 2.3 có index bắt đầu bằng cột đó', async () => {
  expect(await fkColumnsWithoutLeadingIndex(ctx.prisma)).not.toEqual(expect.arrayContaining([
    'favorites.node_id', 'recent_views.node_id', 'video_watch_progress.node_id', 'upload_sessions.node_id',
    'file_versions.original_blob_id', 'file_versions.preview_blob_id', 'file_versions.thumbnail_blob_id',
  ]));
});
it('index cũ đã bỏ', async () => { /* pg_indexes không còn 5 tên cũ ở trên */ });
```

`fkColumnsWithoutLeadingIndex` là hàm cục bộ trong spec. Hàm join `pg_constraint (contype='f')` với `pg_index` sao cho `indkey[0]` trùng cột FK, rồi trả về `"table.column"` của các FK không có index nào như vậy.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/db-indexes.e2e-spec.ts`
Expected: FAIL, plan dùng index cũ hoặc Seq Scan.

- [ ] **Step 3: Sửa `schema.prisma`, sinh migration, thêm tên migration vào `WAVE2`**

- [ ] **Step 4: Chạy test, `migration-upgrade`, `migrate diff`**

Expected: PASS; "No difference detected".

- [ ] **Step 5: Commit**

```bash
git add backend/packages/db/prisma backend/apps/api/test
git commit -m "Index audit logs, notifications and foreign keys for the queries the app runs"
```

---

### Task 4: Khoá ngoại còn thiếu, unique blob, `restored_from_id ON DELETE SET NULL` (2.4, 2.5, một phần 2.7)

**Files:**
- Modify: `backend/packages/db/prisma/schema.prisma` (`Video`, `Blob`, `FileVersion`, `Document`, `User`, `DocumentVersion`)
- Create: migration `<ts>_foreign_keys`
- Test: `backend/apps/api/test/db-integrity.e2e-spec.ts`; bổ sung `migration-upgrade.e2e-spec.ts`

**Interfaces:**
- Produces (quan hệ Prisma mới, không đổi DTO):
  - `Video.version FileVersion @relation(fields: [versionId], references: [id], onDelete: NoAction)`, `Video.hls Blob @relation("videoHls", …, onDelete: NoAction)`, `Video.poster Blob? @relation("videoPoster", …, onDelete: SetNull)`, `Video.sprite Blob? @relation("videoSprite", …, onDelete: SetNull)`. Back-relations trên `Blob`: `hlsOf`, `posterOf`, `spriteOf` (đều `Video[]`); trên `FileVersion`: `videos Video[]`.
  - `Document.lastEditor User? @relation("documentLastEditor", fields: [lastEditedBy], references: [id], onDelete: SetNull)`; `User.editedDocuments Document[] @relation("documentLastEditor")`.
  - `DocumentVersion.restoredFrom DocumentVersion? @relation("versionRestore", fields: [restoredFromId], references: [id], onDelete: SetNull)`, `restoredTo DocumentVersion[] @relation("versionRestore")`, `@@index([restoredFromId], map: "document_versions_restored_from_id_idx", where: raw("restored_from_id IS NOT NULL"))`.
  - `Blob @@unique([provider, container, key])` → `blobs_provider_container_key_key`.
  - Phải dùng `NoAction` chứ không phải `Restrict` (Restrict là mặc định của Prisma cho quan hệ bắt buộc). Lý do: khi xoá node, `videos` và `blobs`/`file_versions` cascade trong cùng một câu lệnh, mà `Restrict` sẽ kiểm ngay và chặn lại.

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('không tạo được hai blob cùng provider, container, key', ...rejects.toThrow(/blobs_provider_container_key_key|Unique/));
it('xoá phiên bản tài liệu từng được khôi phục: restored_from_id về NULL', ...);
it('xoá blob đang làm poster: poster_blob_id về NULL', ...);
it('không xoá được blob HLS khi video còn trỏ tới', ...rejects.toThrow());
it('xoá node video xoá được cả video, phiên bản và blob trong một lệnh', async () => {
  await ctx.prisma.node.delete({ where: { id: videoNode } });
  expect(await ctx.prisma.blob.count({ where: { nodeId: videoNode } })).toBe(0);
});
it('documents.last_edited_by trỏ tới user không tồn tại bị chặn', ...);
```

Trong `migration-upgrade.e2e-spec.ts`, seed thêm: video có `poster_blob_id` mồ côi, `documents.last_edited_by` mồ côi, `document_versions.restored_from_id` mồ côi, và một video có `hls_blob_id` mồ côi. Assert: ba cột nullable về NULL; migration không lỗi; `SELECT convalidated FROM pg_constraint WHERE conname = 'videos_hls_blob_id_fkey'` ra `false`.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/db-integrity.e2e-spec.ts test/migration-upgrade.e2e-spec.ts`

- [ ] **Step 3: Sửa schema, sinh migration rồi sửa SQL**

Thứ tự trong migration:
1. Chặn deploy nếu có blob trùng key. Không tự xoá bản trùng, vì xoá blob sẽ kích hoạt GC xoá object mà dòng còn lại vẫn dùng:
   ```sql
   DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM blobs GROUP BY provider, container, key HAVING count(*) > 1) THEN
       RAISE EXCEPTION 'blobs: several rows share one object key, resolve them before deploying';
     END IF;
   END $$;
   ```
2. `UPDATE … SET <col> = NULL WHERE <col> IS NOT NULL AND NOT EXISTS (…)` cho `videos.poster_blob_id`, `videos.sprite_blob_id`, `documents.last_edited_by`, `document_versions.restored_from_id`.
3. Thêm FK cho các cột nullable như Prisma sinh. Riêng `videos_hls_blob_id_fkey` và `videos_version_id_fkey` thêm `NOT VALID`, rồi:
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM videos v WHERE NOT EXISTS (SELECT 1 FROM blobs b WHERE b.id = v.hls_blob_id)) THEN
       ALTER TABLE videos VALIDATE CONSTRAINT videos_hls_blob_id_fkey;
     ELSE
       RAISE WARNING 'videos.hls_blob_id has orphans; constraint left NOT VALID';
     END IF;
   END $$;
   ```
   Làm tương tự cho `version_id`.
4. Unique index blob và index `restored_from_id`.

- [ ] **Step 4: Chạy test, toàn bộ e2e worker video (transcode cập nhật video trước rồi mới xoá blob cũ), `migrate diff`**

Run: lệnh Step 2; `pnpm --filter @luna/worker test:e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/packages/db/prisma backend/apps/api/test
git commit -m "Add missing foreign keys, a unique object key per blob, and null out restored_from_id when versions are removed"
```

---

### Task 5: Ràng buộc nhỏ (2.9: path, mentions, số không âm, RESOLVED ⇔ resolved_at)

**Files:**
- Create: migration `<ts>_constraints` (SQL viết tay; schema chỉ đổi nếu `migrate diff` đòi)
- Test: `backend/apps/api/test/db-integrity.e2e-spec.ts`; bổ sung `migration-upgrade.e2e-spec.ts`

**Interfaces:**
- Produces, tên constraint:
  - `nodes_path_present CHECK (path IS NOT NULL)`. Dùng CHECK thay cho `SET NOT NULL`: `path` khai báo `Unsupported("ltree")?`; nếu đổi thành bắt buộc thì Prisma không cho `create` nữa.
  - `comments.mentions SET NOT NULL`. Nếu `migrate diff` báo khác biệt thì đổi sang `comments_mentions_present CHECK (mentions IS NOT NULL)`.
  - `comment_threads_resolved_consistent CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))`.
  - `*_nonnegative`: `blobs.size_bytes >= 0`, `upload_sessions.size_bytes >= 0`, `upload_sessions.part_size > 0`, `upload_sessions.part_count > 0`, `file_versions.version_no > 0`, `document_versions.version_no > 0`, `document_versions.word_count/words_added/words_removed >= 0`, `documents.word_count >= 0`, `videos.duration_sec/width/height/view_count >= 0`, `video_watch_progress.position_sec >= 0`, `blob_gc.attempts >= 0`.

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('comments.mentions không nhận NULL', ...$executeRaw`UPDATE comments SET mentions = NULL …` rejects);
it('thread RESOLVED phải có resolved_at, OPEN thì không', ...);
it('vị trí xem âm và kích thước âm bị chặn', ...);
```

Seed thêm trong `migration-upgrade`: comment có `mentions` NULL, thread RESOLVED với `resolved_at` NULL, thread OPEN có `resolved_at`, `position_sec = -3`. Assert sau migration: `mentions = '{}'`; thread RESOLVED có `resolved_at = created_at`; thread OPEN có `resolved_at` và `resolved_by` NULL; `position_sec = 0`.

- [ ] **Step 2: Chạy, xác nhận đỏ**

- [ ] **Step 3: Viết migration**

Sửa dữ liệu trước (`UPDATE` như phần assert ở Step 1, và `SET c = 0 WHERE c < 0` cho mọi cột `>= 0`), sau đó thêm ràng buộc.

- [ ] **Step 4: Chạy test, e2e comments/documents/videos, `migrate diff`**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/db-integrity.e2e-spec.ts test/migration-upgrade.e2e-spec.ts test/documents.e2e-spec.ts test/videos.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "Enforce path presence, non-null mentions, non-negative counters and resolved thread consistency"
```

---

### Task 6: Không để lại node UPLOADING khi tạo multipart lỗi (2.9)

**Files:**
- Modify: `backend/apps/api/src/files/uploads.service.ts:111-135`
- Test: `backend/apps/api/test/uploads.e2e-spec.ts`

**Interfaces:**
- Consumes: token `S3` từ `../src/infra/s3/s3.module.js`.

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('S3 lỗi khi tạo multipart: không để lại mục UPLOADING, upload phiên bản mới giữ nguyên mục cũ', async () => {
  const s3 = ctx.app.get<S3Client>(S3);
  vi.spyOn(s3, 'send').mockRejectedValueOnce(new Error('S3 unavailable'));
  const res = await startUpload(alice, { fileName: 'mo-coi.pdf' });
  expect(res.status).toBeGreaterThanOrEqual(500);
  expect(await ctx.prisma.node.count({ where: { name: 'mo-coi.pdf' } })).toBe(0);
  vi.spyOn(s3, 'send').mockRejectedValueOnce(new Error('S3 unavailable'));
  await startUpload(alice, { fileName: 'v2.pdf', replaceNodeId: existing });
  expect(await ctx.prisma.node.findUnique({ where: { id: existing } })).not.toBeNull();
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

- [ ] **Step 3: Implement**

Bọc đoạn `CreateMultipartUpload` + `uploadSession.create` trong try/catch. Khi lỗi: nếu node mới được tạo trong request này thì `node.deleteMany({ where: { id: nodeId, status: 'UPLOADING' } })`. Nếu đã có `UploadId` thì gửi `AbortMultipartUpload`, bỏ qua lỗi của nó. Sau đó ném lại lỗi gốc.

- [ ] **Step 4: Chạy `uploads.e2e-spec.ts`, xác nhận xanh**

- [ ] **Step 5: Commit**

```bash
git commit -am "Remove the new UPLOADING item when starting the multipart upload fails"
```

---

### Task 7: Khoá node trước khi đánh số phiên bản file (2.6)

**Files:**
- Modify: `backend/apps/worker/src/processors/file-process.processor.ts:152-181`
- Test: `backend/apps/worker/test/file-process.e2e-spec.ts`

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('hai phiên bản mới ghi cùng lúc nhận số liên tiếp, không lỗi trùng', async () => {
  const first = await completedUpload('sample.txt');
  await processor.processUpload(first.uploadId);
  const second = await completedUpload('sample.txt', { as: 'v3.txt', nodeId: first.nodeId });
  let running!: Promise<unknown>;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM nodes WHERE id = ${first.nodeId}::uuid FOR UPDATE`;
    const blob = await tx.blob.create({ data: { nodeId: first.nodeId, kind: 'ORIGINAL', provider: 'S3', container: 'w-originals', key: `race/${crypto.randomUUID()}`, sizeBytes: 1n, mime: 'text/plain' } });
    await tx.fileVersion.create({ data: { nodeId: first.nodeId, versionNo: 2, fileName: 'v2.txt', originalBlobId: blob.id, uploadedById: userId } });
    running = processor.processUpload(second.uploadId);
    await waitForLockWait(prisma, 30_000);
  }, { timeout: 60_000 });
  await running;
  expect((await versionOf(second.uploadId)).versionNo).toBe(3);
});
```

`waitForLockWait` viết lại cục bộ trong spec của worker, vì worker không import được test helper của api.

- [ ] **Step 2: Chạy, xác nhận đỏ (unique `file_versions_node_id_version_no_key`)**

Run: `pnpm --filter @luna/worker exec vitest run --config ./vitest.config.e2e.ts test/file-process.e2e-spec.ts -t "số liên tiếp"`

- [ ] **Step 3: Implement**

Đổi `tx.node.findUnique` (kiểm node còn tồn tại) thành `tx.$queryRaw\`SELECT id FROM nodes WHERE id = ${node.id}::uuid FOR UPDATE\``; nếu không có dòng nào thì `return false`. Phần `aggregate` giữ nguyên.

- [ ] **Step 4: Chạy lại cả spec, xác nhận xanh**

- [ ] **Step 5: Commit**

```bash
git commit -am "Lock the file node before numbering a new version"
```

---

### Task 8: Role DB riêng cho app, audit log append-only thật sự (2.17)

**Files:**
- Create: migration `<ts>_app_role_audit`
- Create: `backend/packages/db/src/roles.ts`; Modify: `backend/packages/db/src/index.ts`
- Create: `backend/scripts/db-app-login.ts`; Modify: `backend/scripts/package.json` (`"db:app-login": "tsx db-app-login.ts"`)
- Modify: `backend/scripts/cleanup-test-data.ts:19` (dùng `DATABASE_MIGRATE_URL ?? DATABASE_URL`)
- Modify: `backend/scripts/backup/common.sh` và các chỗ gọi `pg_url "$DATABASE_URL"` trong `backup.sh`, `restore.sh` → `${DATABASE_MIGRATE_URL:-$DATABASE_URL}`
- Modify: `backend/Dockerfile` (CMD của migrate thêm `&& pnpm --filter @luna/scripts db:app-login`)
- Modify: `backend/docker/docker-compose.prod.yml` (service `migrate`: `environment: { DATABASE_URL: ${DATABASE_MIGRATE_URL}, APP_DATABASE_URL: ${DATABASE_URL} }`)
- Modify: `backend/.env.prod.example`, `backend/.env.example` (`DATABASE_MIGRATE_URL`; `DATABASE_URL` dùng user `luna_app_user`)
- Modify: `backend/apps/api/test/create-test-app.ts:35-39` (`resetDatabase`), `backend/apps/api/test/global-setup.ts`
- Modify: `docs/DEPLOY.md` (mục env và nâng cấp)
- Test: `backend/apps/api/test/db-roles.e2e-spec.ts`; bổ sung `migration-upgrade.e2e-spec.ts` (thêm tên migration vào `WAVE2`)

**Interfaces:**
- Produces:
  - `APP_DB_ROLE = 'luna_app'`
  - `ensureAppLogin(adminUrl: string, appUrl: string): Promise<'created' | 'updated' | 'same-user'>`: lấy user/password từ `appUrl`. Nếu user trùng user của `adminUrl` thì trả `'same-user'` (dev mặc định). Nếu chưa có role đó thì `CREATE ROLE … LOGIN PASSWORD … IN ROLE luna_app`; có rồi thì `ALTER ROLE … PASSWORD` và `GRANT luna_app`. Cuối cùng `GRANT CONNECT ON DATABASE`. Định danh và literal dựng bằng `format('%I', …)`/`%L` phía server.
  - Hàm SQL `purge_audit_logs(batch_size integer) RETURNS integer` (Task 9 dùng).
  - Env `DATABASE_APP_URL`, chỉ dùng trong test: global-setup tạo login `luna_app_e2e` / `e2e_app_password`.

- [ ] **Step 1: Viết test (đỏ)**

`db-roles.e2e-spec.ts` mở `pg.Client(process.env.DATABASE_APP_URL)`:

```ts
it('app role ghi và đọc được audit_logs', ...INSERT + SELECT ok);
it.each(['UPDATE audit_logs SET action = $$x$$', 'DELETE FROM audit_logs', 'TRUNCATE audit_logs'])(
  'app role không chạy được: %s', async (sql) => { await expect(app.query(sql)).rejects.toThrow(/permission denied/); });
it('app role không tắt được trigger và không tạo được bảng', ...ALTER TABLE audit_logs DISABLE TRIGGER …, CREATE TABLE x() → rejects);
it('owner TRUNCATE audit_logs cũng bị trigger chặn', async () => {
  await expect(ctx.prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
});
it('purge_audit_logs gọi từ app role chỉ xoá bản ghi quá 1 năm', async () => {
  // owner insert 2 dòng created_at = now() - 400 days, 1 dòng now() - 300 days
  expect((await app.query('SELECT purge_audit_logs(1000) AS n')).rows[0].n).toBe(2);
});
it('app role chạy được luồng cây: tạo folder, tạo con, di chuyển, xoá mềm', ...);
it('bảng do migration tạo sau này tự có quyền cho app role', ...owner CREATE TABLE e2e_default_priv; app INSERT ok; DROP);
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

- [ ] **Step 3: Viết migration**

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'luna_app') THEN CREATE ROLE luna_app NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO luna_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO luna_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO luna_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO luna_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO luna_app;
DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN REVOKE ALL ON "_prisma_migrations" FROM luna_app; END IF;
END $$;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM luna_app;

CREATE FUNCTION audit_logs_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (TRUNCATE blocked)' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_no_truncate();

CREATE FUNCTION purge_audit_logs(batch_size integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM audit_logs WHERE id IN (
    SELECT id FROM audit_logs WHERE created_at < now() - interval '1 year'
     ORDER BY id LIMIT LEAST(GREATEST(batch_size, 1), 10000));
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION purge_audit_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_audit_logs(integer) TO luna_app;
```

Bọc REVOKE trên `_prisma_migrations` trong `to_regclass` vì `migration-upgrade.e2e-spec.ts` chạy SQL thô, không có bảng này. Nếu `startup-check.ts` hoặc healthcheck có đọc bảng này thì bỏ dòng REVOKE đó (hiện tại grep chưa thấy chỗ nào đọc).

- [ ] **Step 4: Implement `roles.ts`, `db-app-login.ts`, global-setup, `resetDatabase`**

- `global-setup.ts`: sau `migrate deploy`, gọi `ensureAppLogin(DATABASE_URL, appUrl)`, với `appUrl` là `DATABASE_URL` thay user/password thành `luna_app_e2e`/`e2e_app_password`; đặt `process.env.DATABASE_APP_URL = appUrl`. Các test khác vẫn chạy bằng owner, không đổi.
- `resetDatabase`: chạy trong `prisma.$transaction([...])`: `ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_truncate`, `TRUNCATE …` (câu hiện có), `ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_truncate`.

- [ ] **Step 5: Chạy `db-roles`, `migration-upgrade`, toàn bộ e2e api, `migrate diff`**

Expected: PASS.

- [ ] **Step 6: Cập nhật env mẫu và DEPLOY.md**

`.env.prod.example` có `DATABASE_MIGRATE_URL=postgresql://luna:<POSTGRES_PASSWORD>@postgres:5432/luna?schema=public`, `DATABASE_URL=postgresql://luna_app_user:<APP_DB_PASSWORD>@postgres:5432/luna?schema=public`. DEPLOY.md ghi: backup và restore dùng `DATABASE_MIGRATE_URL`; khi nâng cấp, login của app được tạo tự động ở bước `migrate`.

Kiểm cấu hình: `docker compose -f docker/docker-compose.prod.yml --env-file .env.prod.example config -q`

- [ ] **Step 7: Commit**

```bash
git commit -am "Run the app as a non-owner database role that cannot rewrite audit logs; purge old audit logs through a definer function"
```

---

### Task 9: Job dọn dữ liệu cũ (2.7)

**Files:**
- Modify: `backend/packages/db/src/maintenance.ts`
- Modify: `backend/packages/shared/src/constants.ts:18-25` (`JOBS.RETENTION: 'retention'`)
- Modify: `backend/apps/worker/src/config/worker-config.ts` (`WORKSPACE_PURGE_DAYS`, `AUTO_VERSION_THIN_DAYS`: `z.coerce.number().int().min(1).default(30)`)
- Modify: `backend/apps/worker/src/processors/maintenance.processor.ts` (scheduler `{ pattern: '30 3 * * *', tz: 'Asia/Ho_Chi_Minh' }`, nhánh `JOBS.RETENTION` gọi `runRetention` rồi `collectGarbage()`)
- Modify: `backend/.env.prod.example`, `backend/.env.example`
- Test: `backend/apps/api/test/retention.e2e-spec.ts`, `backend/apps/worker/test/file-process.e2e-spec.ts`

**Interfaces:**
- Consumes: `purge_audit_logs(integer)` (Task 8); `restored_from_id ON DELETE SET NULL` và index của nó (Task 4).
- Produces (export từ `@luna/db`):
  ```ts
  export const AUDIT_PURGE_BATCH = 5000;
  export const READ_NOTIFICATION_RETENTION_DAYS = 90;
  export const RECENT_VIEWS_PER_USER = 50;
  export interface RetentionOptions { workspacePurgeDays: number; autoVersionThinDays: number; now?: Date }
  export interface RetentionResult { auditLogs: number; notifications: number; recentViews: number; documentVersions: number; workspaces: number }
  export function purgeOldAuditLogs(prisma: PrismaClient, opts?: { batchSize?: number }): Promise<number>;
  export function purgeReadNotifications(prisma: PrismaClient, opts?: { olderThanDays?: number; now?: Date }): Promise<number>;
  export function capRecentViews(prisma: PrismaClient, opts?: { keep?: number }): Promise<number>;
  export function thinAutoVersions(prisma: PrismaClient, opts: { olderThanDays: number; now?: Date }): Promise<number>;
  export function purgeDeletedWorkspaces(prisma: PrismaClient, opts: { olderThanDays: number; now?: Date }): Promise<number>;
  export function runRetention(prisma: PrismaClient, opts: RetentionOptions): Promise<RetentionResult>;
  ```
- `purgeOldAuditLogs` lặp `SELECT purge_audit_logs(${batchSize})` cho tới khi kết quả bằng 0.
- `thinAutoVersions` (SQL do spec chốt, ngày tính theo giờ Việt Nam):
  ```sql
  DELETE FROM document_versions v
   USING (SELECT id, row_number() OVER (
            PARTITION BY node_id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
            ORDER BY created_at DESC, id DESC) AS rn
            FROM document_versions
           WHERE is_auto AND created_at < ${cutoff}) r
   WHERE v.id = r.id AND r.rn > 1
  ```
- `capRecentViews`: xoá các dòng có `row_number() OVER (PARTITION BY user_id ORDER BY viewed_at DESC) > keep`.
- `purgeDeletedWorkspaces`: lấy id các workspace có `deleted_at < cutoff`, rồi `DELETE` từng cái, mỗi cái một câu lệnh. Node, blob và các bảng con cascade theo; trigger đưa blob vào `blob_gc`.

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('audit log quá 1 năm bị xoá theo lô, bản ghi 300 ngày giữ nguyên', ...purgeOldAuditLogs(ctx.prisma, { batchSize: 2 }) === 3);
it('thông báo đã đọc quá 90 ngày bị xoá; chưa đọc thì giữ dù cũ', ...);
it('mở gần đây giữ 50 mục mới nhất mỗi người', ...user A 55 → 50 mới nhất còn lại; user B 10 → 10);
it('phiên bản tự lưu quá 30 ngày chỉ giữ bản cuối mỗi ngày theo giờ Việt Nam; bản lưu tay và bản trong 30 ngày giữ nguyên', async () => {
  // ngày D (giờ VN) cách đây 40 ngày: auto 08:00, auto 20:00, auto 23:30 (=16:30 UTC), manual 09:00;
  // auto 00:30 ngày D+1 (=17:30 UTC ngày D); auto cách đây 10 ngày
  expect(await thinAutoVersions(ctx.prisma, { olderThanDays: 30 })).toBe(2);
  // còn lại: 23:30 D, 00:30 D+1, manual 09:00, bản 10 ngày
});
it('phiên bản được khôi phục từ bản bị dọn: restored_from_id về NULL', ...);
it('workspace xoá mềm quá 30 ngày bị xoá hẳn kèm node, blob vào blob_gc; workspace xoá 10 ngày giữ nguyên', ...);
it('chạy lại lần hai không xoá thêm gì', async () => {
  await runRetention(ctx.prisma, { workspacePurgeDays: 30, autoVersionThinDays: 30 });
  expect(await runRetention(ctx.prisma, { workspacePurgeDays: 30, autoVersionThinDays: 30 }))
    .toEqual({ auditLogs: 0, notifications: 0, recentViews: 0, documentVersions: 0, workspaces: 0 });
});
```

Worker:

```ts
it('job retention chạy các bước dọn rồi GC', async () => {
  const r = await maintenance.process({ name: JOBS.RETENTION } as Job);
  expect(r).toEqual(expect.objectContaining({ auditLogs: expect.any(Number), workspaces: expect.any(Number), deleted: expect.any(Number) }));
});
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/retention.e2e-spec.ts`

- [ ] **Step 3: Implement các hàm trong `maintenance.ts`, hằng `JOBS.RETENTION`, env worker, scheduler**

- [ ] **Step 4: Chạy test api và worker, xác nhận xanh**

Run: lệnh Step 2; `pnpm --filter @luna/worker exec vitest run --config ./vitest.config.e2e.ts test/file-process.e2e-spec.ts -t retention`

- [ ] **Step 5: Thêm env vào `.env.prod.example` và `.env.example` (`WORKSPACE_PURGE_DAYS=30`, `AUTO_VERSION_THIN_DAYS=30`)**

- [ ] **Step 6: Commit**

```bash
git commit -am "Nightly retention: old audit logs, read notifications, recent views cap, auto version thinning, deleted workspaces"
```

---

### Task 10: Đăng xuất đóng SSE, collab và phiên xem video (2.13)

**Files:**
- Modify: `backend/packages/shared/src/constants.ts:63-67` (`CollabAccessEvent.sessionId?: string`; `SESSION_REVOKED_CHANNEL = 'luna:session-revoked'`)
- Create: `backend/apps/api/src/infra/redis/session-revocations.service.ts` (đăng ký trong module Redis hoặc module đang export `CollabEventsService`)
- Create: `backend/apps/api/src/auth/decorators/current-session.decorator.ts`
- Create: `backend/apps/api/src/videos/playback-keys.ts`
- Modify: `backend/apps/api/src/auth/auth.service.ts:282-314` (`revokeSession`, `revokeAllSessions`)
- Modify: `backend/apps/api/src/notifications/notifications.controller.ts:57-64`, `backend/apps/api/src/files/files.controller.ts:191-207`
- Modify: `backend/apps/api/src/videos/videos.service.ts:105-126, 312-331` và controller gọi `startPlayback`
- Modify: `backend/apps/api/src/documents/documents.service.ts:166-183` và controller (`collabToken` nhận `sessionId`, thêm claim `sid`)
- Modify: `backend/apps/collab/src/auth.ts`, `backend/apps/collab/src/server.ts:34-40, 151-169` (+ nơi gán context trong `onAuthenticate`)
- Test: `backend/apps/api/test/session-revocation.e2e-spec.ts`, `backend/apps/api/test/videos.e2e-spec.ts`, `backend/apps/collab/test/server.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `SessionRevocationsService.publish(sessionIds: string[]): Promise<void>`; `revoked$(sessionId: string): Observable<void>` (một subscriber Redis dùng chung, theo pattern của `NodeEventsService`).
  - `CurrentSession()`: param decorator trả `req.auth.sessionId`.
  - `playbackKey(token: string) = \`pb:${token}\``, `playbackIndexKey(sessionId: string) = \`pbs:${sessionId}\``, `revokePlaybackSessions(redis: Redis, sessionIds: string[]): Promise<void>` (đọc `SMEMBERS` index, `DEL` các khoá `pb:` và index).
  - Kiểu `Session` của playback có thêm `sessionId: string`. `startPlayback(user, nodeId, ctx, sessionId)` gọi `SADD pbs:<sid> <token>` + `EXPIRE pbs:<sid> SESSION_MAX_SEC`.
  - `CollabClaims.sessionId?: string` (lấy từ claim `sid`; token cũ không có `sid` vẫn hợp lệ); `CollabContext.sessionId?: string`.
  - Trong `recheck`: nếu `event.sessionId` có giá trị thì chỉ đóng các kết nối có `ctx.sessionId === event.sessionId` bằng `{ code: 4401, reason: 'Session ended' }`, không đọc DB.
  - `revokeSession`/`revokeAllSessions`: sau khi update xong, với mỗi phiên vừa bị thu hồi thì gọi `revocations.publish(ids)`, `collab.accessChanged({ userId, sessionId })` và `revokePlaybackSessions(redis, ids)`. `revokeAllSessions` phải `findMany` lấy id trước khi `updateMany`.

- [ ] **Step 1: Viết test (đỏ)**

API (`session-revocation.e2e-spec.ts`; server lắng nghe bằng `ctx.app.listen(0)` để dùng `fetch` stream):

```ts
it('đăng xuất đóng luồng SSE thông báo của phiên đó', async () => {
  const s1 = await loginAs(ctx, 'sse@lunatech.vn');
  const stream = openSse(`${base}/api/v1/notifications/stream`, s1.auth);
  await s1.agent.post('/api/v1/auth/logout').set(s1.auth).expect(204);
  await expect(stream.closed).resolves.toBeUndefined();
});
it('đăng xuất một phiên không đóng phiên còn lại của cùng người', async () => {
  const [s1, s2] = [await loginAs(ctx, 'two@lunatech.vn'), await loginAs(ctx, 'two@lunatech.vn')];
  const other = openSse(`${base}/api/v1/notifications/stream`, s2.auth);
  await s1.agent.post('/api/v1/auth/logout').set(s1.auth).expect(204);
  expect(await Promise.race([other.closed.then(() => 'closed'), sleep(1500).then(() => 'open')])).toBe('open');
});
it('đăng xuất phát sự kiện collab kèm userId và sessionId', async () => {
  // subscriber ioredis trên COLLAB_ACCESS_CHANNEL nhận { userId, sessionId }
});
it('khoá tài khoản thu hồi mọi phiên và đóng SSE của từng phiên', ...);
```

`openSse(url, headers): { closed: Promise<void> }` là hàm cục bộ trong spec. Hàm đọc `res.body` tới khi `done`, timeout 5 s.

Videos: `it('đăng xuất vô hiệu phiên xem của phiên đăng nhập đó', …)`: start playback bằng một phiên đăng nhập riêng, playlist trả 200; đăng xuất; playlist trả 404; phiên xem của người khác vẫn trả 200.

Collab: `it('sự kiện thu hồi phiên đóng đúng kết nối của phiên đó (4401)', …)`. Dùng hai token cùng user với `sid` A và B (thêm `sid` vào helper `token` của spec); publish `{ sessionId: A }`; A bị đóng với 4401, B vẫn đồng bộ được.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/session-revocation.e2e-spec.ts test/videos.e2e-spec.ts`; `pnpm --filter @luna/collab test:e2e`

- [ ] **Step 3: Implement theo Interfaces**

SSE: `merge(...).pipe(takeUntil(this.revocations.revoked$(sessionId)))`, với `sessionId` lấy từ `@CurrentSession()`.

- [ ] **Step 4: Chạy lại, xác nhận xanh; chạy `auth.e2e-spec.ts`, `documents.e2e-spec.ts`**

- [ ] **Step 5: Commit**

```bash
git commit -am "Close SSE streams, collab connections and playback sessions of a session when it is revoked"
```

---

### Task 11: Khoá `/metrics` và `/internal/*` của collab (2.14)

**Files:**
- Modify: `backend/packages/shared/src/observability.ts` (thêm `requireMetricsTokenInProduction`)
- Create: `backend/packages/shared/src/observability.spec.ts`
- Modify: `backend/apps/collab/src/config.ts` (`collabEnvSchema … .superRefine(requireMetricsTokenInProduction)`)
- Modify: `backend/docker/docker-compose.prod.yml` (router `collab`)
- Modify: `backend/.env.prod.example` (ghi rõ `METRICS_TOKEN` bắt buộc, sinh bằng `openssl rand -base64 32`), `docs/DEPLOY.md`

**Interfaces:**
- Produces: `requireMetricsTokenInProduction(env: { NODE_ENV?: string; METRICS_TOKEN?: string }, ctx: z.RefinementCtx): void`. Thêm issue tại path `['METRICS_TOKEN']`, message `METRICS_TOKEN is required in production`.
- Chỉ áp cho collab, đúng phạm vi spec. API và worker không đi qua Traefik nên giữ như cũ. Nếu đợt 1 đã thêm cấu hình scrape Prometheus cho collab thì thêm bearer token (`authorization.credentials_file` hoặc `credentials`) vào job đó.

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('production thiếu METRICS_TOKEN thì lỗi, dev/test không bắt buộc', () => {
  const schema = observabilityEnvSchema.extend({ NODE_ENV: z.string() }).superRefine(requireMetricsTokenInProduction);
  expect(schema.safeParse({ NODE_ENV: 'production' }).success).toBe(false);
  expect(schema.safeParse({ NODE_ENV: 'production', METRICS_TOKEN: 'x'.repeat(32) }).success).toBe(true);
  expect(schema.safeParse({ NODE_ENV: 'development' }).success).toBe(true);
});
```

- [ ] **Step 2: Chạy `pnpm --filter @luna/shared test`, xác nhận đỏ**

- [ ] **Step 3: Implement; sửa rule Traefik**

```yaml
- traefik.http.routers.collab.rule=Host(`${APP_HOST}`) && PathPrefix(`/collab`) && !PathPrefix(`/collab/metrics`) && !PathPrefix(`/collab/internal`)
```

- [ ] **Step 4: Chạy test shared, `pnpm --filter @luna/collab test:e2e`, `docker compose … config -q`**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "Require METRICS_TOKEN for collab in production and keep its metrics and internal paths off Traefik"
```

---

### Task 12: User MinIO riêng cho app, media host chỉ nhận GET/PUT/HEAD/OPTIONS (2.10)

**Files:**
- Create: `backend/docker/minio/app-user.sh`
- Modify: `backend/docker/docker-compose.prod.yml` (service `minio-init`; env của `migrate`; `depends_on` của api/collab/worker; rule router `media`)
- Modify: `backend/.env.prod.example`, `docs/DEPLOY.md`

**Interfaces:**
- `minio-init` dùng chính image `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` với `entrypoint: ['sh', '/init/app-user.sh']` và mount `./minio:/init:ro`. Image này có sẵn `mc`; kiểm bằng `docker run --rm --entrypoint mc pgsty/minio:RELEASE.2026-08-04T00-00-00Z --version`. Nếu không có thì dùng một image `mc` có pin version. Service chạy `restart: 'no'`, `depends_on: { minio: service_healthy, migrate: service_completed_successfully }`. api, collab và worker thêm `minio-init: { condition: service_completed_successfully }`.
- Env của `minio-init`: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, sáu biến `S3_BUCKET_*`.
- `migrate` override `S3_ACCESS_KEY: ${MINIO_ROOT_USER}`, `S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD}`, vì `infra:init` tạo bucket và lifecycle bằng root.
- Policy `luna-app`: actions `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`, `s3:ListBucket`, `s3:ListBucketMultipartUploads`, `s3:GetBucketLocation`; resources `arn:aws:s3:::<bucket>` và `arn:aws:s3:::<bucket>/*` cho sáu bucket.
- Script chạy lại nhiều lần phải không lỗi: `mc alias set`, `mc admin user add` (đặt lại secret), `mc admin policy create` (ghi đè), `mc admin policy attach … --user …` (bỏ qua lỗi "already attached").
- Router media: `Host(\`${MEDIA_HOST}\`) && (Method(\`GET\`) || Method(\`HEAD\`) || Method(\`PUT\`) || Method(\`OPTIONS\`))`. OPTIONS giữ cho CORS preflight (spec mục 8).
- `.env.prod.example`: `S3_ACCESS_KEY=luna_app`, `S3_SECRET_KEY=` (sinh mới, khác root).

- [ ] **Step 1: Viết script, sửa compose**

- [ ] **Step 2: Kiểm trên máy dev với prod compose**

Run:
```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.prod config -q
docker compose -f docker/docker-compose.prod.yml --env-file .env.prod up -d minio migrate minio-init
docker compose -f docker/docker-compose.prod.yml --env-file .env.prod run --rm minio-init
docker compose -f docker/docker-compose.prod.yml --env-file .env.prod exec minio sh -c 'mc alias set app http://localhost:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" && mc ls app/luna-tmp && ! mc mb app/khong-duoc-tao'
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$MEDIA_HOST/luna-tmp/x"
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "https://$MEDIA_HOST/luna-tmp/x"
```
Expected: lần chạy thứ hai của `minio-init` vẫn exit 0; app liệt kê được bucket nhưng không tạo được bucket mới; POST trả 404 hoặc 405 từ Traefik; OPTIONS không bị Traefik chặn. Sau khi bật cả stack: upload file, xem preview, phát video đều chạy (lặp lại ở Task 17).

- [ ] **Step 3: DEPLOY.md: tạo key app, quy trình xoay key, root chỉ dùng cho `infra:init` và `minio-init`**

- [ ] **Step 4: Commit**

```bash
git commit -am "Give the app its own MinIO user scoped to its buckets and restrict the media host to GET, HEAD, PUT, OPTIONS"
```

---

### Task 13: Mạng riêng cho Tika/Gotenberg, Redis có mật khẩu, pin Tika (2.12)

**Files:**
- Modify: `backend/docker/docker-compose.prod.yml`, `backend/.env.prod.example`, `docs/DEPLOY.md`
- Modify: `backend/apps/worker/test/file-process.e2e-spec.ts` (image Tika pin cùng version)
- Modify: `backend/docker/docker-compose.dev.yml` nếu file này có Tika (pin cùng version)

**Interfaces:**
- Network `processing: { name: luna_processing, internal: true }`. `tika` và `gotenberg` chỉ nằm trong `[processing]`; `worker` nằm trong `[internal, processing]`.
- Redis thêm `'--requirepass', '${REDIS_PASSWORD}'` vào `command` (giữ các cờ đợt 1 đã thêm). Healthcheck: `['CMD-SHELL', 'redis-cli -a "$$REDIS_PASSWORD" --no-auth-warning ping | grep PONG']`, kèm `environment: { REDIS_PASSWORD: ${REDIS_PASSWORD} }`.
- `.env.prod.example`: `REDIS_PASSWORD=` và `REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379`. `redisConnection` và `new Redis(url)` đã đọc được mật khẩu từ URL.
- Tika: lấy version mà `apache/tika:latest-full` đang trỏ tới (`docker run --rm apache/tika:latest-full --version`, hoặc label của image), rồi pin thành `apache/tika:<version>-full` ở mọi nơi.

- [ ] **Step 1: Sửa compose, env, test worker**

- [ ] **Step 2: Kiểm**

Run:
```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.prod up -d
docker compose … exec worker node -e "fetch('http://tika:9998/version').then(r=>console.log(r.status))"
docker compose … exec api node -e "fetch('http://tika:9998/version').then(()=>process.exit(1),()=>console.log('blocked'))"
docker compose … exec tika sh -c 'wget -q -T 5 -O- https://example.com && exit 1 || echo offline'
docker compose … exec redis redis-cli ping
pnpm --filter @luna/worker test:e2e
```
Expected: `200`; `blocked`; `offline`; `NOAUTH Authentication required`; worker e2e PASS.

- [ ] **Step 3: Commit**

```bash
git commit -am "Isolate Tika and Gotenberg on an internal network, password-protect Redis, pin Tika"
```

---

### Task 14: Không để token lọt vào log, và các việc vệ sinh hạ tầng (2.16, 2.18)

**Files:**
- Modify: `backend/docker/docker-compose.prod.yml` (cờ accesslog của Traefik)
- Modify: `backend/apps/api/src/config/logger.ts`; Create: `backend/apps/api/src/config/logger.spec.ts`
- Modify: `backend/Dockerfile` (stage `migrate`: `USER node`)
- Modify: `backend/apps/worker/src/processing/ffmpeg.ts` (mọi `-i` và lệnh gọi ffprobe)
- Modify: `backend/apps/api/src/admin/admin-audit.service.ts:142-145`
- Test: `backend/apps/api/test/admin.e2e-spec.ts:105`

**Interfaces:**
- Produces: `stripQuery(url: string | undefined): string | undefined` trong `logger.ts`; `loggerParams` thêm `serializers: { req: (req) => ({ ...req, url: stripQuery(req.url) }) }`.
- Traefik: trước hết tra docs Traefik 3.6 xem có tuỳ chọn bỏ query string khỏi access log không; nếu có thì dùng. Nếu không có: `--accesslog.format=json`, `--accesslog.fields.names.RequestPath=drop`, `--accesslog.fields.names.RequestLine=drop`. Vẫn giữ `RouterName`, `RequestMethod`, `DownstreamStatus`, `Duration`.
- ffmpeg/ffprobe: thêm `'-protocol_whitelist', 'file'` ngay trước mỗi `'-i'`.
- `csvCell`: regex chặn công thức thành `/^[=+\-@\t\r]/`.

- [ ] **Step 1: Viết test (đỏ)**

```ts
it('log request không chứa query string (token phiên xem)', () => {
  expect(stripQuery('/api/v1/videos/x/hls/master.m3u8?s=secret')).toBe('/api/v1/videos/x/hls/master.m3u8');
  const req = (loggerParams(cfg).pinoHttp as { serializers: { req: (r: object) => { url: string } } }).serializers.req({ method: 'GET', url: '/a?s=1' });
  expect(req.url).toBe('/a');
});
```

`admin.e2e-spec.ts` (bổ sung test CSV hiện có): thêm audit `{ action: 'test.csv', targetType: 'node', targetId: randomUUID(), metadata: { name: '\t=SUM(A1)' } }` và một bản với `'\r=1+1'`. Kỳ vọng body chứa `'\t=SUM(A1)` và `"'\r=1+1"`.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm --filter @luna/api test -- logger`; `pnpm --filter @luna/api exec vitest run --config ./vitest.config.e2e.ts test/admin.e2e-spec.ts`

- [ ] **Step 3: Implement logger, CSV, ffmpeg, Dockerfile, Traefik**

- [ ] **Step 4: Kiểm**

Run: hai lệnh Step 2; `pnpm --filter @luna/worker test:e2e` (transcode và preview vẫn chạy với whitelist); `docker compose … build migrate && docker compose … run --rm --entrypoint id migrate` (ra `uid=1000(node)`); `docker compose … run --rm migrate` exit 0 (nếu Prisma hay tsx báo không ghi được file thì chỉ `chown` đúng đường dẫn trong lỗi); phát một video rồi `docker compose … logs traefik | grep -c 's='` ra `0`.

- [ ] **Step 5: Commit**

```bash
git commit -am "Keep playback tokens out of access logs, run migrations as node, restrict ffmpeg to local files, escape tab and CR in CSV"
```

---

### Task 15: Header bảo mật cho FE (2.11)

**Files:**
- Create: `frontend/security-headers.ts`
- Modify: `frontend/next.config.ts` (thêm `async headers()`)
- Modify: `frontend/Dockerfile` (`ARG MEDIA_ORIGIN`, `ARG COLLAB_ORIGIN` → `ENV`, đặt trước `pnpm build`)
- Modify: `backend/docker/docker-compose.prod.yml` (build args của frontend: `MEDIA_ORIGIN: https://${MEDIA_HOST}`, `COLLAB_ORIGIN: wss://${APP_HOST}`)
- Create: `frontend/scripts/check-security-headers.mjs`; Modify: `frontend/package.json` (`"check:headers": "node scripts/check-security-headers.mjs"`)

**Interfaces:**
- Chọn Next `headers()` thay vì middleware Traefik (spec mục 8 để người làm chọn). Header đi cùng code FE và kiểm được bằng `next start`. Không dùng nonce: nonce bắt mọi trang render động, nên `script-src` phải có `'unsafe-inline'` (theo mục "Without Nonces" trong docs Next).
- Produces: `securityHeaders(opts: { mediaOrigin?: string; collabOrigin?: string; isDev: boolean }): { key: string; value: string }[]`.
- Giá trị khi chạy production:
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: ${media} https://*.googleusercontent.com; media-src 'self' blob: ${media}; connect-src 'self' ${media} ${collab}; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`
  - `X-Content-Type-Options: nosniff`
  - `Strict-Transport-Security: max-age=31536000`. Không có `includeSubDomains` vì spec không yêu cầu và domain mẹ không do app quản lý.
  - `Referrer-Policy: same-origin`
- Khi `isDev`: `script-src` thêm `'unsafe-eval'`; `connect-src`/`img-src`/`media-src` thêm `http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*`; bỏ HSTS và `upgrade-insecure-requests`.
- `headers()` trả `[{ source: '/:path*', headers: securityHeaders({ mediaOrigin: process.env.MEDIA_ORIGIN, collabOrigin: process.env.COLLAB_ORIGIN, isDev: process.env.NODE_ENV === 'development' }) }]`.

- [ ] **Step 1: Viết script kiểm tra (đỏ)**

`check-security-headers.mjs` gọi `fetch(process.env.CHECK_URL ?? 'http://127.0.0.1:5173/login')` và assert:
- status 200;
- CSP chứa `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `worker-src 'self' blob:`, và `MEDIA_ORIGIN` trong `connect-src` lẫn `img-src` khi biến này được đặt; không chứa `'unsafe-eval'`;
- `x-content-type-options` bằng `nosniff`; `strict-transport-security` khớp `/max-age=\d{7,}/`; `referrer-policy` bằng `same-origin`.

Script in từng dòng sai; có lỗi thì exit 1.

Run (trong `frontend/`): `pnpm build && (pnpm start &) && sleep 5 && MEDIA_ORIGIN=https://media.example pnpm check:headers`
Expected: FAIL, thiếu header.

- [ ] **Step 2: Implement `security-headers.ts`, `next.config.ts`, Dockerfile, build args**

- [ ] **Step 3: Kiểm lại**

Run: `MEDIA_ORIGIN=https://media.example COLLAB_ORIGIN=wss://app.example pnpm build && (pnpm start &) && sleep 5 && MEDIA_ORIGIN=https://media.example pnpm check:headers`; `pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Smoke trên trình duyệt (dev: `pnpm dev`; prod compose ở Task 17)**

Mở DevTools Console và đi qua: đăng nhập Google; mở tài liệu (collab kết nối); upload file (PUT lên media); xem preview ảnh/PDF; phát video (HLS và URL ký); mở tài liệu LaTeX (font KaTeX); avatar hiển thị. Expected: không có dòng "Refused to … Content Security Policy".

- [ ] **Step 5: Commit**

```bash
git add frontend backend/docker/docker-compose.prod.yml
git commit -m "Send CSP, nosniff, HSTS and Referrer-Policy from the Next app"
```

---

### Task 16: DOMPurify cho HTML phiên bản tài liệu (2.15)

**Files:**
- Modify: `frontend/package.json` (thêm `dompurify`, pin version 3.x cụ thể, theo cách các dependency khác đang pin)
- Modify: `frontend/src/components/documents/doc-versions-sheet.tsx:18-29`

**Interfaces:**
- `safeHtml(html: string): string` giữ chữ ký và guard SSR (`typeof window === 'undefined'` thì trả `""`). Thân hàm đổi thành `DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })`.

- [ ] **Step 1: Cài và thay**

Run (trong `frontend/`): `pnpm add dompurify@3 --save-exact`

- [ ] **Step 2: Kiểm**

Run: `pnpm lint && pnpm typecheck && pnpm build`. Mở lịch sử phiên bản của một tài liệu rich-text: tiêu đề, bảng, ảnh, highlight hiển thị như trước. FE chưa có test runner nên không thêm unit test.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/components/documents/doc-versions-sheet.tsx
git commit -m "Sanitize document version HTML with DOMPurify"
```

---

### Task 17: Kiểm tra toàn đợt và ghi chú nâng cấp

**Files:**
- Modify: `docs/DEPLOY.md` (mục "Nâng cấp lên đợt 2", gom env mới của Task 8, 9, 11, 12, 13)
- Modify: `docs/PLAN.md` (đánh dấu đợt 2 xong)

- [ ] **Step 1: Kiểm toàn bộ backend**

Run (trong `backend/`): `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 2: Chạy `test:http` với app role trên dev**

Trong `.env` dev: đặt `DATABASE_MIGRATE_URL` bằng URL owner hiện tại, `DATABASE_URL=postgresql://luna_app_user:luna_app_dev_password@localhost:5432/luna?schema=public`, rồi chạy:
```bash
DATABASE_URL=$DATABASE_MIGRATE_URL pnpm --filter @luna/db migrate:deploy
DATABASE_URL=$DATABASE_MIGRATE_URL APP_DATABASE_URL=<url app> pnpm --filter @luna/scripts db:app-login
pnpm dev
pnpm test:http
```
Expected: mọi request xanh. Collab ghi audit được, worker xử lý upload được (nhìn log không có `permission denied`).

- [ ] **Step 3: Smoke prod compose trên máy dev**

`docker compose -f docker/docker-compose.prod.yml --env-file .env.prod up -d --build`, sau đó lặp lại các bước smoke trình duyệt của Task 15 qua Traefik, cộng thêm: tạo folder, xoá, khôi phục; đăng xuất ở tab A thì tài liệu đang mở ở tab A bị ngắt, tab B (phiên khác) vẫn chạy.

- [ ] **Step 4: Viết DEPLOY.md "Nâng cấp lên đợt 2"**

Thứ tự: backup → (pre-flight) `SELECT provider, container, key, count(*) FROM blobs GROUP BY 1,2,3 HAVING count(*) > 1` phải rỗng → thêm env `APP_DB_PASSWORD`/`DATABASE_MIGRATE_URL`/`DATABASE_URL` mới, `S3_ACCESS_KEY`/`S3_SECRET_KEY` của app, `REDIS_PASSWORD`/`REDIS_URL`, `METRICS_TOKEN`, `WORKSPACE_PURGE_DAYS`, `AUTO_VERSION_THIN_DAYS` → `luna build` → `luna up -d`. Bước `migrate` tạo login cho app, `minio-init` tạo user MinIO. Cuối cùng kiểm theo checklist của Task 12, 13, 14.

- [ ] **Step 5: Commit**

```bash
git commit -am "Document the wave 2 upgrade and mark it done"
```
