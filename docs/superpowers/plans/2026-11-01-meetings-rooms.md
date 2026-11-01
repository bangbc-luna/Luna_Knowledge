# Phòng họp trong Luna — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Họp video ngay trong Luna (họp ngay, đặt lịch, mời người, màn chờ, phòng họp có lưới video, chia sẻ màn hình, chat lưu lại, thả icon, giơ tay, quyền chủ trì), SFU đặt trên LiveKit Cloud, có số phút họp cho admin. Plan này là nền cho plan biên bản AI (`2026-11-01-meetings-ai-minutes.md`).

**Architecture:** Thêm package `@luna/meetings` giữ seam `MeetingMedia` (adapter LiveKit + adapter giả cho test) và lõi vòng đời buổi họp (`endMeeting`) để API và worker dùng chung. API có module `meetings` (CRUD, mời, vào phòng → token LiveKit ngắn hạn ký ở server, quyền chủ trì, chat, webhook có kiểm chữ ký). Worker có queue `meetings` (nhắc lịch, đối soát phòng mỗi phút để không phụ thuộc webhook). FE dùng `livekit-client` + `@livekit/components-react` với giao diện tự dựng theo mockup; CSP thêm miền LiveKit. Tự host sau này chỉ là đổi `LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET`.

**Tech Stack:** NestJS 12 ESM, Prisma 7, PostgreSQL 16, BullMQ 6, zod 4, `livekit-server-sdk@2.19.2` (đã kiểm `AccessToken`, `RoomServiceClient`, `WebhookReceiver` trên unpkg d.ts), `livekit-client@2.23.0`, `@livekit/components-react@2.9.24`, `@livekit/components-styles@1.2.0` (pin bản chính xác), Next.js 16, Vitest + testcontainers.

**Spec:** `docs/superpowers/specs/2026-11-01-meetings-ai-notes-design.md` (mục 2, 3, 4.1, 4.2, 4.3 câu đầu, 5, 6 "Băng thông" và "Ghi biên bản AI bật mặc định"). Mockup: `.superpowers/brainstorm/4039640-1793512743/content/meeting.html`.

## Nguồn đã kiểm (2026-11-01)

- `livekit-server-sdk@2.19.2` (unpkg `dist/AccessToken.d.ts`, `grants.d.ts`, `RoomServiceClient.d.ts`, `WebhookReceiver.d.ts`): `new AccessToken(key, secret, { identity, name, metadata, ttl })`, `addGrant(VideoGrant)`, `toJwt(): Promise<string>`; `RoomServiceClient(host, key, secret)` có `createRoom({ name, emptyTimeout, departureTimeout, maxParticipants, metadata })`, `deleteRoom`, `listParticipants`, `mutePublishedTrack(room, identity, trackSid, muted)`, `updateRoomMetadata`, `sendData(room, data, kind, { topic, destinationIdentities })`; `new WebhookReceiver(key, secret).receive(body, authHeader): Promise<WebhookEvent>`; webhook gửi `Content-Type: application/webhook+json`, header `Authorization` là JWT chứa sha256 của body; LiveKit không cam kết giao đủ webhook (có retry).
- `livekit-client@2.23.0` (`dist/src/options.d.ts`, `room/track/options.d.ts`): `adaptiveStream`, `dynacast`, `publishDefaults.simulcast`, `videoCaptureDefaults.resolution = VideoPresets.h720`, `ScreenSharePresets.h1080fps15`, capture option `contentHint: 'text'`.
- LiveKit Cloud (docs.livekit.io/home/cloud/firewall, livekit.com/pricing): host `wss://<subdomain>.livekit.cloud`, vùng phụ dạng `*.production.livekit.cloud`, TURN `*.turn.livekit.cloud:443`. Gói Build $0 có 5.000 participant-phút, **không có giá vượt mức**; gói Ship $50/tháng có 150.000 participant-phút, vượt $0,0005/phút.

## Global Constraints

- Không viết comment trong code (TS, TSX, SQL migration, script, compose). Tên hàm, tên biến và chuỗi phải tự giải thích.
- Hành vi và response API của tính năng hiện có giữ nguyên. Test e2e hiện có không sửa assertion. Chỉ được thêm bảng mới vào `resetDatabase` trong `backend/apps/api/test/create-test-app.ts`.
- Migration theo luật đợt 2: một thư mục `backend/packages/db/prisma/migrations/20261101120000_meetings/`, SQL thuần, `CREATE INDEX` thường (không `CONCURRENTLY`), không có dòng `--`, ràng buộc dữ liệu bằng `CHECK`, FK đầy đủ. Không `GRANT` tay: `luna_app` có DML qua default privileges.
- Khoá bí mật chỉ ở env: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` không bao giờ ra trình duyệt hay vào response. Trình duyệt chỉ nhận `serverUrl` và JWT phòng sống `MEETING_TOKEN_TTL_SEC` (mặc định 600).
- Prod compose giữ nguyên `x-no-owner-secrets`; mọi kết nối tới LiveKit Cloud là kết nối đi ra (API/worker gọi RoomService qua HTTPS). Webhook đi vào qua đường HTTPS hiện có (`APP_HOST`), không mở cổng mới; khi webhook không tới được, đối soát mỗi phút ở worker vẫn kết thúc buổi họp đúng.
- Quyền: vào phòng = thành viên workspace (mọi vai trò) hoặc người được mời; tạo buổi họp = `MEMBER` hoặc `ADMIN` của workspace (spec gọi là "EDITOR trở lên"); điều khiển chủ trì (kết thúc cho mọi người, tắt mic người khác, bật/tắt ghi biên bản AI, sửa/huỷ lịch, mời) = người tạo buổi họp. Người không có quyền nhận 404 `Meeting not found`.
- Băng thông (spec §6): simulcast bật, camera tối đa `VideoPresets.h720`, `adaptiveStream: true`, `dynacast: true`, chia sẻ màn hình `ScreenSharePresets.h1080fps15` + `contentHint: 'text'`.
- Ghi biên bản AI bật mặc định (`aiNotesEnabled = true`); người vào phòng luôn thấy thông báo "Cuộc họp đang được AI ghi biên bản" ở màn chờ khi cờ bật, và dòng "● AI đang ghi biên bản" trong phòng khi cờ bật.
- UI làm theo quy trình skill `evon:ui-ux` (brief → wireframe → người dùng chọn → dựng), hợp bố cục rail + cây hiện có, chữ giao diện tiếng Việt.
- Mỗi task backend xong khi xanh (trong `backend/`): `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm test:e2e`. Task đổi schema zod/route thì chạy `pnpm --filter @luna/api openapi:types` và commit `frontend/src/lib/api-schema.ts` (CI chạy `openapi:check`). Task chạm FE thêm (trong `frontend/`) `pnpm lint && pnpm typecheck && pnpm build`, kiểm trên trình duyệt qua `http://localhost:5173/?as=<email>` (persona trong `frontend/src/components/shell/personas.ts`).
- Sau khi sửa `packages/*`, build lại trước khi chạy vitest của một app: `pnpm turbo run build --filter=@luna/db --filter=@luna/shared --filter=@luna/meetings`.
- Tên test tiếng Việt, identifier tiếng Anh. Commit message là một câu tiếng Anh bình thường, không tiền tố. Làm trên branch `feature/meetings-ai-notes`.
- CI không gọi LiveKit thật: e2e thay `MEETING_MEDIA` bằng `FakeMeetingMedia`. Test adapter LiveKit chỉ ký/giải JWT cục bộ.

## Review Focus

- Hai người cùng bấm "Vào phòng" lúc buổi họp đang `SCHEDULED`: chỉ một `startedAt`, chỉ một dòng audit `meeting.start`, phòng LiveKit tạo một lần (createRoom idempotent). Test: "hai lần vào phòng đồng thời chỉ bắt đầu buổi họp một lần" (Task 4).
- Webhook tới trùng lặp, sai thứ tự hoặc không tới: `participant_left` tới hai lần không đóng hai phiên; `room_finished` sau khi chủ trì đã kết thúc không ghi audit lần hai; không có webhook thì job đối soát kết thúc buổi họp sau `MEETING_EMPTY_GRACE_SEC`. Test ở Task 5 và Task 7.
- Người bị xoá khỏi workspace hoặc bị khoá tài khoản trong khi còn token phòng: lần vào sau nhận 404; buổi họp đang diễn ra thì `requireMeeting` từ chối chat. (Token đã cấp tự hết hạn sau 600 giây; LiveKit vẫn giữ kết nối đang mở, chấp nhận được với spec.) Test ở Task 4 và Task 6.
- Đổi giờ một buổi họp đã đặt lịch: không gửi nhắc theo giờ cũ, gửi đúng một nhắc theo giờ mới; huỷ thì không nhắc. Test ở Task 7.
- Chat có link và chữ dài/HTML: lưu nguyên văn, giới hạn 2000 ký tự, FE hiện như chữ thường và chỉ biến `http(s)://` thành link `rel="noopener noreferrer" target="_blank"`, không render HTML. Test API ở Task 6, kiểm tay ở Task 11.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/packages/meetings/` (mới, `@luna/meetings`) | Seam media + lõi vòng đời dùng chung API/worker (và recorder ở plan 2) |
| `backend/packages/meetings/src/media/meeting-media.ts` | `MeetingMedia` interface, `MediaRole`, `MediaEvent`, token `MEETING_MEDIA` |
| `backend/packages/meetings/src/media/livekit-media.ts` | `LiveKitMeetingMedia` (adapter thật) |
| `backend/packages/meetings/src/testing/fake-media.ts` | `FakeMeetingMedia`, export qua subpath `@luna/meetings/testing` |
| `backend/packages/meetings/src/env.ts` | `meetingsEnvSchema` |
| `backend/packages/meetings/src/lifecycle.ts` | `roomNameFor`, `endMeeting`, `openAttendance`, `closeAttendance` |
| `backend/packages/db/src/notifications.ts` | `writeNotifications` (tách từ `NotificationsService.notify` để worker dùng) |
| `backend/packages/db/prisma/schema.prisma` + migration `20261101120000_meetings` | Bảng `meetings`, `meeting_invites`, `meeting_attendances`, `meeting_chat_messages` |
| `backend/apps/api/src/meetings/meetings.module.ts` | Module |
| `backend/apps/api/src/meetings/meeting-access.service.ts` | `MeetingAccess.require` |
| `backend/apps/api/src/meetings/meetings.service.ts` | Tạo/sửa/huỷ/list/get/mời |
| `backend/apps/api/src/meetings/meeting-room.service.ts` | Vào phòng, token, điều khiển chủ trì |
| `backend/apps/api/src/meetings/meeting-chat.service.ts` | Chat lưu + phát |
| `backend/apps/api/src/meetings/meeting-webhook.controller.ts` | Webhook LiveKit |
| `backend/apps/api/src/meetings/meetings.controller.ts`, `meetings.schemas.ts` | Route + zod |
| `backend/apps/api/src/admin/meeting-usage.service.ts` | Số buổi, số phút họp cho admin |
| `backend/apps/worker/src/processors/meetings.processor.ts` | Nhắc lịch, đối soát phòng |
| `frontend/src/lib/meetings.ts` | Gọi API, kiểu, `linkify` |
| `frontend/src/app/(user)/w/[wsId]/meetings/page.tsx`, `frontend/src/components/meetings/meetings-page.tsx`, `create-meeting-dialog.tsx` | Danh sách + tạo |
| `frontend/src/app/(user)/w/[wsId]/meetings/[meetingId]/page.tsx`, `frontend/src/components/meetings/meeting-page.tsx`, `pre-join.tsx`, `meeting-room.tsx`, `room-stage.tsx`, `room-controls.tsx`, `room-side-panel.tsx`, `reactions.ts` | Trang buổi họp, màn chờ, phòng |
| `frontend/security-headers.ts`, `frontend/scripts/check-security-headers.mjs`, `frontend/next.config.ts`, `frontend/Dockerfile` | CSP thêm `LIVEKIT_ORIGIN` |

Theo từ vựng codebase-design:

- `MeetingMedia` là seam thật, có hai adapter (`LiveKitMeetingMedia`, `FakeMeetingMedia`), và adapter LiveKit dùng cho cả Cloud lẫn tự host. Interface nhỏ (7 method), giấu SDK, kiểu `TrackSource`, cách tìm `trackSid` để tắt mic, chuẩn hoá sự kiện webhook.
- `endMeeting` là module sâu dùng chung ba nơi (API khi chủ trì bấm kết thúc, webhook `room_finished`, job đối soát). Nó đặt `ENDED` có điều kiện (chỉ một lần), đóng mọi phiên tham dự, xoá phòng, ghi audit, rồi gọi `onEnded` (plan 2 nối hàng đợi biên bản vào đây). Deletion test: nếu xoá, ba nơi gọi phải lặp lại logic "chỉ một lần".
- Chat đi qua API (lưu rồi `sendData` topic `luna.chat`), không đi thẳng data channel. Danh tính người gửi do server xác nhận và tin nhắn không mất khi ai đó chưa vào phòng. Icon thả và giơ tay đi thẳng data channel/attributes, không lưu (spec không cần).

---

### Task 1: Package `@luna/meetings` và seam `MeetingMedia`

**Files:**
- Create: `backend/packages/meetings/package.json` (name `@luna/meetings`, `type: module`, exports `"."` và `"./testing"`, deps `livekit-server-sdk: 2.19.2`, `@luna/db: workspace:*`, `@luna/shared: workspace:*`, `zod`), `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` (copy từ `packages/shared`)
- Create: `backend/packages/meetings/src/index.ts`, `src/env.ts`, `src/media/meeting-media.ts`, `src/media/livekit-media.ts`, `src/testing/fake-media.ts`, `src/testing/index.ts`
- Modify: `backend/pnpm-workspace.yaml` không cần (đã gồm `packages/*`); `backend/Dockerfile` (copy package khi build), `backend/turbo.json` nếu có danh sách package
- Test: `backend/packages/meetings/src/media/livekit-media.spec.ts`, `src/testing/fake-media.spec.ts`

**Interfaces:**
- Produces:
  - `meetingsEnvSchema = z.object({ LIVEKIT_URL: z.string().regex(/^wss?:\/\//), LIVEKIT_API_KEY: z.string().min(1), LIVEKIT_API_SECRET: z.string().min(32), MEETING_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(600), MEETING_EMPTY_GRACE_SEC: z.coerce.number().int().min(30).default(120), MEETING_MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(100).default(25), MEETING_REMINDER_MINUTES: z.coerce.number().int().min(1).max(120).default(10) })`
  - `type MediaRole = 'host' | 'participant' | 'recorder'`
  - `interface JoinTokenInput { roomName: string; identity: string; name: string; role: MediaRole; metadata?: string }`
  - `type MediaEvent = { kind: 'room_started' | 'room_finished'; roomName: string; eventId: string; at: Date } | { kind: 'participant_joined' | 'participant_left'; roomName: string; identity: string; eventId: string; at: Date }`
  - `interface MediaParticipant { identity: string; joinedAt: Date; hidden: boolean }`
  - `interface MeetingMedia { readonly serverUrl: string; ensureRoom(roomName: string, metadata: string): Promise<void>; joinToken(input: JoinTokenInput): Promise<string>; endRoom(roomName: string): Promise<void>; muteMicrophone(roomName: string, identity: string): Promise<boolean>; setRoomMetadata(roomName: string, metadata: string): Promise<void>; broadcast(roomName: string, topic: string, payload: unknown): Promise<void>; listParticipants(roomName: string): Promise<MediaParticipant[] | null>; parseWebhook(rawBody: string, authorization: string | undefined): Promise<MediaEvent | null> }`
  - `const MEETING_MEDIA = Symbol('MEETING_MEDIA')`
  - `class LiveKitMeetingMedia implements MeetingMedia` — `constructor(env: Pick<MeetingsEnv, 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET' | 'MEETING_TOKEN_TTL_SEC' | 'MEETING_EMPTY_GRACE_SEC' | 'MEETING_MAX_PARTICIPANTS'>)`
  - `interface RoomMetadata { title: string; aiNotesEnabled: boolean; hostId: string }` và `encodeRoomMetadata(m: RoomMetadata): string`, `decodeRoomMetadata(s: string): RoomMetadata | null`
  - `class FakeMeetingMedia implements MeetingMedia` với trạng thái để test đọc: `rooms: Map<string, { metadata: string; participants: MediaParticipant[] }>`, `ended: string[]`, `muted: Array<{ roomName; identity }>`, `broadcasts: Array<{ roomName; topic; payload }>`, `tokens: JoinTokenInput[]`, `failNext(method: keyof MeetingMedia, err: Error): void`, `signWebhook(event: MediaEvent): { body: string; authorization: string }`

- [ ] **Step 1: Viết test adapter LiveKit (không gọi mạng)**

```ts
it('token người dự: đúng phòng, publish mic/camera/màn hình, không roomAdmin, hết hạn sau 600 giây', async () => {
  const jwt = await media.joinToken({ roomName: 'luna-m1', identity: 'u1', name: 'Lan', role: 'participant' });
  const claims = decodeJwt(jwt);
  expect(claims.sub).toBe('u1');
  expect(claims.exp! - claims.iat!).toBe(600);
  expect(claims.video).toMatchObject({ roomJoin: true, room: 'luna-m1', canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true, canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'] });
  expect(claims.video.roomAdmin).toBeUndefined();
});
it('token recorder: ẩn, chỉ subscribe, không publish', async () => {
  const claims = decodeJwt(await media.joinToken({ roomName: 'luna-m1', identity: 'luna-recorder', name: 'Luna AI', role: 'recorder' }));
  expect(claims.video).toMatchObject({ roomJoin: true, hidden: true, canSubscribe: true, canPublish: false, canPublishData: false });
});
it('webhook: chữ ký đúng → MediaEvent chuẩn hoá; sai chữ ký hoặc thiếu header → null', async () => { ... });
```

Chủ trì nhận cùng grant với người dự (điều khiển chủ trì đi qua API Luna, không qua `roomAdmin` ở trình duyệt). Test webhook ký body bằng `new AccessToken(key, secret)` với `sha256` = base64 sha256 của body (đúng cách `WebhookReceiver` kiểm).

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/meetings test` → FAIL "Cannot find module './livekit-media.js'".

- [ ] **Step 3: Cài đặt**

`LiveKitMeetingMedia`: `serverUrl = LIVEKIT_URL`; RoomService host = `LIVEKIT_URL` đổi `wss://`→`https://`, `ws://`→`http://`. `ensureRoom` gọi `createRoom({ name, emptyTimeout: MEETING_EMPTY_GRACE_SEC, departureTimeout: MEETING_EMPTY_GRACE_SEC, maxParticipants: MEETING_MAX_PARTICIPANTS + 1, metadata })` (createRoom trả phòng có sẵn nếu đã tồn tại). `muteMicrophone` tìm track `source === TrackSource.MICROPHONE` qua `getParticipant`, gọi `mutePublishedTrack(..., true)`, trả `false` nếu người đó không có mic. `listParticipants` trả `null` khi phòng không tồn tại (lỗi `TwirpError` code `not_found`). `broadcast` gửi `JSON.stringify(payload)` UTF-8, `DataPacket_Kind.RELIABLE`, `{ topic }`. `parseWebhook` chỉ map 4 sự kiện trên; sự kiện khác trả `null`; lỗi chữ ký trả `null` (controller trả 401). `eventId` = `event.id`. `FakeMeetingMedia.signWebhook` sinh body JSON và header theo cùng định dạng mà `parseWebhook` của Fake kiểm (HMAC với secret cố định của Fake).

- [ ] **Step 4: Chạy, thấy pass** — `pnpm --filter @luna/meetings test` → PASS.

- [ ] **Step 5: Thêm env** — thêm 7 biến vào `backend/.env.example` và `backend/.env.prod.example` (giá trị rỗng cho khoá, `LIVEKIT_URL=wss://your-project.livekit.cloud`); `.env.example` ghi dev dùng project LiveKit Cloud gói Build (miễn phí) hoặc `livekit-server --dev` (`LIVEKIT_URL=ws://localhost:7880`, `LIVEKIT_API_KEY=devkey`, `LIVEKIT_API_SECRET=secret` cần đủ 32 ký tự nên dùng `--keys`).

- [ ] **Step 6: Lệnh tổng (Global Constraints) xanh, commit** — `git commit -m "Add the meetings package with a LiveKit media seam and an in-memory fake"`

---

### Task 2: Bảng dữ liệu buổi họp và audit action

**Files:**
- Modify: `backend/packages/db/prisma/schema.prisma` (thêm enum + 4 model + relation ngược ở `User`, `Workspace`)
- Create: `backend/packages/db/prisma/migrations/20261101120000_meetings/migration.sql`
- Modify: `backend/packages/db/src/audit.ts` (thêm action, giữ thứ tự chữ cái)
- Create: `backend/packages/db/src/notifications.ts`; Modify: `backend/packages/db/src/index.ts`, `backend/apps/api/src/notifications/notifications.service.ts` (`notify` gọi `writeNotifications`, hành vi giữ nguyên)
- Create: `backend/packages/meetings/src/lifecycle.ts`
- Modify: `backend/apps/api/test/create-test-app.ts` (`resetDatabase` thêm `meeting_chat_messages, meeting_attendances, meeting_invites, meetings` trước `workspaces`)
- Test: `backend/apps/api/test/db-integrity.e2e-spec.ts` (thêm case), `backend/apps/api/test/db-roles.e2e-spec.ts` (thêm case). `endMeeting` cần DB nên được test qua e2e ở Task 4, 5, 7.

**Interfaces:**
- Produces (Prisma):
  - `enum MeetingStatus { SCHEDULED LIVE ENDED CANCELLED }`
  - `model Meeting { id uuid7; workspaceId; title String; status MeetingStatus @default(SCHEDULED); scheduledAt DateTime?; startedAt DateTime?; endedAt DateTime?; endReason String?; aiNotesEnabled Boolean @default(true); createdById; createdAt; updatedAt }` → bảng `meetings`; `@@index([workspaceId, status, scheduledAt])`, `@@index([workspaceId, createdAt(sort: Desc)])`, `@@index([status], map: "meetings_live_idx", where: raw("status = 'LIVE'"))`
  - `model MeetingInvite { meetingId; userId; invitedById String?; createdAt; @@id([meetingId, userId]); @@index([userId]) }` → `meeting_invites`
  - `model MeetingAttendance { id uuid7; meetingId; userId; joinedAt; leftAt DateTime?; @@index([meetingId, userId]); @@unique([meetingId, userId], map: "meeting_attendances_one_open", where: raw("left_at IS NULL")) }` → `meeting_attendances`
  - `model MeetingChatMessage { id uuid7; meetingId; userId; body String; createdAt; @@index([meetingId, createdAt]) }` → `meeting_chat_messages`
  - FK: `meetings.workspace_id → workspaces ON DELETE CASCADE`, `created_by → users`, các bảng con `meeting_id → meetings ON DELETE CASCADE`, `user_id → users ON DELETE CASCADE`, `invited_by → users ON DELETE SET NULL`.
  - CHECK (đặt tên): `meetings_title_len CHECK (char_length(title) BETWEEN 1 AND 200)`, `meetings_ended_after_started CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)`, `meetings_scheduled_has_time CHECK (status <> 'SCHEDULED' OR scheduled_at IS NOT NULL)`, `meeting_attendances_left_after_join CHECK (left_at IS NULL OR left_at >= joined_at)`, `meeting_chat_body_len CHECK (char_length(body) BETWEEN 1 AND 2000)`.
- Produces (TS):
  - Audit action mới: `meeting.ai_notes_toggle`, `meeting.cancel`, `meeting.create`, `meeting.end`, `meeting.invite`, `meeting.mute_participant`, `meeting.start`, `meeting.uninvite`, `meeting.update`.
  - `writeNotifications(db: Pick<PrismaClient, 'notification'>, publish: (channel: string, message: string) => Promise<unknown>, userIds: Iterable<string>, type: string, payload: Prisma.InputJsonObject): Promise<void>` — đúng logic `NotificationsService.notify` hiện nay (dedupe, `createManyAndReturn`, publish `notifyChannel`, nuốt lỗi publish); `NotificationsService.notify` giữ try/catch + log.
  - `roomNameFor(meetingId: string): string` = `` `luna-${meetingId}` ``
  - `type EndReason = 'host' | 'empty' | 'room_finished'`
  - `type MeetingEndedHook = (meeting: { id: string; workspaceId: string; aiNotesEnabled: boolean }) => Promise<void>` và `const MEETING_ENDED_HOOK = Symbol('MEETING_ENDED_HOOK')` (API và worker provide mặc định `async () => undefined`; plan 2 thay bằng hàm enqueue biên bản)
  - `endMeeting(deps: { db: PrismaClient; media: MeetingMedia; onEnded?: (meeting: { id: string; workspaceId: string; aiNotesEnabled: boolean }) => Promise<void> }, meetingId: string, reason: EndReason, actorId: string | null): Promise<boolean>` — `UPDATE meetings SET status='ENDED', ended_at=now(), end_reason=$reason WHERE id=$id AND status='LIVE'`; nếu 0 dòng trả `false` và không làm gì thêm; nếu 1 dòng: đóng mọi attendance mở (`left_at = ended_at`), `writeAudit({ action: 'meeting.end', metadata: { reason } })`, `media.endRoom` (lỗi chỉ log), `onEnded`, trả `true`.
  - `openAttendance(db, meetingId, userId, at: Date): Promise<void>` (bỏ qua nếu đã có phiên mở — dựa vào unique partial index, bắt P2002), `closeAttendance(db, meetingId, userId, at: Date): Promise<void>` (đóng phiên mở nếu có).

- [ ] **Step 1: Viết test DB**

```ts
it('meetings: CHECK chặn tiêu đề rỗng, kết thúc trước khi bắt đầu, lịch thiếu giờ, chat quá 2000 ký tự', ...)
it('meeting_attendances: mỗi người chỉ một phiên mở trong một buổi họp', ...)
it('luna_app có SELECT/INSERT/UPDATE/DELETE trên 4 bảng buổi họp', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/api test:e2e -- db-integrity db-roles` → FAIL "relation \"meetings\" does not exist".

- [ ] **Step 3: Sửa schema, sinh migration** — `pnpm db:migrate --create-only --name meetings`, đổi tên thư mục thành `20261101120000_meetings`, sửa tay SQL: xoá mọi dòng `--`, thêm 5 CHECK, giữ `CREATE INDEX` thường và partial index. Thêm audit action, `writeNotifications`, `lifecycle.ts`.

- [ ] **Step 4: Chạy, thấy pass** — cùng lệnh → PASS; `pnpm --filter @luna/api test:e2e -- migration-upgrade` vẫn PASS.

- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Add meeting tables, audit actions and a shared notification writer"`

---

### Task 3: API tạo, xem, sửa, huỷ buổi họp và mời người

**Files:**
- Create: `backend/apps/api/src/meetings/meetings.module.ts`, `meeting-access.service.ts`, `meetings.service.ts`, `meetings.controller.ts`, `meetings.schemas.ts`
- Modify: `backend/apps/api/src/app.module.ts` (import `MeetingsModule`), `backend/apps/api/src/config/app-config.ts` (`.extend(meetingsEnvSchema.shape)`)
- Modify: `backend/apps/api/test/global-setup.ts` (đặt env LiveKit giả: `LIVEKIT_URL=wss://fake.livekit.test`, key/secret giả 32+ ký tự)
- Modify: `backend/apps/api/test/create-test-app.ts` (luôn override `MEETING_MEDIA` bằng `new FakeMeetingMedia()`, trả `media` trong `TestContext`)
- Test: `backend/apps/api/test/meetings.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 models; `ContentAccessService.requireMember`; `UsersService.findOrProvision(email)`; `NotificationsService.notify`; `AuditService.log`.
- Produces:
  - `MeetingAccess.require(user: AuthenticatedUser, meetingId: string): Promise<MeetingAccessResult>` với `interface MeetingAccessResult { meeting: Meeting; isHost: boolean; memberRole: WorkspaceRole | null; invited: boolean }` — 404 `Meeting not found` nếu workspace đã xoá, user không ACTIVE, hoặc không phải thành viên lẫn người được mời. `requireHost(user, meetingId)` = `require` + 403 `Only the meeting host can do this` nếu `!isHost`.
  - Route (tiền tố `/api/v1`):
    - `POST workspaces/:wsId/meetings` body `createMeetingBody = { title: string(1..200, trim), mode: 'instant' | 'scheduled', scheduledAt?: ISO datetime (bắt buộc khi scheduled, phải > now - 5 phút), aiNotesEnabled?: boolean (mặc định true), inviteeEmails?: string[] (≤ 50, email) }` → 201 `MeetingDto`. `instant` tạo với status `SCHEDULED`, `scheduledAt = now` (sẽ LIVE khi người đầu tiên vào). Quyền: `requireMember(..., 'MEMBER')`.
    - `GET workspaces/:wsId/meetings?scope=upcoming|live|past&cursor&limit` → `Page<MeetingDto>`; người không phải thành viên nhưng được mời không thấy danh sách (họ vào bằng link/thông báo).
    - `GET meetings/:id` → `MeetingDetailDto = MeetingDto & { invitees: UserSummary[]; attendees: Array<UserSummary & { joinedAt; leftAt }>; canHost: boolean }`
    - `PATCH meetings/:id` body `{ title?, scheduledAt?, aiNotesEnabled? }` (chỉ khi SCHEDULED, chỉ host) → `MeetingDetailDto`; audit `meeting.update`.
    - `POST meetings/:id/cancel` (chỉ SCHEDULED, host) → 204; audit `meeting.cancel`; thông báo `meeting.cancelled` cho người được mời.
    - `POST meetings/:id/invites` body `{ emails: string[] (1..50) }` (host, không cho khi ENDED/CANCELLED) → `{ added: UserSummary[] }`; audit `meeting.invite`; thông báo `meeting.invited` payload `{ meetingId, workspaceId, title, scheduledAt, byName }`. Email ngoài `ALLOWED_GOOGLE_DOMAINS` → 400 do `findOrProvision` (giữ hành vi share).
    - `DELETE meetings/:id/invites/:userId` (host) → 204; audit `meeting.uninvite`.
  - `MeetingDto = { id, workspaceId, title, status, scheduledAt, startedAt, endedAt, aiNotesEnabled, createdBy: UserSummary, attendeeCount: number }`
  - Audit `meeting.create` metadata `{ title, mode, scheduledAt, aiNotesEnabled, inviteeCount }`.

- [ ] **Step 1: Viết test e2e**

```ts
it('tạo họp ngay và đặt lịch: MEMBER/ADMIN tạo được, VIEWER 403, người ngoài 404; ghi audit meeting.create', ...)
it('đặt lịch thiếu giờ hoặc giờ trong quá khứ → 400', ...)
it('mời người ngoài workspace: tạo tài khoản như share, gửi thông báo meeting.invited, người được mời xem được buổi họp nhưng không thấy trong danh sách workspace', ...)
it('xem buổi họp: thành viên mọi vai trò xem được; người ngoài và người bị khoá tài khoản 404', ...)
it('chỉ người tạo sửa, huỷ, mời; huỷ gửi meeting.cancelled; sửa buổi họp đã kết thúc → 409', ...)
it('danh sách theo scope: upcoming theo scheduledAt tăng dần, past theo endedAt giảm dần, phân trang cursor', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/api test:e2e -- meetings` → FAIL 404 route.

- [ ] **Step 3: Cài đặt** — `MeetingsModule` provide `{ provide: MEETING_MEDIA, inject: [APP_CONFIG], useFactory: (c) => new LiveKitMeetingMedia(c) }` và export `MeetingAccess`. Sửa trạng thái sai (ENDED/CANCELLED) trả 409 `This meeting has already ended`.

- [ ] **Step 4: Chạy, thấy pass**; chạy `pnpm --filter @luna/api openapi:types`.

- [ ] **Step 5: Lệnh tổng xanh, commit** `frontend/src/lib/api-schema.ts` cùng — `git commit -m "Let workspace members create, schedule and invite people to meetings"`

---

### Task 4: Vào phòng, token LiveKit và điều khiển chủ trì

**Files:**
- Create: `backend/apps/api/src/meetings/meeting-room.service.ts`
- Modify: `meetings.controller.ts`, `meetings.schemas.ts`
- Test: `backend/apps/api/test/meeting-room.e2e-spec.ts`

**Interfaces:**
- Consumes: `MeetingAccess`, `MEETING_MEDIA`, `MEETING_ENDED_HOOK`, `endMeeting`, `roomNameFor`, `encodeRoomMetadata`.
- Produces:
  - `MeetingsModule` provide `MEETING_ENDED_HOOK` mặc định; mọi chỗ gọi `endMeeting` (Task 4, 5, 7) truyền `onEnded` lấy từ token này.
  - `POST meetings/:id/join` → `{ serverUrl: string; token: string; roomName: string; identity: string; aiNotesEnabled: boolean; isHost: boolean; expiresInSec: number }`. Luồng: `require`; ENDED/CANCELLED → 409 `This meeting has already ended`; trong một transaction `UPDATE meetings SET status='LIVE', started_at=now() WHERE id=$1 AND status='SCHEDULED' RETURNING id` — nếu đổi được thì audit `meeting.start`; sau transaction gọi `media.ensureRoom(roomName, metadata)` (không gọi mạng trong transaction); `joinToken({ identity: user.id, name: user.name, role: isHost ? 'host' : 'participant', metadata: JSON.stringify({ avatarUrl }) })`. Throttle: 20 lần/phút/người.
  - `POST meetings/:id/end` (host, LIVE) → 204, gọi `endMeeting(..., 'host', user.id)`; ENDED rồi → 204 (idempotent).
  - `POST meetings/:id/participants/:userId/mute` (host, LIVE) → `{ muted: boolean }`; audit `meeting.mute_participant` metadata `{ userId }`.
  - `PUT meetings/:id/ai-notes` body `{ enabled: boolean }` (host, SCHEDULED hoặc LIVE) → `{ aiNotesEnabled }`; cập nhật DB rồi `media.setRoomMetadata` nếu LIVE; audit `meeting.ai_notes_toggle`. Phát `broadcast(roomName, 'luna.meeting', { type: 'ai_notes', enabled })` để trình duyệt cập nhật dòng thông báo ngay.
  - Lỗi media (`ensureRoom`, `joinToken`) → 503 `The meeting service is unavailable, try again in a moment`.

- [ ] **Step 1: Viết test e2e**

```ts
it('vào phòng lần đầu: SCHEDULED → LIVE, startedAt đặt, audit meeting.start, phòng tạo với metadata aiNotesEnabled', ...)
it('hai lần vào phòng đồng thời chỉ bắt đầu buổi họp một lần', async () => {
  await Promise.all([a.agent.post(`/api/v1/meetings/${id}/join`), b.agent.post(`/api/v1/meetings/${id}/join`)]);
  expect(await countAudit('meeting.start', id)).toBe(1);
});
it('token: identity là userId, vai trò host cho người tạo, participant cho người khác; người được mời ngoài workspace vào được', ...)
it('người bị xoá khỏi workspace sau khi buổi họp bắt đầu → join 404', ...)
it('buổi họp đã kết thúc hoặc đã huỷ → join 409', ...)
it('chủ trì kết thúc: ENDED, đóng mọi phiên tham dự, xoá phòng, audit meeting.end reason host; gọi lại vẫn 204 và không thêm audit', ...)
it('chỉ chủ trì tắt mic người khác và bật/tắt ghi biên bản; người khác 403', ...)
it('LiveKit lỗi khi tạo phòng → 503, buổi họp vẫn LIVE để lần sau vào lại được', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/api test:e2e -- meeting-room` → FAIL 404 route.
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass**; `pnpm --filter @luna/api openapi:types`.

- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Issue short-lived LiveKit tokens and add host controls for meetings"`

---

### Task 5: Webhook LiveKit, phiên tham dự và nhận biết kết thúc

**Files:**
- Create: `backend/apps/api/src/meetings/meeting-webhook.controller.ts`
- Modify: `backend/apps/api/src/setup-app.ts` (thêm `useBodyParser('raw', { type: 'application/webhook+json', limit: '64kb' })` trước parser json; không đổi parser json)
- Test: `backend/apps/api/test/meeting-webhook.e2e-spec.ts`

**Interfaces:**
- Consumes: `MeetingMedia.parseWebhook`, `openAttendance`, `closeAttendance`, `endMeeting`, `MEETING_ENDED_HOOK`, Redis (`REDIS`).
- Produces:
  - `POST /api/v1/meetings/livekit/webhook` (`@Public()`, `@SkipThrottle()`, `@ApiExcludeEndpoint()`), header `Authorization`, body raw → 401 `Invalid webhook signature` khi `parseWebhook` trả null do chữ ký; 200 `{ ok: true }` cả khi sự kiện không liên quan.
  - Chống trùng: `SET meeting-webhook:<eventId> 1 NX EX 86400`; đã có → 200 không xử lý.
  - `roomName` không có dạng `luna-<uuid>` hoặc không có meeting → 200 bỏ qua.
  - `participant_joined` (identity là uuid của user, không phải `luna-recorder`) → `openAttendance`; nếu meeting đang SCHEDULED (người vào thẳng phòng bằng token cũ) thì không đổi trạng thái.
  - `participant_left` → `closeAttendance`.
  - `room_finished` → `endMeeting(..., 'room_finished', null)`.

- [ ] **Step 1: Viết test e2e** (ký bằng `ctx.media.signWebhook`)

```ts
it('webhook sai chữ ký → 401, không đổi dữ liệu', ...)
it('participant_joined rồi participant_left → một phiên tham dự có joinedAt và leftAt', ...)
it('cùng một eventId gửi hai lần chỉ xử lý một lần', ...)
it('participant_left tới trước participant_joined (sai thứ tự) không tạo phiên mở treo', ...)
it('room_finished sau khi chủ trì đã kết thúc không ghi audit meeting.end lần hai', ...)
it('room_finished của phòng không thuộc Luna → 200, bỏ qua', ...)
```

Với sai thứ tự: `closeAttendance` không có phiên mở thì ghi Redis `meeting-left:<meetingId>:<userId>` = thời điểm, TTL 60s; `openAttendance` thấy khoá này với `at` sau `joinedAt` thì tạo phiên đã đóng.

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/api test:e2e -- meeting-webhook` → FAIL.
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass** — cùng lệnh → PASS.
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Track attendance and meeting end from signed LiveKit webhooks"`

---

### Task 6: Chat lưu theo buổi họp

**Files:**
- Create: `backend/apps/api/src/meetings/meeting-chat.service.ts`
- Modify: `meetings.controller.ts`, `meetings.schemas.ts`
- Test: `backend/apps/api/test/meeting-chat.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST meetings/:id/messages` body `{ body: string }` (trim, 1..2000) → 201 `ChatMessageDto = { id, body, createdAt, author: UserSummary }`; chỉ khi LIVE (khác → 409 `Chat is only open while the meeting is live`); sau khi lưu gọi `media.broadcast(roomName, 'luna.chat', dto)`, lỗi broadcast chỉ log (tin vẫn lưu, FE tải lại qua GET). Throttle 30 lần/phút/người.
  - `GET meetings/:id/messages?cursor&limit(≤200)` → `Page<ChatMessageDto>` theo `createdAt` tăng dần; xem được cả sau khi buổi họp kết thúc (người có quyền vào phòng).
  - Plan 2 dùng: `MeetingChatService.timeline(meetingId): Promise<Array<{ userId: string; body: string; createdAt: Date }>>`.

- [ ] **Step 1: Viết test e2e**

```ts
it('gửi tin có link và thẻ HTML: lưu nguyên văn, phát topic luna.chat tới phòng, GET trả đúng thứ tự', ...)
it('tin rỗng hoặc dài hơn 2000 ký tự → 400; buổi họp chưa bắt đầu hoặc đã kết thúc → 409', ...)
it('người bị xoá khỏi workspace giữa buổi họp không gửi được tin (404)', ...)
it('LiveKit lỗi khi phát: tin vẫn lưu và trả 201', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/api test:e2e -- meeting-chat` → FAIL.
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass** — cùng lệnh → PASS; `pnpm --filter @luna/api openapi:types`.
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Persist meeting chat and relay it to the room"`

---

### Task 7: Worker — nhắc lịch và đối soát phòng

**Files:**
- Modify: `backend/packages/shared/src/constants.ts` (`QUEUES.MEETINGS = 'meetings'`), `backend/packages/shared/src/jobs.ts` (`JobPayloads['meetings'] = { remind: { meetingId: string; scheduledAt: string }; reconcile: Empty }`, `enqueueMeetingReminder(queue, meetingId, scheduledAt: Date, reminderMinutes: number): Promise<void>`)
- Create: `backend/apps/worker/src/processors/meetings.processor.ts`
- Modify: `backend/apps/worker/src/worker.module.ts` (register queue, provide `MEETING_MEDIA`, processor), `backend/apps/worker/src/config/worker-config.ts` (`.extend(meetingsEnvSchema.shape)`), `backend/apps/worker/src/infra/redis.provider.ts` (publisher dùng cho `writeNotifications`)
- Modify: `backend/apps/api/src/infra/queue/queue.module.ts` (đăng ký queue `meetings`), `meetings.service.ts` (enqueue khi tạo lịch, đổi giờ)
- Test: `backend/apps/worker/test/meetings.e2e-spec.ts`, `backend/packages/shared/src/jobs.spec.ts`

**Interfaces:**
- Produces:
  - `enqueueMeetingReminder`: `delay = max(0, scheduledAt - reminderMinutes*60000 - now)`, `jobId = remind-${meetingId}-${scheduledAt.getTime()}`, `removeOnComplete: true, removeOnFail: 100`. Không nhắc nếu `scheduledAt - now < 60s` (họp ngay).
  - `remind`: đọc meeting; chỉ gửi khi `status === 'SCHEDULED'` và `scheduledAt.toISOString() === data.scheduledAt` (đổi giờ hay huỷ thì job cũ tự bỏ qua). Thông báo `meeting.reminder` tới người tạo + người được mời + mọi thành viên workspace nếu workspace là TEAM (COMPANY: chỉ người được mời và người tạo, tránh nhắc cả công ty). Payload `{ meetingId, workspaceId, title, scheduledAt }`.
  - `reconcile` (job scheduler `every: 60_000`): với mỗi meeting LIVE: `media.listParticipants(roomName)`; `null` (phòng không còn) hoặc không có người không ẩn và `startedAt` cũ hơn `MEETING_EMPTY_GRACE_SEC` → `endMeeting(..., 'empty', null)` kèm hook (worker dùng cùng hook, xem plan 2). Đồng thời đóng các phiên tham dự mở của người không còn trong danh sách. Meeting LIVE quá 12 giờ → `endMeeting(..., 'empty')`.

- [ ] **Step 1: Viết test**

```ts
it('đổi giờ buổi họp: nhắc theo giờ mới, job giờ cũ chạy không gửi gì', ...)
it('huỷ buổi họp: job nhắc chạy không gửi gì', ...)
it('nhắc gửi tới người tạo và người được mời; workspace TEAM gửi cả thành viên', ...)
it('đối soát: phòng không còn trên LiveKit → buổi họp ENDED reason empty, phiên mở được đóng', ...)
it('đối soát: phòng còn người → giữ LIVE, đóng phiên của người đã rời mà thiếu webhook', ...)
it('enqueueMeetingReminder: jobId theo giờ họp, delay trừ số phút nhắc', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/worker test:e2e -- meetings` → FAIL.
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass** — cùng lệnh → PASS.
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Send meeting reminders and reconcile rooms that ended without a webhook"`

---

### Task 8: Số phút họp cho admin

**Files:**
- Create: `backend/apps/api/src/admin/meeting-usage.service.ts`
- Modify: `backend/apps/api/src/admin/admin.controller.ts`, `admin.schemas.ts`, `admin.module.ts`
- Test: `backend/apps/api/test/admin.e2e-spec.ts` (thêm case)

**Interfaces:**
- Produces: `GET admin/meetings/usage?from=YYYY-MM&to=YYYY-MM` (system admin) → `{ months: Array<{ month: string; meetings: number; roomMinutes: number; participantMinutes: number; byWorkspace: Array<{ workspaceId; name; meetings; participantMinutes }> }> }`. `roomMinutes = Σ ceil((endedAt - startedAt)/60s)`; `participantMinutes = Σ ceil((leftAt - joinedAt)/60s)` của các phiên đã đóng; tháng tính theo `Asia/Ho_Chi_Minh` như `admin-stats.service.ts`. Plan 2 thêm cột chi phí AI vào cùng response (field mới, tuỳ chọn).

- [ ] **Step 1: Viết test** — `it('thống kê phút họp theo tháng và workspace; người không phải admin 403', ...)` với 2 buổi họp, 3 phiên tham dự dựng sẵn (45 và 30 phút).
- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/api test:e2e -- admin` → FAIL.
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass** — cùng lệnh → PASS; `pnpm --filter @luna/api openapi:types`.
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Report meeting counts and minutes to admins"`

---

### Task 9: FE — CSP, lối vào "Cuộc họp" và danh sách buổi họp (qua `evon:ui-ux`)

**Files:**
- Modify: `frontend/security-headers.ts` (`Options` thêm `liveKitOrigin?: string`; `connect-src` thêm `liveKitOrigin` (wss) và bản `https://` cùng host; khi `liveKitOrigin` là `*.livekit.cloud` thêm `wss://*.livekit.cloud https://*.livekit.cloud` cho host vùng; `media-src` thêm `blob:` đã có), `frontend/next.config.ts` (`liveKitOrigin: process.env.LIVEKIT_ORIGIN`), `frontend/Dockerfile` (`ARG LIVEKIT_ORIGIN` + `ENV`), `frontend/scripts/check-security-headers.mjs` (kiểm `connect-src` chứa `LIVEKIT_ORIGIN` khi đặt), `backend/docker/docker-compose.prod.yml` (frontend build arg `LIVEKIT_ORIGIN: ${LIVEKIT_URL:?LIVEKIT_URL must be set in .env.prod}`)
- Modify: `frontend/package.json` (`livekit-client: 2.23.0`, `@livekit/components-react: 2.9.24`, `@livekit/components-styles: 1.2.0`)
- Create: `frontend/src/lib/meetings.ts`, `frontend/src/app/(user)/w/[wsId]/meetings/page.tsx`, `frontend/src/components/meetings/meetings-page.tsx`, `create-meeting-dialog.tsx`
- Modify: `frontend/src/components/shell/tree-column.tsx` (NavLink "Cuộc họp", icon `Video` của lucide, `href={`${base}/meetings`}` đặt trên "Thùng rác"), `frontend/src/components/shell/notification-bell.tsx` (nhãn + link cho `meeting.invited`, `meeting.reminder`, `meeting.cancelled` → `/w/${workspaceId}/meetings/${meetingId}`)

**Interfaces:**
- Consumes: route Task 3; kiểu sinh trong `api-schema.ts`.
- Produces: `frontend/src/lib/meetings.ts` export `meetingHref(wsId, meetingId)`, `listMeetings`, `createMeeting`, `getMeeting`, `joinMeeting`, `endMeeting`, `muteParticipant`, `setAiNotes`, `sendChat`, `listChat`, `linkify(text: string): Array<{ kind: 'text' | 'link'; value: string }>` (chỉ `https?://\S+`, bỏ dấu câu cuối `.,)`).

- [ ] **Step 1: Chạy quy trình `evon:ui-ux`** — brief: "danh sách buổi họp trong workspace (đang diễn ra / sắp tới / đã qua) + hộp tạo (Họp ngay / Đặt lịch, tiêu đề, giờ, mời người bằng `user-suggest`, công tắc 'Ghi biên bản AI' bật sẵn)"; 2–3 wireframe có nội dung thật; người dùng chọn rồi mới dựng.
- [ ] **Step 2: Dựng màn theo wireframe đã chọn.** Nút "Họp ngay" tạo rồi chuyển tới trang buổi họp. VIEWER không thấy nút tạo.
- [ ] **Step 3: Kiểm** — trong `frontend/`: `pnpm lint && pnpm typecheck && pnpm build`; `LIVEKIT_ORIGIN=wss://x.livekit.cloud MEDIA_ORIGIN=... pnpm check:headers` → `security headers ok`; trình duyệt `?as=qa.creator@lunatech.vn` tạo họp ngay và đặt lịch có mời `qa.outsider@lunatech.vn`; `?as=qa.outsider@lunatech.vn` thấy thông báo mời và mở được trang buổi họp; `?as=` người VIEWER không thấy nút tạo.
- [ ] **Step 4: Commit** — `git commit -m "Add the meetings list, create dialog and LiveKit origin to the CSP"`

---

### Task 10: FE — trang buổi họp, màn chờ và phòng họp (qua `evon:ui-ux`)

**Files:**
- Create: `frontend/src/app/(user)/w/[wsId]/meetings/[meetingId]/page.tsx`, `frontend/src/components/meetings/meeting-page.tsx`, `pre-join.tsx`, `meeting-room.tsx`, `room-stage.tsx`, `room-controls.tsx`

**Interfaces:**
- Consumes: `joinMeeting` → `{ serverUrl, token, aiNotesEnabled, isHost }`; `getMeeting`.
- Produces:
  - `MeetingPage` chọn theo trạng thái: SCHEDULED/LIVE → `PreJoin` rồi `MeetingRoom`; ENDED → khối tóm tắt (giờ, người dự) và chỗ trống cho "Biên bản" (plan 2 điền); CANCELLED → thông báo đã huỷ.
  - `PreJoin` props `{ meeting: MeetingDetail; onJoin(choices: { audioEnabled: boolean; videoEnabled: boolean; audioDeviceId?: string; videoDeviceId?: string }): void }` — xem trước camera, chọn mic/camera (dùng `usePreviewTracks`/`MediaDeviceMenu` của `@livekit/components-react`), vào với mic/camera tắt được; khi `aiNotesEnabled` hiện khối cảnh báo cố định: "Cuộc họp này đang được AI ghi biên bản. Âm thanh của bạn sẽ được chép lời để viết biên bản và bị xoá sau khi có biên bản." Nút "Vào phòng" chỉ gọi `joinMeeting` sau khi bấm.
  - `MeetingRoom` dùng `<LiveKitRoom serverUrl token connect options={ROOM_OPTIONS}>` với `ROOM_OPTIONS = { adaptiveStream: true, dynacast: true, videoCaptureDefaults: { resolution: VideoPresets.h720.resolution }, publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360], screenShareEncoding: ScreenSharePresets.h1080fps15.encoding } }`; chia sẻ màn hình bằng `setScreenShareEnabled(true, { contentHint: 'text', audio: false })`.
  - `RoomStage`: lưới (`GridLayout` + `ParticipantTile`), khi có chia sẻ màn hình thì ô lớn + dải người (`FocusLayout`/`CarouselLayout`), viền sáng người đang nói qua `useIsSpeaking`/`data-lk-speaking`; không hiện participant ẩn (recorder).
  - `RoomControls`: mic, camera, chia sẻ, thả icon, giơ tay, rời phòng; host thêm "Kết thúc cho mọi người" (xác nhận) và công tắc "Ghi biên bản AI". Thanh trên: tên buổi họp, đồng hồ từ `startedAt`, dòng "● AI đang ghi biên bản" khi bật (cập nhật từ `RoomEvent.RoomMetadataChanged` và topic `luna.meeting`), số người.
  - Mất kết nối/token hết hạn khi reconnect: gọi lại `joinMeeting` lấy token mới; phòng bị xoá (host kết thúc) → chuyển về khối "Buổi họp đã kết thúc".

- [ ] **Step 1: Chạy quy trình `evon:ui-ux`** — brief dựa trên mockup (thanh trên, lưới + ô chia sẻ lớn, thanh điều khiển, bảng bên Chat/Người); 2–3 wireframe cho màn chờ và phòng; người dùng chọn.
- [ ] **Step 2: Dựng** theo wireframe đã chọn, style của `@livekit/components-styles` chỉ dùng cho phần tile, màu theo token hiện có.
- [ ] **Step 3: Kiểm** — `pnpm lint && pnpm typecheck && pnpm build`; trình duyệt (hai cửa sổ, hai persona, LiveKit Cloud project thử hoặc `livekit-server --dev`): vào phòng với camera tắt; bật camera ở cửa sổ kia; chia sẻ màn hình hiện ô lớn; viền sáng khi nói; host tắt ghi biên bản → dòng thông báo biến mất ở cả hai cửa sổ; host kết thúc → cả hai về khối "đã kết thúc"; DevTools → `chrome://webrtc-internals` thấy camera gửi ≤ 1280×720 và có 3 lớp simulcast; console không có lỗi CSP.
- [ ] **Step 4: Commit** — `git commit -m "Add the pre-join screen and the meeting room with simulcast caps"`

---

### Task 11: FE — chat, danh sách người, thả icon, giơ tay, tắt mic người khác (qua `evon:ui-ux`)

**Files:**
- Create: `frontend/src/components/meetings/room-side-panel.tsx`, `frontend/src/components/meetings/reactions.ts`
- Modify: `meeting-room.tsx`, `room-controls.tsx`, `room-stage.tsx`

**Interfaces:**
- Produces:
  - `RoomSidePanel` tab "Chat" và "Người (n)". Chat: tải `listChat` khi mở, nhận tin mới qua `useDataChannel('luna.chat')` (bỏ trùng theo `id`), gửi qua `sendChat`; hiển thị bằng `linkify` (text node, không `dangerouslySetInnerHTML`). Người: danh sách participant không ẩn, trạng thái mic, ✋ khi giơ tay; host có nút "Tắt mic" mỗi người (gọi `muteParticipant`).
  - `reactions.ts`: `REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '😮'] as const`; gửi `localParticipant.publishData(encode({ emoji }), { reliable: false, topic: 'luna.reaction' })`, hiện 3 giây trên ô người thả; giới hạn 1 icon / 500 ms mỗi người ở phía gửi.
  - Giơ tay: `localParticipant.setAttributes({ handRaised: 'true' | '' })` (cần grant `canUpdateOwnMetadata` đã cấp ở Task 1), đọc qua `participant.attributes.handRaised`.

- [ ] **Step 1: Chạy quy trình `evon:ui-ux`** cho bảng bên và menu thả icon (có thể gộp vào vòng wireframe Task 10 nếu người dùng đã chọn).
- [ ] **Step 2: Dựng.**
- [ ] **Step 3: Kiểm** — `pnpm lint && pnpm typecheck && pnpm build`; trình duyệt hai persona: gửi tin có link `https://example.com/a).` → link dừng trước `).`, tin `<b>x</b>` hiện nguyên chữ; tải lại trang vẫn thấy tin cũ; thả icon hiện trên ô người thả ở cả hai cửa sổ; giơ tay hiện ✋ trong danh sách; host tắt mic người kia → biểu tượng mic tắt; người không phải host không thấy nút "Tắt mic".
- [ ] **Step 4: Commit** — `git commit -m "Add meeting chat, participants, reactions and raised hands"`

---

### Task 12: Triển khai và đo thử

**Files:**
- Modify: `backend/docker/docker-compose.prod.yml` (không thêm service; api và worker đã đọc `.env.prod`), `docs/DEPLOY.md` (mục mới "Phòng họp": tạo project LiveKit Cloud, đặt 3 biến, URL webhook `https://${APP_HOST}/api/v1/meetings/livekit/webhook` trong Project Settings → Webhooks, gói Build chỉ cho dev vì không có giá vượt mức — production cần Ship $50/tháng nếu > 5.000 participant-phút/tháng)
- Modify: `backend/apps/api/src/health/infra.health.ts` không đổi (LiveKit không phải phụ thuộc của health để tránh API "down" khi cloud lỗi)

- [ ] **Step 1:** Cập nhật `docs/DEPLOY.md`, `.env.prod.example`.
- [ ] **Step 2:** Đo thử với nhóm thật 8–10 người (spec §6) trên LiveKit Cloud project thử: ghi lại băng thông lên/xuống của máy văn phòng (`chrome://webrtc-internals`), CPU trình duyệt, chất lượng chữ khi chia sẻ màn hình; ghi kết quả vào cuối `docs/DEPLOY.md` mục "Phòng họp".
- [ ] **Step 3:** Lệnh tổng backend + FE xanh, commit — `git commit -m "Document LiveKit setup and the first meeting load test"`

---

## Self-review (đã chạy)

- Spec coverage: §4.1 (Task 3, 4, 7, 9, 10), §4.2 (Task 4, 6, 10, 11), §4.3 câu "kết thúc khi chủ trì bấm hoặc người cuối rời + chờ ngắn" (Task 4, 5, 7 qua `departureTimeout`/`emptyTimeout` = `MEETING_EMPTY_GRACE_SEC` và đối soát), §5 token ngắn hạn/audit/khoá trong env/CSP/đi ra (Global Constraints, Task 1, 2, 9, 12), số phút (Task 8), §6 băng thông và AI bật mặc định (Task 10). Phần âm thanh, biên bản, mention trong tài liệu thuộc plan 2.
- Kiểu nhất quán: `MeetingMedia`, `MEETING_MEDIA`, `MEETING_ENDED_HOOK`, `endMeeting(deps, meetingId, reason, actorId)`, `roomNameFor`, `RoomMetadata` dùng cùng tên ở mọi task và ở plan 2.
