# Làm lại giao diện người dùng (phương án A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đổi khu người dùng sang bố cục rail workspace + cây nội dung + màn chính giãn hết chiều rộng (mockup A), thêm một endpoint "mới cập nhật trong workspace" cho trang gốc.

**Architecture:** Backend thêm `GET /workspaces/:wsId/recently-updated` trong `LibraryController`/`LibraryService`, lọc quyền bằng `ContentAccessService.visibleTo`, phân trang keyset. Frontend thay `UserSidebar` (dropdown workspace + nav) bằng `WorkspaceRail` + `TreeColumn` (cây lazy dùng API liệt kê folder hiện có), siết khoảng cách ở `TopBar`/`PageBody` dùng chung cho cả admin, tách bảng/lưới thư mục khỏi `FolderPage`, thêm panel phải (mục lục + bình luận) cho tài liệu. URL giữ nguyên.

**Tech Stack:** NestJS + Prisma 7 + zod + vitest/testcontainers + httpyac (backend); Next.js 16.4 app router, React 19.3, Tailwind 4, lucide-react, Tiptap 3 (frontend).

**Spec:** `docs/superpowers/specs/2026-10-30-user-ui-redesign-design.md` · Mockup: `.superpowers/brainstorm/509886-1793334521/content/layout.html` (phương án A, khối đầu tiên).

## Global Constraints

- Không có comment trong mã nguồn (kể cả `eslint-disable`); cần tránh lint thì đổi cách viết (ví dụ ảnh nền CSS thay cho `<img>`).
- Mọi task giao diện chạy theo quy trình skill `evon:ui-ux`, nhánh "dựng luôn theo mockup A đã duyệt, giữ brand/token hiện có" (không làm lại wireframe); kiểm tra trên trình duyệt bằng dev login `?as=<email persona>` (`src/components/shell/personas.ts`).
- Next.js 16: đọc `frontend/node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md` và `04-linking-and-navigating.md` trước khi đổi layout/routing.
- Giữ nguyên URL: `/w/[wsId]/f/...`, `/w/[wsId]/v/...`, `/w/[wsId]/doc/[nodeId]`, `/w/[wsId]/file/[nodeId]`, `/w/[wsId]/trash`, `/shared`, `/favorites`, `/recent`, `/search`.
- Không mất tính năng: chia sẻ, thùng rác, yêu thích, gần đây, tìm kiếm ⌘K, thông báo, thành viên, upload, phiên bản, bình luận, ẩn/hiện theo vai trò (Thùng rác và hành động tạo ẩn với VIEWER).
- Bỏ mọi `max-w` giới hạn vùng nội dung; padding vùng nội dung ~8–12px (`px-3 py-3`, khoảng cách section `gap-3`); thanh trên 44px (`h-11`); tách khu bằng đường kẻ mảnh.
- Admin giữ bố cục dashboard, chỉ nhận thang khoảng cách mới.
- Điện thoại: rail và cây gộp vào một menu trượt; dùng được ở 390px.
- Bộ nhớ trình duyệt luôn bọc try/catch (mẫu `rememberWorkspace` trong `src/lib/workspace.ts`).
- Màu/icon/typography: giữ token `globals.css`, chỉ thêm token cho rail tối.
- Frontend không có unit test: mỗi task FE kết thúc bằng `pnpm typecheck && pnpm lint && pnpm build` (trong `frontend/`, đều phải thoát mã 0) rồi kiểm tra trình duyệt ở 1440px và 390px.

Cách chạy để kiểm tra trình duyệt: `cd backend && pnpm dev` (API :4000) và `cd frontend && pnpm dev` (http://127.0.0.1:5173). Persona: `admin@lunatech.vn` (System Admin), `qa.creator@lunatech.vn` (ADMIN workspace nhóm), `qa.member@lunatech.vn` (MEMBER), `qa.outsider@lunatech.vn` (VIEWER kho công ty), `qa.shared.viewer@lunatech.vn` (chỉ được share). Đổi persona: đăng xuất rồi mở URL kèm `?as=`.

## Review Focus

1. **Workspace nhớ trong trình duyệt không còn hợp lệ hoặc localStorage ném lỗi** (bị xoá khỏi workspace, chế độ riêng tư): rail phải rơi về kho công ty, không trống, không crash. → kiểm tra ở Task 3.
2. **Mở tài liệu được share trong workspace mình không là thành viên**: trang vẫn mở, cây hiện workspace dự phòng, không có request 404 lặp, không mục nào trong cây bị đánh dấu sai. → kiểm tra ở Task 4.
3. **Cây cũ sau khi tạo/đổi tên/di chuyển/xoá/khôi phục/upload ở màn chính**: cây phải tự cập nhật không cần tải lại trang. → kiểm tra ở Task 4 và Task 5.
4. **Thư mục rất nhiều con (>200) hoặc lồng sâu, tên dài tiếng Việt**: cây hiện 200 mục đầu kèm lối "Xem tất cả", tên cắt gọn có tooltip, thụt lề không đẩy tràn cột. → kiểm tra ở Task 4.
5. **Tên workspace khó viết tắt** (một từ, có dấu, có emoji/ký tự đặc biệt, trùng viết tắt): ô rail vẫn có 1–2 ký tự đọc được, tooltip tên đầy đủ, aria-label phân biệt được. → kiểm tra ở Task 3.

---

## File Structure

Backend
- `backend/apps/api/src/common/pagination/cursor.ts` — thêm cặp hàm mã hoá/giải mã cursor keyset (thời điểm + id).
- `backend/apps/api/src/content/library.schemas.ts` — `recentlyUpdatedQuery`.
- `backend/apps/api/src/content/library.service.ts` — `recentlyUpdated()`.
- `backend/apps/api/src/content/library.controller.ts` — route + Swagger.
- `backend/packages/db/prisma/schema.prisma` + migration mới — index `(workspace_id, section, updated_at)`.
- `backend/apps/api/test/recently-updated.e2e-spec.ts` — e2e mới.
- `backend/tests/08-tags-favorites.http` — thêm khối kiểm tra.

Frontend (`frontend/src/`)
- `app/globals.css` — token rail.
- `lib/types.ts` — `MeWorkspace`.
- `lib/format.ts` — `workspaceAbbr()`.
- `lib/workspace.ts` — `useShellWorkspace()`.
- `lib/tree-sync.ts` (mới) — bus làm mới cây.
- `lib/use-thumbnail.ts` — nhận đường dẫn API thay vì nodeId.
- `components/shell/shell.tsx` — `AppFrame` (bề rộng sidebar do sidebar tự quyết), `TopBar` 44px, `PageBody` gọn.
- `components/shell/admin-sidebar.tsx`, `components/shell/nav.tsx` — nhận khoảng cách mới, tự đặt bề rộng.
- `components/shell/workspace-rail.tsx` (mới) — cột workspace.
- `components/shell/tree-column.tsx` (mới) — đầu cột, tab, cây, thùng rác, lối tắt chung.
- `components/shell/content-tree.tsx` (mới) — cây lazy.
- `components/shell/tree-create-menu.tsx` (mới) — menu tạo tài liệu/thư mục/upload từ cây.
- `components/shell/user-sidebar.tsx` — viết lại: ghép rail + cột cây (bỏ `WorkspaceSwitcher`).
- `components/content/folder-page.tsx` — điều phối; dùng bảng/lưới tách riêng; gọi `invalidateTree`.
- `components/content/folder-table.tsx` (mới) — bảng mật độ cao cho thư mục ở tab Tài liệu.
- `components/content/video-grid.tsx` (mới) — lưới thumbnail (tab Video).
- `components/content/favorite-button.tsx` (mới) — tách `FavoriteButton` khỏi folder-page để bảng và lưới dùng chung.
- `components/content/recent-updates.tsx` (mới) — khối "Mới cập nhật" ở gốc workspace.
- `components/documents/document-page.tsx` — bỏ `max-w`, panel phải.
- `components/documents/doc-outline.tsx` (mới) — mục lục.
- `components/documents/doc-side-panel.tsx` (mới) — panel phải có tab Mục lục/Bình luận + trạng thái mở nhớ trong trình duyệt.
- `components/files/file-page.tsx`, `components/content/trash-page.tsx`, `components/content/node-list-page.tsx`, `components/search/search-page.tsx`, `components/documents/latex-workspace.tsx`, `components/admin/*` — chỉnh khoảng cách/`max-w`, gọi `invalidateTree` nơi cần.

---

### Task 1: Endpoint "mới cập nhật trong workspace"

**Files:**
- Modify: `backend/apps/api/src/common/pagination/cursor.ts`
- Modify: `backend/apps/api/src/content/library.schemas.ts`
- Modify: `backend/apps/api/src/content/library.service.ts`
- Modify: `backend/apps/api/src/content/library.controller.ts`
- Modify: `backend/packages/db/prisma/schema.prisma` (model `Node`)
- Create: `backend/packages/db/prisma/migrations/20261030090000_nodes_recent_index/migration.sql`
- Test: `backend/apps/api/test/recently-updated.e2e-spec.ts`
- Modify: `backend/tests/08-tags-favorites.http`

**Interfaces:**
- Produces (HTTP): `GET /api/v1/workspaces/:wsId/recently-updated?section=DOCS|VIDEOS&limit=1..50&cursor=<opaque>` → `200 { items: NodeDto[]; nextCursor: string | null }` (cùng `nodeSchema` như `/workspaces/:wsId/nodes`). Mặc định `section=DOCS`, `limit=20`. Chỉ `DOCUMENT`/`FILE`/`VIDEO`, không folder, không mục trong thùng rác, không mục `UPLOADING`; thứ tự `updatedAt DESC, id DESC`. Người không là thành viên và không có share nào trong workspace (hoặc workspace không tồn tại/đã xoá) → `404`. Cursor sai → `400`.
- Produces (TS): `encodeKeysetCursor(at: Date, id: string): string`, `decodeKeysetCursor(cursor: string): { at: Date; id: string }` (ném `AppError.validation('Invalid cursor')`) trong `cursor.ts`; `recentlyUpdatedQuery` + `type RecentlyUpdatedQuery`; `LibraryService.recentlyUpdated(user: AuthenticatedUser, workspaceId: string, q: RecentlyUpdatedQuery): Promise<Page<NodeDto>>`.

- [ ] **Step 1: Viết e2e đang fail**

Tạo `recently-updated.e2e-spec.ts` theo khuôn `content.e2e-spec.ts` (`createTestApp`, `resetDatabase`, `loginAs`). Chuẩn bị: alice tạo workspace "Updates" với bob; thêm `viewer@lunatech.vn` vai trò `VIEWER` qua `POST /workspaces/:id/members`; `sharee@lunatech.vn` không là thành viên; `guest@lunatech.vn` người ngoài. Alice tạo folder `Chung` và `Riêng` ở gốc DOCS, folder `Phim` ở gốc VIDEOS; tạo lần lượt tài liệu `A` (trong `Chung`), `B` (trong `Riêng`), `C` (gốc) bằng `POST /workspaces/:id/documents`; share `Chung` cho sharee vai trò `VIEWER`. Helper `updates(as, query = '')` gọi `GET /api/v1/workspaces/${wsId}/recently-updated?${query}`; `names(res)` như trong content.e2e-spec; `randomUUID` từ `node:crypto`.

```ts
it('mới nhất trước, không có folder; đổi tên đẩy mục lên đầu', async () => {
  await http().patch(`/api/v1/nodes/${docA}`).set(alice.auth).send({ name: 'A2' }).expect(200);
  const res = await updates(bob).expect(200);
  expect(names(res)).toEqual(['A2', 'C', 'B']);
  expect(res.body.items.every((n: { type: string }) => n.type !== 'FOLDER')).toBe(true);
  expect(res.body.nextCursor).toBeNull();
});

it('phân trang cursor không trùng không sót; cursor sai → 400', async () => {
  const p1 = await updates(bob, 'limit=2').expect(200);
  expect(names(p1)).toEqual(['A2', 'C']);
  const p2 = await updates(bob, `limit=2&cursor=${p1.body.nextCursor}`).expect(200);
  expect(names(p2)).toEqual(['B']);
  expect(p2.body.nextCursor).toBeNull();
  await updates(bob, 'cursor=xxx').expect(400);
  await updates(bob, 'limit=51').expect(400);
});

it('VIEWER của workspace thấy mọi mục với myRole VIEWER', async () => {
  const res = await updates(viewer).expect(200);
  expect(names(res)).toEqual(['A2', 'C', 'B']);
  expect(res.body.items.map((n: { myRole: string }) => n.myRole)).toEqual(['VIEWER', 'VIEWER', 'VIEWER']);
});

it('người chỉ được share chỉ thấy mục trong folder được share', async () => {
  expect(names(await updates(sharee).expect(200))).toEqual(['A2']);
});

it('người ngoài, workspace không tồn tại → 404', async () => {
  await updates(guest).expect(404);
  await http().get(`/api/v1/workspaces/${randomUUID()}/recently-updated`).set(bob.auth).expect(404);
});

it('mục trong thùng rác không xuất hiện; section VIDEOS không lẫn tài liệu', async () => {
  await http().delete(`/api/v1/nodes/${docC}`).set(alice.auth).expect(204);
  expect(names(await updates(bob).expect(200))).toEqual(['A2', 'B']);
  expect(names(await updates(bob, 'section=VIDEOS').expect(200))).toEqual([]);
});
```

- [ ] **Step 2: Chạy để thấy fail**

Run: `cd backend/apps/api && pnpm test:e2e -- test/recently-updated.e2e-spec.ts`
Expected: FAIL, các request trả `404` (route chưa có).

- [ ] **Step 3: Cursor keyset trong `cursor.ts`**

`encodeKeysetCursor(at, id)` = base64url của `` `${at.toISOString()}|${id}` ``; `decodeKeysetCursor` tách theo `|`, kiểm tra ngày hợp lệ và id là uuid (`z.uuid().safeParse`), sai thì `AppError.validation('Invalid cursor')`.

- [ ] **Step 4: Schema query**

Trong `library.schemas.ts`: `recentlyUpdatedQuery = z.object({ section: sectionSchema.default('DOCS'), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) })` (lấy `sectionSchema` từ `nodes.schemas.ts`; export nó nếu chưa export), `export type RecentlyUpdatedQuery = z.output<typeof recentlyUpdatedQuery>`.

- [ ] **Step 5: `LibraryService.recentlyUpdated`**

Kiểm tra quyền vào workspace bằng một truy vấn: workspace tồn tại, `deleted_at IS NULL`, và (là thành viên hoặc có `node_shares` của user trên một node thuộc workspace đó và node chưa bị xoá); không đạt → `AppError.notFound('Workspace not found')`. Rồi truy vấn raw:

```sql
SELECT n.id, n.updated_at FROM nodes n
 WHERE n.workspace_id = ${wsId}::uuid AND n.section = ${q.section}::"NodeSection"
   AND n.type <> 'FOLDER' AND n.deleted_at IS NULL AND n.status <> 'UPLOADING'
   AND ${this.access.visibleTo(user.id)}
   ${cursorClause}
 ORDER BY n.updated_at DESC, n.id DESC
 LIMIT ${q.limit + 1}
```

`cursorClause` = ``Prisma.sql`AND (n.updated_at, n.id) < (${at}, ${id}::uuid)` `` khi có cursor, ngược lại `Prisma.empty`.

Trả `{ items: await this.dto.build(user.id, ids), nextCursor }` với `nextCursor = encodeKeysetCursor(last.updated_at, last.id)` khi có thêm trang (giữ đúng thứ tự `ids`; `dto.build` giữ thứ tự đầu vào như `favorites()` đang dựa vào).

- [ ] **Step 6: Route + Swagger**

Trong `LibraryController`: `@Get('workspaces/:wsId/recently-updated')`, `@ApiTags('favorites')`, `@ApiOperation({ summary: 'Tài liệu/tệp/video mới sửa trong workspace (lọc theo quyền xem)' })`, `@ApiZodQuery(recentlyUpdatedQuery)`, `@ApiZodOk(pageSchema(nodeSchema))`, query qua `ZodValidationPipe(recentlyUpdatedQuery)`.

- [ ] **Step 7: Index**

Thêm `@@index([workspaceId, section, updatedAt])` vào model `Node`; migration tay `20261030090000_nodes_recent_index/migration.sql`: `CREATE INDEX "nodes_workspace_id_section_updated_at_idx" ON "nodes"("workspace_id", "section", "updated_at");` (tên index theo quy ước mặc định của Prisma để schema và migration khớp). Chạy `cd backend/packages/db && pnpm generate` — Expected: thoát 0. Migration được áp ở e2e qua `prisma migrate deploy` trong `test/global-setup.ts`; với DB dev chạy `pnpm migrate:dev` — Expected: báo "Already in sync", không sinh migration mới.

- [ ] **Step 8: Chạy e2e cho pass, và cả bộ content**

Run: `cd backend/apps/api && pnpm test:e2e -- test/recently-updated.e2e-spec.ts test/content.e2e-spec.ts`
Expected: PASS toàn bộ.

- [ ] **Step 9: Thêm khối .http**

Cuối `backend/tests/08-tags-favorites.http`, theo cú pháp các khối sẵn có (`# @ref ws`, `Authorization: Bearer {{...accessToken}}`): member → `?? status == 200` và `?? js response.parsedBody.items.every(n => n.type !== 'FOLDER') == true`; sharedViewer → 200; outsider → 404; `cursor=xxx` → 400. Run: `cd backend && pnpm test:http` — Expected: không có request fail.

- [ ] **Step 10: Lint, typecheck, commit**

Run: `cd backend && pnpm lint && pnpm typecheck && pnpm format:check` — Expected: thoát 0.

```bash
git add backend/apps/api backend/packages/db/prisma backend/tests/08-tags-favorites.http
git commit -m "Recently updated items per workspace and section, filtered by view access"
```

---

### Task 2: Khung và thang khoảng cách mới (dùng chung cả admin)

**Files:**
- Modify: `frontend/src/components/shell/shell.tsx`
- Modify: `frontend/src/components/shell/admin-sidebar.tsx`, `frontend/src/components/shell/nav.tsx`
- Modify: `frontend/src/app/globals.css`
- Modify (bỏ `max-w` vùng nội dung, siết padding): `components/documents/document-page.tsx` (dòng ~497, ~505, ~512, `sticky top-16` → `top-11`, aside `top-32`), `components/documents/latex-workspace.tsx:71`, `components/files/file-page.tsx`, `components/content/node-list-page.tsx`, `components/content/trash-page.tsx`, `components/search/search-page.tsx`, `components/admin/*.tsx` (hàng bảng `sm:h-16` → `sm:h-11`, `sm:pl-5` → `sm:pl-3`)

**Interfaces:**
- Produces: `AppFrame({ sidebar, members, children })` không đổi chữ ký; `<aside>` desktop không còn `w-60` — sidebar tự đặt bề rộng. Drawer mobile: `w-auto max-w-[calc(100vw-40px)]`. `TopBar` cao `h-11`, `px-3`, nút menu `size-9`. `PageBody` = `flex flex-1 flex-col gap-3 px-3 py-3`. Token mới trong `:root` + `@theme inline`: `--rail` (#18181b), `--rail-foreground` (#fafafa), `--rail-item` (#3f3f46), `--rail-item-hover` (#52525b), `--rail-active` (`var(--primary)`) → class `bg-rail`, `text-rail-foreground`, `bg-rail-item`, `hover:bg-rail-item-hover`, `bg-rail-active`.

- [ ] **Step 1:** Chạy skill `evon:ui-ux` (nhánh dựng luôn theo mockup A, giữ token) cho thang khoảng cách; đọc 2 file docs Next nêu ở Global Constraints.
- [ ] **Step 2:** Sửa `AppFrame`, `TopBar`, `PageBody`; `AdminSidebar` bọc nội dung trong cột `w-60 flex flex-col h-full`; `Logo` cao `h-11`, `NavLink` cao `h-9`, `NavGroup` cách `[&+&]:mt-3`.
- [ ] **Step 3:** Bỏ `max-w-[52rem]`/`mx-auto` ở document-page và latex-workspace; card editor `px-3 py-3 sm:px-6 sm:py-4`; vùng `flex ... px-4 py-6 sm:px-6` → `px-3 py-3`. Ở file-page giữ giới hạn theo chiều cao (`max-w-[max(40rem,calc((100dvh-22rem)*16/9))]` chỉ để video không tràn chiều cao màn hình) nhưng đổi `22rem` cho khớp thanh trên mới; mọi `max-w` khác của vùng nội dung bỏ. Giữ `max-w-[..ch]` cho đoạn văn ngắn (thông báo lỗi/rỗng) và popover.
- [ ] **Step 4:** Thêm token rail vào `globals.css`.
- [ ] **Step 5: Verify**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build` — Expected: thoát 0.
Trình duyệt, 1440px: `/w/<company>/f?as=qa.member@lunatech.vn` — thanh trên đo được 44px (DevTools), nội dung chạm sát hai bên chỉ cách ~12px; mở một tài liệu — vùng soạn giãn hết bề ngang, thanh công cụ dính ngay dưới thanh trên không hở/chồng. `/admin?as=admin@lunatech.vn` — sidebar admin vẫn 240px, bảng và thẻ dùng padding mới, không vỡ. 390px: nút menu mở drawer, đóng bằng Esc và bấm nền.
- [ ] **Step 6: Commit** — `git commit -m "Tighter spacing, 44px top bar, full-width content"`

---

### Task 3: Rail workspace và cột cây (khung, chưa có cây)

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/format.ts`, `frontend/src/lib/workspace.ts`
- Create: `frontend/src/components/shell/workspace-rail.tsx`, `frontend/src/components/shell/tree-column.tsx`
- Modify (viết lại): `frontend/src/components/shell/user-sidebar.tsx`
- Modify: `frontend/src/components/content/folder-page.tsx` (bỏ effect `rememberWorkspace`, đã chuyển vào hook)

**Interfaces:**
- Consumes: token rail (Task 2); `CreateWorkspaceDialog`, `WorkspaceSettingsDialog` (`workspace-dialogs.tsx`); `useActiveSection()` (`lib/section.ts`).
- Produces:
  - `type MeWorkspace = Me["workspaces"][number]` (types.ts).
  - `workspaceAbbr(name: string): string` (format.ts): bỏ ký tự không phải `\p{L}\p{N}`; một từ có ≥2 chữ hoa → 2 chữ hoa đầu ("LunaTech" → "LT"); ≥2 từ → chữ đầu của 2 từ đầu ("Kế toán nội bộ" → "KT"); một từ → 2 ký tự đầu ("Marketing" → "MA"); rỗng → "?"; viết hoa bằng `toLocaleUpperCase("vi")`.
  - `useShellWorkspace(): { ws: MeWorkspace | null; routeWsId: string | null; isMember: boolean }` (workspace.ts): `ws` = membership của `params.wsId` nếu là thành viên, ngược lại `lastWorkspace()` nếu còn hợp lệ, ngược lại workspace `COMPANY`, ngược lại phần tử đầu; effect gọi `rememberWorkspace(ws.id)` khi `isMember`.
  - `WorkspaceRail(): JSX.Element` — cột `w-12 bg-rail`, `overflow-y-auto`; COMPANY trước, TEAM sau theo thứ tự `me.workspaces`; mỗi ô `Link` tới `/w/${id}/f`, `size-8 rounded-lg`, chữ `workspaceAbbr`, `title` và `aria-label` = tên đầy đủ, `aria-current="page"` + `bg-rail-active` + vòng sáng khi là `ws.id`; cuối cột nút `Plus` `aria-label="Tạo workspace"` mở `CreateWorkspaceDialog`.
  - `TreeColumn(): JSX.Element` — cột `w-64 border-r bg-surface flex flex-col`: (1) đầu cột `h-11`: tên ws (truncate, `title`) + dòng nhỏ `Công ty · {vai trò}`/`Workspace · {vai trò}`, nút `Settings` (`aria-label="Cài đặt workspace"`) chỉ khi `ws.role === "ADMIN" || me.isSystemAdmin` mở `WorkspaceSettingsDialog`; (2) tab `Tài liệu | Video` là `Link` tới `/w/${ws.id}/f` và `/w/${ws.id}/v`, tab đang chọn = `useActiveSection() ?? section dùng gần nhất (biến module, mặc định DOCS)`; (3) vùng cuộn `flex-1` chứa chỗ cho cây (Task 4) và link Thùng rác `/w/${ws.id}/trash` (ẩn khi `ws.role === "VIEWER"`); (4) vùng cố định cuối cột, kẻ `border-t`, nhãn nhỏ "Chung mọi workspace": Được chia sẻ, Yêu thích, Gần đây, Tìm kiếm (`/search`), mỗi mục đánh dấu active theo `pathname`.
  - `UserSidebar()` = `<div className="flex h-full"><WorkspaceRail/><TreeColumn/></div>`.

- [ ] **Step 1:** Chạy skill `evon:ui-ux` cho rail + cột cây theo mockup A.
- [ ] **Step 2:** Thêm `MeWorkspace`, `workspaceAbbr`, `useShellWorkspace`.
- [ ] **Step 3:** Tạo `WorkspaceRail`, `TreeColumn`; viết lại `UserSidebar` (xoá `WorkspaceSwitcher` và khối cài đặt cuối sidebar cũ).
- [ ] **Step 4: Verify**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build` — Expected: thoát 0.
Trình duyệt 1440px:
- `/w/<company>/f?as=qa.creator@lunatech.vn`: rail có kho công ty đứng đầu, các workspace nhóm sau, ô đang chọn nổi bật; rê chuột thấy tên đầy đủ; bấm một ô nhóm → URL thành `/w/<id>/f` bằng một lần bấm; ⚙ hiện ở workspace mình quản trị và mở dialog cài đặt; ＋ mở dialog tạo, tạo xong ô mới xuất hiện trên rail.
- Cùng persona mở `/shared`, `/favorites`, `/recent`, `/search`: rail vẫn đánh dấu workspace vừa dùng, cột cây vẫn hiện, lối tắt chung active đúng.
- `?as=qa.outsider@lunatech.vn`: không có ⚙, không có Thùng rác.
- Review Focus 1: trong DevTools đặt `localStorage["luna:lastWorkspace"]="00000000-0000-0000-0000-000000000000"` rồi mở `/shared` → rail đánh dấu kho công ty; chặn storage (DevTools → Application → chặn cookie/site data) và tải lại `/` → vẫn vào kho công ty, không lỗi console.
- Review Focus 5: tạo workspace tên "đào tạo", "🚀 Sản phẩm", "LunaTech", "Kế toán" → ô hiện "ĐT", "SP", "LT", "KT"; tooltip đúng tên.
390px: nút menu mở drawer chứa cả rail và cột cây cạnh nhau, không cuộn ngang trang; bấm workspace khác → drawer đóng, đã chuyển.
- [ ] **Step 5: Commit** — `git commit -m "Workspace rail and tree column replace the sidebar dropdown"`

---

### Task 4: Cây nội dung lazy + tạo từ cây + đồng bộ

**Files:**
- Create: `frontend/src/lib/tree-sync.ts`
- Create: `frontend/src/components/shell/content-tree.tsx`
- Create: `frontend/src/components/shell/tree-create-menu.tsx`
- Modify: `frontend/src/components/shell/tree-column.tsx` (gắn cây + menu tạo ở gốc)
- Modify (gọi `invalidateTree`): `components/documents/document-page.tsx` (sau đổi tên `InlineTitle.onSave`, sau `CopyDialog`), `components/content/trash-page.tsx` (sau khôi phục/xoá vĩnh viễn), `components/files/file-page.tsx` (sau đổi tên/xoá/chuyển đổi sang tài liệu nếu có)

**Interfaces:**
- Consumes: `useShellWorkspace` (Task 3); `nodeHref`, `NodeIcon` (`content/node-name.tsx`); `NameDialog`, `NewDocumentDialog` (`content/node-dialogs.tsx`); `useUploads().add(files, { wsId, parentId })`, `useUploads().doneTick(wsId, parentId)`; `DOC_ACCEPT_ATTR`, `VIDEO_ACCEPT_ATTR`, `VIDEO_EXTENSIONS`, `extensionOf` (`lib/files.ts`); `roleAtLeast`, `contentRoleOf` (`lib/format.ts`); `RowMenu`/`MenuAction` (`ui/menu.tsx`).
- Produces:
  - `invalidateTree(wsId: string): void` và `useTreeTick(wsId: string | null): number` (tree-sync.ts, dùng `useSyncExternalStore` như `lib/section.ts`).
  - `ContentTree({ wsId, section, activeId }: { wsId: string; section: NodeSection; activeId: string | null }): JSX.Element` — mỗi cấp gọi `GET /workspaces/${wsId}/nodes` với `{ parentId, section: parentId ? undefined : section, sort: "name", order: "asc", limit: 200 }`, chỉ khi nhánh được mở; deps gồm `useTreeTick(wsId)` và `doneTick(wsId, parentId)`. FOLDER là nhánh (chevron mở/đóng, `aria-expanded`, tên là `Link` tới trang thư mục), mục khác là lá (`Link` tới `nodeHref`). `role="tree"`/`treeitem`, thụt lề `depth * 12px` tối đa 6 cấp rồi giữ nguyên, hàng cao `h-7`, tên `truncate` + `title`. Mục `activeId` có `aria-current="page"` và nền `bg-primary-light`. Tập nhánh mở giữ trong `Map<string, Set<string>>` cấp module theo `wsId:section`; khi `activeId` đổi và người dùng là thành viên, gọi `GET /nodes/${activeId}/breadcrumb` rồi mở mọi tổ tiên. `nextCursor` khác null → dòng cuối "Xem tất cả" link tới trang thư mục đó. Lỗi tải nhánh → dòng "Không tải được · Thử lại".
  - `TreeCreateMenu({ wsId, section, parentId, label }: { wsId: string; section: NodeSection; parentId: string | null; label: string }): JSX.Element` — `RowMenu` với: "Tài liệu mới" (chỉ DOCS; mở `NewDocumentDialog`, tạo xong `invalidateTree` + `router.push(docHref(...))` như folder-page), "Thư mục mới" (`NameDialog` → `POST /workspaces/${wsId}/folders`), "Tải lên" (input file ẩn, lọc đúng loại theo section như `startUpload` trong folder-page). Hiển thị ở đầu cây (gốc) khi `ws.role !== "VIEWER"`, và trên hàng thư mục khi hover/focus nếu `roleAtLeast(node.myRole, "EDITOR")`.
  - `activeId` lấy trong `TreeColumn` từ `useParams<{ nodeId?: string; folder?: string[] }>()`: `nodeId ?? folder?.[0] ?? null`, chỉ khi `routeWsId === ws.id`.

- [ ] **Step 1:** Chạy skill `evon:ui-ux` cho cây (trạng thái mở/đóng, active, hover hành động, rỗng, lỗi, đang tải).
- [ ] **Step 2:** Tạo `tree-sync.ts`, `ContentTree`, `TreeCreateMenu`; gắn vào `TreeColumn`.
- [ ] **Step 3:** Gọi `invalidateTree(wsId)` ở các chỗ liệt kê trong Files.
- [ ] **Step 4: Verify**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build` — Expected: thoát 0.
Trình duyệt 1440px, `?as=qa.member@lunatech.vn`:
- Mở `/w/<company>/f`: cây hiện gốc DOCS; mở một thư mục → tab Network chỉ có một request `nodes?parentId=...`; đóng/mở lại không tải lại.
- Mở thẳng URL một tài liệu nằm sâu 3 cấp → cây tự mở đủ tổ tiên, tài liệu được đánh dấu; chuyển tab Video → cây đổi sang gốc VIDEOS.
- Tạo thư mục và tài liệu từ menu ＋ ở gốc và trên một hàng thư mục → xuất hiện trong cây ngay; upload từ cây → tệp xuất hiện khi xong.
- Review Focus 3: ở màn chính đổi tên, di chuyển, xoá một mục; khôi phục từ Thùng rác; đổi tên tài liệu bằng tiêu đề → cây cập nhật không tải lại trang.
- Review Focus 4: tạo (qua API hoặc script) một thư mục 205 tài liệu → cây hiện 200 mục và "Xem tất cả" dẫn tới trang thư mục; tên 120 ký tự có dấu bị cắt gọn, tooltip đủ; lồng 8 cấp không tràn cột.
- Review Focus 2: `?as=qa.shared.viewer@lunatech.vn` mở một tài liệu được share (từ `/shared`) → trang mở được, cây hiện workspace dự phòng của người đó, Console không có lỗi, Network không có request breadcrumb/nodes lỗi lặp lại.
- `?as=qa.outsider@lunatech.vn` (VIEWER): không có nút ＋ ở gốc và trên hàng thư mục.
390px: mở drawer, mở/đóng nhánh không đóng drawer; bấm một lá → drawer đóng và trang mở.
- [ ] **Step 5: Commit** — `git commit -m "Lazy content tree with create actions and live refresh"`

---

### Task 5: Màn thư mục — bảng gọn (Tài liệu) và lưới thumbnail (Video)

**Files:**
- Create: `frontend/src/components/content/favorite-button.tsx` (chuyển `FavoriteButton` từ folder-page sang, chữ ký giữ nguyên)
- Create: `frontend/src/components/content/folder-table.tsx`
- Create: `frontend/src/components/content/video-grid.tsx`
- Modify: `frontend/src/components/content/folder-page.tsx`
- Modify: `frontend/src/lib/use-thumbnail.ts`, `frontend/src/components/content/node-name.tsx`

**Interfaces:**
- Consumes: `invalidateTree` (Task 4); `MenuAction` (`ui/menu.tsx`).
- Produces:
  - `useThumbnail(src: string | null): string | null` — `src` là đường dẫn API đầy đủ (`/api/v1/files/${id}/thumbnail` hoặc `/api/v1/videos/${id}/poster`), `null` = không tải. `NodeIcon` cập nhật theo chữ ký mới.
  - `FavoriteButton({ node, onChange }: { node: NodeItem; onChange: (fav: boolean) => void })`.
  - `FolderTable({ items, menuFor, onFavorite }: { items: NodeItem[]; menuFor: (n: NodeItem) => MenuAction[][]; onFavorite: (id: string, fav: boolean) => void })` — bảng mật độ cao: hàng `sm:h-9`, icon `size-6`, cột Tên | Tag (`@4xl`) | Người tạo (`@3xl`) | Sửa lần cuối | thao tác; không bọc `Card` bo góc lớn, chỉ `border-y border-border`; mobile giữ dạng 2 cột như hiện tại.
  - `VideoGrid({ items, menuFor, onFavorite }: same)` — `grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3`; thư mục là ô có icon folder + số mục; video là ô 16:9 dùng ảnh poster làm `background-image` (không dùng `<img>` để khỏi cần `eslint-disable`), tên 2 dòng, badge trạng thái xử lý như `NodeName`, nút yêu thích và `RowMenu` ở góc; cả ô là link (`after:absolute after:inset-0`).
  - `FolderPage` giữ chữ ký `FolderPage({ section }: { section: NodeSection })`; `reloadAll` gọi thêm `invalidateTree(wsId)`; hàng công cụ (lọc, sắp xếp, nút tạo/upload, chia sẻ) gộp vào một dòng `h-9` trên desktop.

- [ ] **Step 1:** Chạy skill `evon:ui-ux` cho bảng gọn và lưới video.
- [ ] **Step 2:** Đổi `useThumbnail`; `NodeIcon` chuyển ảnh thumbnail sang `background-image` và bỏ dòng `eslint-disable` cũ; tách `FavoriteButton`; tạo `FolderTable`, `VideoGrid`; `FolderPage` chọn `isVideo ? VideoGrid : FolderTable`, chuyển khối `RowMenu groups` hiện có thành hàm `menuFor`.
- [ ] **Step 3: Verify**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build` — Expected: thoát 0.
Trình duyệt 1440px `?as=qa.member@lunatech.vn`: `/w/<company>/f/<folder>` là bảng, hàng ~36px, thấy ≥15 hàng trên màn 900px cao; mọi thao tác hàng (đổi tên, di chuyển, sao chép, chia sẻ khi là OWNER, gắn tag, xoá) còn; kéo thả tệp vào vùng bảng vẫn upload. `/w/<company>/v/<folder>` là lưới thumbnail có poster thật cho video đã xử lý, thư mục là ô; mở video → trang xem video hiện có `/w/<id>/file/<id>`. `?as=qa.outsider@lunatech.vn`: không có nút tạo/upload, menu hàng không có mục sửa. 390px: bảng thành danh sách 2 cột, lưới 1–2 cột, không cuộn ngang.
- [ ] **Step 4: Commit** — `git commit -m "Dense folder table for documents, thumbnail grid for videos"`

---

### Task 6: Gốc workspace — danh sách gốc + "Mới cập nhật"

**Files:**
- Create: `frontend/src/components/content/recent-updates.tsx`
- Modify: `frontend/src/components/content/folder-page.tsx`

**Interfaces:**
- Consumes: `GET /workspaces/:wsId/recently-updated` (Task 1), `FolderTable`/`VideoGrid` (Task 5), `NodeName`, `formatWhen`.
- Produces: `RecentUpdates({ wsId, section }: { wsId: string; section: NodeSection }): JSX.Element` — tiêu đề "Mới cập nhật" (DOCS) / "Video mới cập nhật" (VIDEOS); DOCS: danh sách gọn mỗi dòng `NodeName` + "Sửa {formatWhen(updatedAt)} · {createdBy.name}"; VIDEOS: hàng ô như `VideoGrid`; tải `limit=10`, nút "Xem thêm" nạp trang kế bằng `nextCursor` và nối vào; rỗng → ẩn cả khối; lỗi → `ErrorBanner` có thử lại. `FolderPage` khi `!folderId && membership`: đặt `RecentUpdates` trên danh sách gốc, ngăn bằng `border-t`; desktop ≥`xl` có thể xếp hai cột (gốc trái, mới cập nhật phải 22rem).

- [ ] **Step 1:** Chạy skill `evon:ui-ux` cho màn gốc.
- [ ] **Step 2:** Tạo `RecentUpdates`, gắn vào `FolderPage`.
- [ ] **Step 3: Verify**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build` — Expected: thoát 0.
Trình duyệt `?as=qa.member@lunatech.vn`: `/w/<company>/f` hiện gốc + "Mới cập nhật" xếp mới nhất trước, không có thư mục; sửa một tài liệu ở tab khác rồi quay lại → tài liệu lên đầu; "Xem thêm" thêm mục không trùng. `/w/<company>/v` hiện video mới cập nhật dạng ô. `?as=qa.outsider@lunatech.vn` (VIEWER) thấy khối với đúng mục được xem. 390px: hai khối xếp dọc.
- [ ] **Step 4: Commit** — `git commit -m "Workspace root shows recently updated items"`

---

### Task 7: Tài liệu — giãn hết chiều rộng, panel phải Mục lục + Bình luận

**Files:**
- Create: `frontend/src/components/documents/doc-outline.tsx`
- Create: `frontend/src/components/documents/doc-side-panel.tsx`
- Modify: `frontend/src/components/documents/document-page.tsx`

**Interfaces:**
- Consumes: `CommentsPanel` (đã có), `useMembersOpen`/`setMembersOpen` (`shell/members-panel.tsx`), `Sheet` (đang dùng trong document-page), `TopBar` prop `actions`.
- Produces:
  - `DocOutline({ editor }: { editor: Editor | null }): JSX.Element` — đọc heading cấp 1–3 bằng `useEditorState` (pos, level, text), danh sách thụt theo cấp; bấm → `editor.commands.setTextSelection(pos)` rồi `scrollIntoView` phần tử DOM tương ứng (`editor.view.nodeDOM(pos)`); không có heading → "Tài liệu chưa có tiêu đề mục".
  - `useDocPanel(): { open: boolean; tab: "outline" | "comments"; setOpen: (v: boolean) => void; setTab: (t: "outline" | "comments") => void }` — nhớ `open`/`tab` trong localStorage khoá `luna:docPanel` (try/catch), mặc định mở, tab `outline`.
  - `DocSidePanel({ tab, onTab, onClose, outline, comments, commentCount }: { tab: "outline" | "comments"; onTab: (t: "outline" | "comments") => void; onClose: () => void; outline: React.ReactNode; comments: React.ReactNode; commentCount: number })` — cột phải `w-72 border-l`, sticky dưới thanh trên (`top-11`, `h-[calc(100dvh-2.75rem)]`), tab "Mục lục | Bình luận {n}", nút đóng.
- Quy tắc hiển thị: chỉ trên trang tài liệu RICH. LaTeX: không có panel (LaTeX hiện không có bình luận; mục lục LaTeX ngoài phạm vi), không có nút bật panel. Nút bật/tắt (`PanelRight`, `aria-pressed`, `aria-label="Mục lục và bình luận"`) đặt trong `TopBar actions`. Desktop ≥`xl`: cột phải; dưới `xl`: `Sheet` như bình luận hiện tại. Panel tài liệu và panel thành viên loại trừ nhau: bật panel tài liệu gọi `setMembersOpen(false)`; khi `useMembersOpen()` là true thì panel tài liệu ẩn. Các luồng bình luận hiện có (chọn đoạn → bình luận, `?thread=` từ thông báo, bấm highlight trong văn bản) chuyển sang mở panel với `tab = "comments"`; nút "Bình luận" trong hàng thao tác cũ bỏ (thay bằng tab).

- [ ] **Step 1:** Chạy skill `evon:ui-ux` cho bố cục tài liệu + panel phải.
- [ ] **Step 2:** Tạo `DocOutline`, `useDocPanel`, `DocSidePanel`; nối vào `document-page.tsx` thay cho `commentsOpen`/aside cũ; tiêu đề + meta + thanh thao tác của tài liệu gọn lại một dòng (`gap-2`, padding `px-3`).
- [ ] **Step 3: Verify**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build` — Expected: thoát 0.
Trình duyệt 1440px `?as=qa.member@lunatech.vn`, một tài liệu có vài heading và bình luận:
- Nội dung giãn từ cột cây tới panel phải; mục lục liệt kê heading, bấm cuộn đúng chỗ; tab Bình luận hiện số bình luận mở; chọn đoạn → "Bình luận" mở panel đúng tab với ô soạn; mở link thông báo có `?thread=` → panel mở đúng luồng.
- Tắt panel, tải lại → vẫn tắt; bật panel thành viên → panel tài liệu ẩn, bật lại panel tài liệu → panel thành viên đóng.
- Phiên bản, Hoạt động, Gắn tag, Tạo bản sao, Tải về, Chia sẻ (khi OWNER) vẫn có trong menu/nút.
- Tài liệu LaTeX: không có nút panel, editor + preview chiếm hết chiều rộng.
- 1280px và 1024px: panel thành Sheet, không đẩy nội dung. 390px: Sheet toàn màn, đóng được.
- [ ] **Step 4: Commit** — `git commit -m "Full-width documents with toggleable outline and comments panel"`

---

### Task 8: Rà soát hồi quy toàn bộ theo vai trò

**Files:**
- Modify: chỉ sửa lỗi phát hiện được trong các file đã chạm ở Task 2–7.

- [ ] **Step 1: Build sạch**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm build` và `git diff main -- src ../backend/apps ../backend/packages | grep -E '^\+\s*(//|/\*|\{/\*)'` — Expected: build thoát 0; lệnh grep không in dòng nào.

- [ ] **Step 2: Danh sách kiểm tra trình duyệt (1440px và 390px, mỗi persona)**

| Persona | Kiểm tra |
|---|---|
| `qa.member@lunatech.vn` | ⌘K mở tìm kiếm và mở được kết quả; chuông thông báo mở, bấm thông báo bình luận tới đúng luồng; panel thành viên mở/đóng; upload tài liệu và video (vào đúng tab); lịch sử phiên bản tệp; Yêu thích/Gần đây/Được chia sẻ liệt kê đúng; Thùng rác khôi phục được |
| `qa.creator@lunatech.vn` | ⚙ cài đặt workspace, mời thành viên; chia sẻ thư mục; tạo workspace mới từ ＋ |
| `qa.outsider@lunatech.vn` | Không có Thùng rác, không có nút tạo/upload ở cây và màn chính; đọc tài liệu chế độ chỉ xem |
| `qa.shared.viewer@lunatech.vn` | `/shared` mở được mục; trang thư mục được share (`/w/<ws>/f/<folder>`) hoạt động; rail chỉ có kho công ty |
| `admin@lunatech.vn` | `/admin`, `/admin/users`, `/admin/workspaces`, `/admin/videos`, `/admin/logs` giữ bố cục dashboard, khoảng cách mới; quay về khu người dùng có rail |

Link cũ: mở trực tiếp `/w/<id>/f/<folder>`, `/w/<id>/v/<folder>`, `/w/<id>/doc/<node>`, `/w/<id>/file/<node>` → đều mở đúng màn và cây đánh dấu đúng.

- [ ] **Step 3: Commit** — `git commit -m "Regression fixes for the redesigned user shell"`
