# Biên bản họp do AI ghi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sau mỗi buổi họp có bật ghi biên bản, hệ thống thu âm riêng từng người, chép lời tiếng Việt có mốc thời gian, ghép với chat, nhờ LLM viết biên bản có cấu trúc (tổng quan, phân việc theo người, chi tiết theo chủ đề, bản ghi lời nói), cho người chủ trì duyệt và sửa ở dạng nháp, rồi khi bấm "Gửi biên bản" thì tạo tài liệu Luna (có @mention trong nội dung) trong thư mục "Biên bản họp", chia sẻ chỉ xem cho người được mời ngoài workspace và gửi thông báo.

**Architecture:** Một app mới `apps/recorder` (bot phía server) dùng `@livekit/rtc-node` nối **ra** LiveKit Cloud như một participant ẩn, đăng ký track mic của từng người, cắt theo đoạn có tiếng (VAD theo năng lượng), mã hoá Opus bằng ffmpeg và đưa từng đoạn vào MinIO qua `ObjectStore`. Khi buổi họp kết thúc, worker chạy job `meeting-minutes:process`: chép lời từng đoạn qua seam `SpeechToText` → dòng thời gian (lời nói + chat) → LLM qua seam `MinutesWriter` trả JSON kiểm bằng zod → khớp người → dựng Tiptap JSON → lưu bản nháp trong bảng `meeting_minutes` → xoá âm thanh. Bản nháp **không** là node trong cây: API chỉ tạo tài liệu qua `NodeTree` lúc chủ trì gửi, nên không phải đổi luật quyền hiện có. Prompt, schema, khớp tên, dựng tài liệu nằm trong `@luna/meetings` (hàm thuần, test không cần mạng).

**Tech Stack:** NestJS 12 ESM, Prisma 7, BullMQ 6, `@livekit/rtc-node@1.2.1`, ffmpeg (libopus), `@anthropic-ai/sdk` (Messages API, `messages.parse` + `zodOutputFormat`), Deepgram REST `/v1/listen` (Nova-3, `language=vi`), Gemini API (adapter so sánh), zod 4, Tiptap 3.31.4, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-11-01-meetings-ai-notes-design.md` (mục 2, 3, 4.3, 5, 6, 7). Plan nền: `docs/superpowers/plans/2026-11-01-meetings-rooms.md` (phải xong trước; plan này dùng `MeetingMedia`, `MEETING_ENDED_HOOK`, `endMeeting`, `MeetingAccess`, `MeetingChatService.timeline`).

## Nguồn đã kiểm (2026-11-01) và lựa chọn cách thu âm

- `@livekit/rtc-node@1.2.1` (unpkg `dist/room.d.ts`, `audio_stream.d.ts`, `audio_frame.d.ts`): `room.connect(url, token, opts)` là kết nối đi ra; `new AudioStream(track, { sampleRate, numChannels })` là `ReadableStream<AudioFrame>`, `AudioFrame.data: Int16Array`.
- Egress của LiveKit Cloud (`startTrackEgress`, `RoomEgress.tracks`) ghi file Ogg/Opus từng track nhưng **đẩy từ máy chủ LiveKit vào** S3 hoặc WebSocket của mình (docs.livekit.io/home/egress/track). MinIO ở văn phòng không nhận kết nối vào từ Internet, và spec §3, §5 cấm mở cổng vào mới.
- **Chọn bot phía server (`apps/recorder`)**: chỉ kết nối đi ra; biết chắc track thuộc user nào (identity = userId); cắt bỏ khoảng im lặng ngay khi thu nên số phút gửi đi chép lời gần bằng thời lượng họp thay vì thời lượng × số người; không tốn phí egress. Đổi lại: thêm một container và một module native. Hạn chế rủi ro: giới hạn tài nguyên container, mỗi đoạn tối đa 5 phút nên bot chết chỉ mất đoạn đang thu, BullMQ tự chạy lại job khi bot bị treo.
- Chép lời: Deepgram Nova-3 hỗ trợ `vi` (developers.deepgram.com/docs/models-languages-overview), giá trả theo dùng $0,0043/phút một ngôn ngữ, $0,0052/phút đa ngôn ngữ (deepgram.com/pricing). Gemini 2.5 Flash tính âm thanh 32 token/giây, $1,00/MTok vào (~$0,0019/phút), timestamp chỉ có qua prompt (ai.google.dev/gemini-api/docs/pricing, /audio). Google STT v2 `chirp_3` có vi-VN, $0,016/phút. AssemblyAI có tiếng Việt trên Universal-2 ($0,15/giờ), xếp nhóm WER 10–25%. OpenAI `whisper-1`/`gpt-4o-*-transcribe` ngừng ngày 2027-02-26 nên loại.
- LLM: bảng giá platform.claude.com/docs/en/about-claude/pricing — Claude Opus 5.5 `claude-opus-5-5` $4/$20 mỗi MTok, Claude Sonnet 5.5 `claude-sonnet-5-5` $2/$10, Claude Haiku 5.5 `claude-haiku-5-5` $0,10/$0,50. Cách gọi theo skill `claude-api` (TypeScript): `client.messages.parse({ model, max_tokens: 16000, output_config: { effort, format: zodOutputFormat(schema) }, ... })`, đọc `parsed_output`, kiểm `stop_reason === 'refusal'`; với Opus 5.5 bật fallback phía server (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`) qua `client.beta.messages.parse`. Người làm phải đối chiếu đúng tên binding với `.d.ts` của bản `@anthropic-ai/sdk` cài vào trước khi viết (luật của skill: không đoán).

## Đề xuất nhà cung cấp và chi phí ước tính

Giả định: 60 buổi họp/tháng (3 buổi mỗi ngày làm việc), trung bình 45 phút, 8 người; tổng thời lượng có tiếng sau VAD ≈ 1,2 × thời lượng họp (có lúc nói chồng); bản ghi ~9.000 từ/buổi ≈ 30.000 token vào, biên bản ~6.000 token ra.

| Hạng mục | Lựa chọn | Lượng/tháng | Đơn giá | Ước tính/tháng |
|---|---|---|---|---|
| SFU | LiveKit Cloud gói Ship | 60 × 45 × 9 (8 người + bot) ≈ 24.300 participant-phút (trong 150.000 có sẵn) | $50 cố định | $50 |
| Chép lời | Deepgram Nova-3 `vi` (đơn ngữ; đa ngữ nếu đánh giá cho thấy tốt hơn với thuật ngữ tiếng Anh) | 60 × 54 = 3.240 phút | $0,0043 (đa ngữ $0,0052) | ~$14 (đa ngữ ~$17) |
| Viết biên bản | Claude Opus 5.5 `claude-opus-5-5`, effort `medium` | 60 × (30k vào + 6k ra) | $4 / $20 mỗi MTok | ~$14,4 |
| **Tổng** | | | | **~$80/tháng** (~$0,50 phần AI mỗi buổi) |

Phương án rẻ hơn để so trong Task 4: Gemini 2.5 Flash cho chép lời (~$6/tháng) và Claude Sonnet 5.5 cho biên bản (~$7/tháng). Gói LiveKit Build (miễn phí, 5.000 participant-phút, không có giá vượt mức) chỉ đủ khoảng 14 buổi như trên nên chỉ dùng cho dev/test. Vendor chỉ chốt sau Task 4.

## Điều chỉnh của chủ dự án (2026-11-03, đè lên các mục bên dưới khi mâu thuẫn)

- **Bỏ camera** (plan 1 đã làm): phòng chỉ có mic, chia sẻ màn hình, chat. Recorder vẫn chỉ đăng ký `SOURCE_MICROPHONE`.
- **LiveKit tự cài** thay cho LiveKit Cloud (xem `docs/DEPLOY.md` mục "Tự cài LiveKit"); bỏ dòng LiveKit Cloud $50 khỏi chi phí. Recorder nối tới `LIVEKIT_URL` như mọi client.
- **AI khi dev: Gemini qua OmniRoute** (`OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY`, `OMNIROUTE_MODEL` trong `backend/.env`, API kiểu OpenAI `POST /chat/completions`). Thêm adapter `OmniRouteSpeechToText` (gửi audio dạng `input_audio`, yêu cầu JSON `{segments:[{startSec,endSec,text}]}`) và `OmniRouteMinutesWriter` (JSON theo `minutesDraftSchema`, kiểm bằng zod, `temperature` thấp). Provider env: `MEETING_STT_PROVIDER` và `MEETING_LLM_PROVIDER` thêm giá trị `omniroute`. Deepgram và Claude giữ nguyên là adapter cho production; chủ dự án cấp tài khoản sau. Khoá OmniRoute là khoá dùng chung trong `backend/.env`, không in ra log.
- **Không có ghi âm thật**: Task 4 bước 5 đổi thành **buổi họp tổng hợp**: kịch bản tiếng Việt nhiều người → giọng tổng hợp (TTS) → các "người họp giả" vào phòng LiveKit dev, phát giọng qua mic giả → recorder → pipeline đầy đủ. Kết quả dùng để kiểm luồng và định dạng, không dùng để chốt chất lượng chép lời; chốt vendor production làm lại khi có ghi âm thật.
- **Khuôn biên bản đã duyệt** (tài liệu mẫu `01a19f78-4349-7748-863a-5695b0a43458` "[Mẫu AI] Biên bản họp sprint 13"): dòng mô tả (ngày, giờ, chủ trì, "thư ký AI, bản nháp chờ duyệt"), "Người dự" + "Vắng", dòng "Nguồn"; `1. Tổng quan` gồm đoạn tóm tắt + "Đã chốt" + "Hoãn sang sprint sau" + "Còn bỏ ngỏ"; `2. Phân việc` bảng 5 cột `# | Việc | Người phụ trách | Hạn | Căn cứ` (Căn cứ = mốc `[HH:mm] Tên` của câu gốc; người vắng ghi "(vắng, cần chủ trì xác nhận)"; nhiều người cùng nhận thì "Chưa rõ người phụ trách"), kèm đoạn "Ghi chú cho chủ trì khi duyệt"; `3. Chi tiết theo chủ đề` dạng heading(3) + đoạn; `4. Tin nhắn chat đáng chú ý`; `5. Bản ghi lời nói`. Vì vậy `minutesDraftSchema` thêm `overview.deferred: string[]`, `overview.openQuestions: string[]`, `notableChat: string[]` (refId của chat), và `actionItems[].ambiguous: boolean`; `renderMinutesDoc` dựng đúng khuôn này.
- **An toàn ghi âm**: recorder chỉ thu khi **cả** `meetings.ai_notes_enabled` trong DB **và** metadata phòng đều bật (đọc DB mỗi 10 giây và khi metadata đổi).
- **Hook kết thúc**: `MEETING_ENDED_HOOK` chỉ enqueue; worker thêm quét định kỳ các buổi `ENDED` có `meeting_minutes` mà chưa có job để không mất khi hook lỗi.
- Branch: `feature/meetings-ai-minutes`. Persona test: `qa.*` đã bị xoá, dev login `?as=` tạo lại khi cần.

## Global Constraints

- Không viết comment trong code (TS, TSX, SQL, script, compose, Dockerfile mới). Prompt nằm trong code dưới dạng hằng chuỗi có tên mô tả (`MINUTES_SYSTEM_PROMPT`, `MINUTES_OUTPUT_RULES`), không phải comment.
- Hành vi và response API hiện có giữ nguyên. Thêm node `mention` vào schema editor không được làm đổi kết quả `jsonToText`/`jsonToHTML`/`jsonToMarkdown` của tài liệu không có mention.
- Migration theo luật đợt 2: thư mục `backend/packages/db/prisma/migrations/20261101130000_meeting_minutes/`, SQL thuần, `CREATE INDEX` thường, không `--`, CHECK đặt tên, không `GRANT` tay.
- Chỉ gửi ra ngoài **âm thanh và chữ** (spec §3): bot chỉ đăng ký track `TrackSource.SOURCE_MICROPHONE`, không bao giờ đăng ký video hay `screen_share_audio`.
- Khoá dịch vụ chỉ ở env của `worker` (STT, LLM) và `recorder`/`api` (LiveKit): `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, không bao giờ tới trình duyệt, không ghi vào log, lỗi nhà cung cấp lưu vào DB đã cắt còn ≤ 500 ký tự và bỏ header.
- Bản nháp chỉ người tạo buổi họp và quản trị workspace (`ADMIN`) xem/sửa/gửi (spec §3). Mọi người khác chỉ thấy trạng thái.
- Tạo tài liệu biên bản chỉ qua `NodeTree` (qua `DocumentsService.createWithContent`), không gọi mạng khi giữ khoá cây.
- Âm thanh: xoá ngay khi chép lời xong toàn bộ; nếu chép lời lỗi thì giữ tới `endedAt + MEETING_AUDIO_RETENTION_DAYS` (mặc định 7) rồi xoá theo lịch.
- Người được giao việc mà không xem được tài liệu thì không nhận thông báo (spec §6). Người vắng mặt chỉ được gắn @mention khi chủ trì xác nhận.
- Worker giữ giới hạn tài nguyên như hiện có (compose `cpus: '4'`, `mem_limit: 6g`); job biên bản chạy concurrency `MEETING_MINUTES_CONCURRENCY` mặc định 1. Recorder là container riêng `cpus: '1'`, `mem_limit: 1g`.
- Test không gọi dịch vụ thật: `FakeSpeechToText`, `FakeMinutesWriter`, `FakeMeetingMedia`. Recorder test bằng hàm thuần (`SpeechChunker`) và một `FakeRoom` phát `AudioFrame`.
- UI qua quy trình skill `evon:ui-ux`, chữ tiếng Việt.
- Mỗi task backend xong khi xanh (trong `backend/`): `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm test:e2e`; đổi schema API thì `pnpm --filter @luna/api openapi:types` và commit `frontend/src/lib/api-schema.ts`. Task chạm FE: `pnpm lint && pnpm typecheck && pnpm build` trong `frontend/`, kiểm qua `http://localhost:5173/?as=<email>`.
- Tên test tiếng Việt, identifier tiếng Anh, commit message một câu tiếng Anh, branch `feature/meetings-ai-notes`.

## Review Focus

- LLM trả việc không có trong lời nói, hoặc gán người theo tên không khớp ai: mọi `actionItem` phải trích ít nhất một `utteranceId` có thật; việc không có trích dẫn hợp lệ bị bỏ và đếm vào `droppedItemCount` để chủ trì thấy; `ownerSpeakerId` không thuộc người dự thì coi như tên để khớp. Test: "việc không có trích dẫn hợp lệ bị bỏ, không gắn mention" (Task 3).
- Hai người vắng cùng tên gọi (hai "Hùng") hoặc tên không dấu: không gắn ai, để chữ thường. Test: "tên trùng nhau giữa hai thành viên → không khớp" (Task 3).
- Bot chết giữa buổi họp hoặc mất mạng: job `record` chạy lại, nối vào phòng, đoạn mới có `startOffsetMs` đúng theo `startedAt`; không ghi trùng khoá (`unique(meetingId, userId, startOffsetMs)`). Test ở Task 5.
- Chủ trì và quản trị cùng sửa nháp, hoặc bấm "Gửi" hai lần: `revision` lệch → 409; gửi lần hai → 409, chỉ một tài liệu. Test ở Task 7.
- Buổi họp không có ai nói (mọi người tắt mic) hoặc ghi biên bản bị tắt giữa chừng: không gọi LLM khi không có lời nói; biên bản nháp chỉ có chat và câu "Không có lời nói được ghi lại"; đoạn trong lúc tắt ghi không có âm thanh. Test ở Task 5 và Task 6.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/packages/editor/src/extensions.ts` | Thêm `LunaMention` |
| `frontend/src/components/documents/extensions.ts` | Thêm `LunaMention` (render, không gợi ý khi gõ) |
| `backend/packages/db/prisma/schema.prisma` + migration `20261101130000_meeting_minutes` | `meeting_minutes`, `meeting_audio_chunks`, `meeting_utterances`, `meeting_ai_usage` |
| `backend/packages/meetings/src/minutes/schema.ts` | `minutesDraftSchema`, `MinutesDraft` |
| `backend/packages/meetings/src/minutes/timeline.ts` | `buildTimeline`, `formatTimelineForPrompt` |
| `backend/packages/meetings/src/minutes/prompt.ts` | `MINUTES_SYSTEM_PROMPT`, `MINUTES_OUTPUT_RULES`, `buildMinutesUserMessage` |
| `backend/packages/meetings/src/minutes/validate.ts` | `validateDraft` |
| `backend/packages/meetings/src/minutes/name-match.ts` | `foldName`, `matchPerson` |
| `backend/packages/meetings/src/minutes/render.ts` | `renderMinutesDoc`, `applyMentionConfirmations`, `collectMentionIds` |
| `backend/packages/meetings/src/ai/speech-to-text.ts`, `deepgram-stt.ts`, `gemini-stt.ts` | Seam STT + 2 adapter |
| `backend/packages/meetings/src/ai/minutes-writer.ts`, `claude-minutes-writer.ts` | Seam LLM + adapter Claude |
| `backend/packages/meetings/src/ai/cost.ts` | `sttCostMicroUsd`, `llmCostMicroUsd` |
| `backend/packages/meetings/src/testing/fake-ai.ts` | `FakeSpeechToText`, `FakeMinutesWriter` |
| `backend/apps/recorder/` (mới) | Bot thu âm: `chunker.ts`, `track-recorder.ts`, `recording-session.ts`, `recorder.processor.ts`, `recorder.module.ts`, `main.ts`, `config.ts` |
| `backend/apps/worker/src/processors/meeting-minutes.processor.ts` | Pipeline biên bản, xoá âm thanh |
| `backend/apps/api/src/meetings/minutes/minutes.service.ts`, `minutes.controller.ts`, `minutes.schemas.ts`, `minutes-queue.service.ts` | Xem/sửa/gửi/thử lại, nối hook |
| `backend/apps/api/src/documents/documents.service.ts` | Thêm `createWithContent` |
| `backend/scripts/meetings-eval.ts` | Đánh giá vendor trên audio mẫu |
| `frontend/src/components/meetings/minutes-panel.tsx`, `minutes-draft-editor.tsx` | Duyệt, sửa, gửi biên bản |

Theo từ vựng codebase-design:

- `SpeechToText` và `MinutesWriter` là seam thật: mỗi seam có adapter giả cho test và ít nhất một adapter thật (STT có hai: Deepgram, Gemini). Interface chỉ một method; adapter giấu HTTP, định dạng phản hồi, giới hạn kích thước, bảng giá.
- Lõi biên bản (`buildTimeline` → `validateDraft` → `matchPerson` → `renderMinutesDoc`) là các hàm thuần trong `@luna/meetings`; worker chỉ điều phối I/O. Test đi qua đúng interface mà worker dùng.
- `SpeechChunker` là module sâu nhỏ: một method `push(samples, atMs)` giấu VAD, đóng đoạn theo im lặng, giới hạn độ dài, bỏ đoạn quá ngắn. Recorder chỉ nối nó với `AudioStream` và ffmpeg.
- Bản nháp nằm trong `meeting_minutes.draft_doc` chứ không phải node ẩn: deletion test cho phương án "node nháp ẩn" cho thấy độ phức tạp sẽ lan ra `accessColumns`, `visibleTo`, tìm kiếm, cây, collab. Giữ nháp ngoài cây thì luật quyền hiện có không đổi.

---

### Task 1: Node `mention` trong nội dung tài liệu

**Files:**
- Modify: `backend/packages/editor/src/extensions.ts` (thêm `LunaMention` vào `editorExtensions`)
- Modify: `frontend/src/components/documents/extensions.ts` (thêm cùng node vào `buildExtensions`), `frontend/src/app/globals.css` (class `luna-mention`, `luna-mention-suggested`)
- Test: `backend/packages/editor/src/convert.spec.ts`

**Interfaces:**
- Produces: `LunaMention = Node.create({ name: 'mention', group: 'inline', inline: true, atom: true, selectable: true, addAttributes: { id: { default: null }, label: { default: '' }, suggested: { default: false } }, parseHTML: [{ tag: 'span[data-type="mention"]' }], renderHTML: ['span', { 'data-type': 'mention', 'data-id': id, class: suggested ? 'luna-mention luna-mention-suggested' : 'luna-mention' }, `@${label}`], renderText: ({ node }) => `@${node.attrs.label}` })`. Cùng định nghĩa ở FE (không có Suggestion plugin; gõ @ trong tài liệu chưa nằm trong phạm vi).

- [ ] **Step 1: Viết test**

```ts
it('mention trong đoạn văn: jsonToText ra @Tên, jsonToHTML ra span data-type="mention", Yjs khứ hồi giữ id và suggested', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Giao ' }, { type: 'mention', attrs: { id: U1, label: 'Lan', suggested: false } }] }] };
  expect(jsonToText(doc)).toBe('Giao @Lan');
  expect(jsonToHTML(doc)).toContain('data-type="mention"');
  expect(stateToJSON(jsonToState(doc))).toEqual(doc);
});
it('tài liệu không có mention cho kết quả chuyển đổi y như trước', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/editor test` → FAIL "Unknown node type: mention".
- [ ] **Step 3: Cài đặt** cả backend và FE.
- [ ] **Step 4: Chạy, thấy pass**; `pnpm --filter @luna/collab test:e2e` vẫn PASS.
- [ ] **Step 5: Lệnh tổng backend + FE xanh; mở một tài liệu cũ qua `?as=qa.creator@lunatech.vn` vẫn sửa được; commit** — `git commit -m "Support mention nodes inside document content"`

---

### Task 2: Bảng biên bản, đoạn âm thanh, lời nói, chi phí AI

**Files:**
- Modify: `backend/packages/db/prisma/schema.prisma`; Create: migration `20261101130000_meeting_minutes/migration.sql`
- Modify: `backend/packages/db/src/audit.ts` (thêm `meeting.minutes_draft`, `meeting.minutes_publish`, `meeting.minutes_retry`)
- Modify: `backend/packages/shared/src/constants.ts` (`BUCKET_KEYS` thêm `'meetingAudio'`; `QUEUES.MEETING_RECORDER = 'meeting-recorder'`, `QUEUES.MEETING_MINUTES = 'meeting-minutes'`), `backend/packages/shared/src/s3.ts` (`bucketNames` map `meetingAudio`), `backend/packages/shared/src/env.ts` (`S3_BUCKET_MEETING_AUDIO: z.string().min(3).default('luna-meeting-audio')`), `backend/packages/shared/src/jobs.ts`
- Modify: `backend/scripts/infra-init.ts` nếu danh sách bucket không lấy từ `BUCKET_KEYS`; `backend/apps/api/test/create-test-app.ts` (`resetDatabase`)
- Test: `backend/apps/api/test/db-integrity.e2e-spec.ts`, `backend/packages/shared/src/jobs.spec.ts`

**Interfaces:**
- Produces (Prisma):
  - `enum MinutesStatus { RECORDING PROCESSING AWAITING_REVIEW PUBLISHING PUBLISHED FAILED }`
  - `model MeetingMinutes { meetingId @id; status MinutesStatus @default(RECORDING); audioCompletedAt?; transcriptCompletedAt?; draft Json?; draftDoc Json?; draftRevision Int @default(0); suggestions Json?; droppedItemCount Int @default(0); failedStage String?; error String?; documentNodeId String? (FK nodes ON DELETE SET NULL); publishedAt?; publishedById? (FK users SET NULL); audioPurgeAfter DateTime?; audioPurgedAt?; createdAt; updatedAt }` → `meeting_minutes`; `@@index([status])`, `@@index([audioPurgeAfter], where: raw("audio_purged_at IS NULL"))`
  - `model MeetingAudioChunk { id uuid7; meetingId (FK CASCADE); userId (FK users CASCADE); startOffsetMs Int; durationMs Int; container String; key String; sizeBytes BigInt; transcribedAt?; deletedAt?; createdAt; @@unique([meetingId, userId, startOffsetMs]); @@index([meetingId]) }` → `meeting_audio_chunks`
  - `model MeetingUtterance { id uuid7; meetingId (FK CASCADE); chunkId (FK meeting_audio_chunks CASCADE); userId (FK users CASCADE); startMs Int; endMs Int; text String; @@index([meetingId, startMs]) }` → `meeting_utterances`. Lời nói giữ lại sau khi xoá âm thanh (xoá âm thanh chỉ đặt `deletedAt` cho chunk, không xoá dòng).
  - `model MeetingAiUsage { id BigInt autoincrement; meetingId String? (FK SET NULL); workspaceId String? (FK SET NULL); kind String; provider String; model String; audioMs Int @default(0); inputTokens Int @default(0); outputTokens Int @default(0); costMicroUsd BigInt; createdAt; @@index([createdAt], type: Brin); @@index([meetingId]) }` → `meeting_ai_usage`
  - CHECK: `meeting_audio_chunks_offsets CHECK (start_offset_ms >= 0 AND duration_ms > 0 AND size_bytes >= 0)`, `meeting_utterances_range CHECK (start_ms >= 0 AND end_ms >= start_ms AND char_length(text) > 0)`, `meeting_ai_usage_kind CHECK (kind IN ('stt','llm'))`, `meeting_ai_usage_nonneg CHECK (audio_ms >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND cost_micro_usd >= 0)`, `meeting_minutes_revision CHECK (draft_revision >= 0)`, `meeting_minutes_published_has_doc CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)`.
- Produces (TS, `jobs.ts`):
  - `JobPayloads['meeting-recorder'] = { record: { meetingId: string } }`, `JobPayloads['meeting-minutes'] = { process: { meetingId: string }; 'purge-audio': Empty }`
  - `RECORDER_JOB_OPTS = { attempts: 5, backoff: { type: 'fixed', delay: 5000 }, removeOnComplete: true, removeOnFail: 50 }`
  - `enqueueRecording(queue, meetingId): Promise<void>` với `jobId: record-${meetingId}`
  - `enqueueMinutes(queue, meetingId, opts: { delayMs?: number; attempt?: number }): Promise<void>` với `jobId = attempt ? minutes-${meetingId}-retry-${attempt} : minutes-${meetingId}`, `attempts: 4`, `backoff: { type: 'exponential', delay: 60_000 }`, `removeOnComplete: 100`, `removeOnFail: 200`
  - `promoteMinutes(queue: Queue, meetingId): Promise<void>` — `getJob('minutes-'+id)`, nếu `isDelayed()` thì `promote()`, không có job thì `enqueueMinutes` không delay.

- [ ] **Step 1: Viết test** — `it('meeting_audio_chunks: không trùng (meeting, user, offset); CHECK chặn duration 0')`, `it('meeting_ai_usage: kind chỉ stt hoặc llm; xoá buổi họp giữ dòng chi phí với meeting_id NULL')`, `it('enqueueMinutes: jobId lần đầu và lần thử lại khác nhau; promoteMinutes đẩy job đang chờ chạy ngay')`.
- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/api test:e2e -- db-integrity` và `pnpm --filter @luna/shared test` → FAIL.
- [ ] **Step 3: Sửa schema, sinh migration** (`pnpm db:migrate --create-only --name meeting_minutes`, đổi tên thư mục, xoá `--`, thêm CHECK); thêm bucket, queue, job; `pnpm infra:init` tạo bucket `luna-meeting-audio` ở dev.
- [ ] **Step 4: Chạy, thấy pass**; `migration-upgrade` vẫn PASS.
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Add tables, bucket and queues for AI meeting minutes"`

---

### Task 3: Lõi biên bản — schema, dòng thời gian, prompt, kiểm, khớp tên, dựng tài liệu

**Files:**
- Create: `backend/packages/meetings/src/minutes/schema.ts`, `timeline.ts`, `prompt.ts`, `validate.ts`, `name-match.ts`, `render.ts`; Modify: `src/index.ts`; `package.json` thêm `@luna/editor: workspace:*`
- Test: `backend/packages/meetings/src/minutes/*.spec.ts`

**Interfaces:**
- Produces:
  - `minutesDraftSchema = z.object({ overview: z.object({ summary: z.string(), decisions: z.array(z.string()) }), actionItems: z.array(z.object({ task: z.string(), ownerSpeakerId: z.string().nullable(), ownerName: z.string().nullable(), dueText: z.string().nullable(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), evidence: z.array(z.string()) })), topics: z.array(z.object({ title: z.string(), points: z.array(z.string()) })) })`; `type MinutesDraft = z.infer<typeof minutesDraftSchema>`. Không dùng `.min()`/`.max()` trong schema gửi cho LLM (structured output); giới hạn kiểm ở `validateDraft`.
  - `interface Speaker { speakerId: string; userId: string; name: string }` (speakerId dạng `S1`, `S2` theo thứ tự nói đầu tiên)
  - `interface TimelineEntry { refId: string; kind: 'speech' | 'chat'; speakerId: string; userId: string; startMs: number; endMs: number; text: string }` (`refId` dạng `U1…` cho lời nói, `C1…` cho chat)
  - `buildTimeline(input: { utterances: Array<{ userId; startMs; endMs; text }>; chat: Array<{ userId; body; createdAt: Date }>; meetingStartedAt: Date; names: Map<string, string> }): { speakers: Speaker[]; entries: TimelineEntry[] }` — sắp theo `startMs`, gộp lời nói liên tiếp cùng người cách nhau < 2000 ms, chat có `startMs = createdAt - meetingStartedAt` (âm thì 0).
  - `formatTimelineForPrompt(t): string` — mỗi dòng `[U12 00:03:15] S2 Lan: …` hoặc `[C3 00:04:01] S1 Tuấn (chat): …`.
  - `MINUTES_SYSTEM_PROMPT`, `MINUTES_OUTPUT_RULES` (tiếng Việt): vai thư ký họp; chỉ ghi việc có người nói rõ; mỗi việc phải có `evidence` là các `refId` chứa câu giao việc; `ownerSpeakerId` chỉ khi người phụ trách là người dự (S…); người vắng thì `ownerSpeakerId: null` và `ownerName` đúng như được gọi; `dueDate` chỉ khi suy ra chắc chắn từ ngày họp (đưa vào message), còn lại giữ `dueText`; thuật ngữ tiếng Anh giữ nguyên; không suy diễn.
  - `buildMinutesUserMessage(input: { title: string; meetingDate: string; speakers: Speaker[]; timeline: string }): string`
  - `validateDraft(draft: MinutesDraft, refs: Set<string>, speakers: Speaker[]): { draft: MinutesDraft; droppedItemCount: number }` — bỏ việc không có `evidence` hợp lệ hoặc `task` rỗng; `ownerSpeakerId` lạ → chuyển thành `ownerName` = tên trong danh sách nếu có, không thì null; cắt `summary` 4000 ký tự, mỗi danh sách ≤ 100 phần tử.
  - `foldName(s: string): string` (bỏ dấu, `đ`→`d`, chữ thường, gộp khoảng trắng, bỏ "anh/chị/em/bạn/a/c/e" ở đầu)
  - `matchPerson(name: string, candidates: Array<{ id: string; name: string; email: string }>): string | null` — khớp nguyên tên đã fold; không có thì khớp **duy nhất** theo từ cuối (tên gọi) hoặc phần trước `@` của email; hơn một ứng viên → null.
  - `interface MentionSuggestion { actionIndex: number; name: string; userId: string; userName: string }`
  - `renderMinutesDoc(input: { title: string; startedAt: Date; endedAt: Date; attendeeCount: number; draft: MinutesDraft; speakers: Speaker[]; entries: TimelineEntry[]; suggestions: MentionSuggestion[]; timeZone: 'Asia/Ho_Chi_Minh' }): DocJSON` — cấu trúc: đoạn mô tả `dd/MM · HH:mm–HH:mm · n người · tạo bởi AI, sửa được`; `heading(2) Tổng quan` + đoạn + bullet "Đã chốt"; `heading(2) Phân việc` + bảng 3 cột `Việc | Người phụ trách | Hạn` (người dự → mention `suggested:false`; gợi ý người vắng → mention `suggested:true`; không khớp → chữ thường; không có → "—"); `heading(2) Chi tiết theo chủ đề` + ordered list; `heading(2) Bản ghi lời nói` + mỗi entry một đoạn `[HH:mm] Tên: lời` (chat thêm "(chat)"). Khi không có lời nói, phần tổng quan là "Không có lời nói được ghi lại." Kết quả phải qua `PMNode.fromJSON(editorSchema, doc).check()`.
  - `applyMentionConfirmations(doc: DocJSON, confirmedUserIds: Set<string>): DocJSON` — mention `suggested:true` có id được xác nhận → `suggested:false`; không được xác nhận → thay bằng text `label`.
  - `collectMentionIds(doc: DocJSON): string[]` — id của mention `suggested:false`, không trùng.

- [ ] **Step 1: Viết test**

```ts
it('dòng thời gian gộp lời nói liền nhau cùng người và chen chat đúng thời điểm', ...)
it('việc không có trích dẫn hợp lệ bị bỏ, không gắn mention', () => {
  const r = validateDraft(draftWith([{ task: 'Viết test', ownerSpeakerId: 'S2', evidence: ['U999'] }]), refs, speakers);
  expect(r.draft.actionItems).toHaveLength(0);
  expect(r.droppedItemCount).toBe(1);
});
it('ownerSpeakerId không thuộc người dự → chuyển thành tên để khớp', ...)
it('khớp tên: "anh Hùng" khớp Nguyễn Văn Hùng duy nhất; "hung" không dấu vẫn khớp', ...)
it('tên trùng nhau giữa hai thành viên → không khớp', ...)
it('dựng tài liệu: đủ 4 mục, bảng phân việc có mention người dự, gợi ý người vắng là mention suggested, giờ theo Asia/Ho_Chi_Minh, qua được editorSchema', ...)
it('xác nhận gợi ý: mention được xác nhận giữ lại, không xác nhận thành chữ thường; collectMentionIds chỉ lấy mention đã xác nhận', ...)
it('không có lời nói: tài liệu có chat và câu "Không có lời nói được ghi lại."', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/meetings test` → FAIL.
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass.**
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Add the minutes schema, timeline, prompt, validation, name matching and document renderer"`

---

### Task 4: Seam STT và LLM, adapter thật, đánh giá trên audio tiếng Việt mẫu (cổng chốt vendor)

**Files:**
- Create: `backend/packages/meetings/src/ai/speech-to-text.ts`, `deepgram-stt.ts`, `gemini-stt.ts`, `minutes-writer.ts`, `claude-minutes-writer.ts`, `cost.ts`, `ai-env.ts`, `backend/packages/meetings/src/testing/fake-ai.ts`
- Modify: `backend/packages/meetings/package.json` (`@anthropic-ai/sdk` pin bản chính xác mới nhất lúc làm)
- Create: `backend/scripts/meetings-eval.ts`; Modify: `backend/scripts/package.json` (`"meetings:eval": "tsx meetings-eval.ts"`), `.gitignore` (`.superpowers/eval/`)
- Test: `backend/packages/meetings/src/ai/*.spec.ts`

**Interfaces:**
- Produces:
  - `interface SttSegment { startMs: number; endMs: number; text: string }`
  - `interface SpeechToText { readonly provider: string; readonly model: string; transcribe(audio: { body: Buffer; mime: 'audio/ogg'; durationMs: number }, opts: { keyterms: string[] }): Promise<SttSegment[]> }`
  - `class DeepgramSpeechToText implements SpeechToText` — `constructor({ apiKey, model: 'nova-3', language: 'vi' | 'multi', fetchImpl? })`; `POST https://api.deepgram.com/v1/listen?model=…&language=…&smart_format=true&punctuate=true&utterances=true` (+ `keyterm` lặp lại nếu tài liệu Deepgram cho phép với `vi` — kiểm lúc làm), header `Authorization: Token <key>`, `Content-Type: audio/ogg`; map `results.utterances[]` (`start`, `end` giây → ms, `transcript`). Timeout 120 s; 429/5xx → `SttError(retryable: true)`, 4xx khác → `retryable: false`.
  - `class GeminiSpeechToText implements SpeechToText` — `constructor({ apiKey, model: 'gemini-2.5-flash', fetchImpl? })`; REST `generateContent` với audio inline base64 và structured output `{ segments: [{ startSec, endSec, text }] }`; kiểm bằng zod.
  - `interface MinutesWriter { readonly provider: string; readonly model: string; write(input: { system: string; user: string }): Promise<{ draft: MinutesDraft; inputTokens: number; outputTokens: number }> }`
  - `class ClaudeMinutesWriter implements MinutesWriter` — `constructor({ apiKey, model: string (mặc định 'claude-opus-5-5'), effort: 'low'|'medium'|'high' (mặc định 'medium'), client?: Anthropic })`; một lần gọi `messages.parse` không stream, `max_tokens: 16000`, `system`, một message `user`, `output_config: { effort, format: zodOutputFormat(minutesDraftSchema) }`, fallback phía server khi model là Opus 5.5 (xem mục Nguồn); không gửi `temperature`/`thinking.budget_tokens`; `stop_reason === 'refusal'` hoặc `parsed_output === null` → `MinutesWriterError('refused' | 'invalid_output', retryable: false)`; `stop_reason === 'max_tokens'` → `MinutesWriterError('truncated', retryable: false)`; lỗi `Anthropic.RateLimitError`/`InternalServerError`/`APIConnectionError` → `retryable: true`. Dùng `usage.input_tokens`, `usage.output_tokens`.
  - `sttCostMicroUsd(audioMs: number, usdPerMinute: number): bigint`, `llmCostMicroUsd(inputTokens, outputTokens, usdPerMTokIn, usdPerMTokOut): bigint` (làm tròn lên)
  - `minutesAiEnvSchema = z.object({ MEETING_STT_PROVIDER: z.enum(['deepgram', 'gemini', 'fake']).default('fake'), DEEPGRAM_API_KEY: optionalEnv(z.string()), DEEPGRAM_LANGUAGE: z.enum(['vi', 'multi']).default('vi'), GEMINI_API_KEY: optionalEnv(z.string()), MEETING_LLM_PROVIDER: z.enum(['anthropic', 'fake']).default('fake'), ANTHROPIC_API_KEY: optionalEnv(z.string()), MEETING_LLM_MODEL: z.string().default('claude-opus-5-5'), MEETING_LLM_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'), MEETING_STT_USD_PER_MIN: z.coerce.number().default(0.0043), MEETING_LLM_USD_PER_MTOK_IN: z.coerce.number().default(4), MEETING_LLM_USD_PER_MTOK_OUT: z.coerce.number().default(20), MEETING_KEYTERMS: csv })` + `superRefine`: provider khác `fake` thì khoá tương ứng bắt buộc; `NODE_ENV=production` thì provider không được là `fake`.
  - `createSpeechToText(env): SpeechToText`, `createMinutesWriter(env): MinutesWriter`
  - `FakeSpeechToText` (trả `segments` theo map `key → SttSegment[]`, mặc định một câu "lời nói thử" dài bằng `durationMs`; `failTimes(n, retryable)`), `FakeMinutesWriter` (trả draft đặt sẵn hoặc sinh từ dòng `U…` đầu tiên; ghi lại `calls`).
  - `meetings-eval.ts` CLI: `pnpm --filter @luna/scripts meetings:eval -- --cases .superpowers/eval/meetings --stt deepgram:vi,deepgram:multi,gemini --llm claude-opus-5-5,claude-sonnet-5-5`. Mỗi case là thư mục có `speakers.json` (`[{ speakerId, name, file, startOffsetMs }]`), các file `.ogg` theo người, `reference.txt` (bản chép tay theo dòng `S1: …`), `keyterms.txt`, `expected-actions.json` (`[{ task, owner }]`). Xuất `.superpowers/eval/report-<timestamp>.md`: CER (trên chuỗi đã chuẩn hoá NFC, chữ thường, bỏ dấu câu), tỉ lệ nhận đúng thuật ngữ trong `keyterms.txt`, thời gian xử lý, chi phí theo bảng giá env; với mỗi LLM: biên bản dựng bằng `renderMinutesDoc` (in Markdown qua `jsonToMarkdown`), số việc khớp/thiếu/bịa so với `expected-actions.json` (khớp khi owner trùng và task do người duyệt đánh dấu trong file kết quả).

- [ ] **Step 1: Viết test adapter** (dùng `fetchImpl`/`client` giả)

```ts
it('Deepgram: gửi ogg với model nova-3 language vi, đổi giây thành ms, 429 là lỗi thử lại được, 400 thì không', ...)
it('Gemini: phản hồi sai schema → lỗi không thử lại', ...)
it('Claude: gửi đúng model, effort, structured output; refusal và parsed_output null thành lỗi không thử lại; ghi đủ token', ...)
it('env: provider deepgram thiếu DEEPGRAM_API_KEY → lỗi cấu hình; production không cho fake', ...)
it('chi phí: 90 giây Deepgram 0,0043 USD/phút = 6450 micro USD; 30k vào 6k ra Opus = 240000 micro USD', ...)
```

- [ ] **Step 2: Chạy, thấy fail.** — `pnpm --filter @luna/meetings test` → FAIL.
- [ ] **Step 3: Cài đặt** seam, adapter, fake, script.
- [ ] **Step 4: Chạy, thấy pass**; lệnh tổng xanh; commit — `git commit -m "Add speech-to-text and minutes writer seams with Deepgram, Gemini and Claude adapters"`
- [ ] **Step 5: Đánh giá thật (cần chủ dự án)** — chủ dự án ghi 3 buổi họp thật 10–15 phút, có xen thuật ngữ tiếng Anh, mỗi người một file (dùng recorder ở Task 5 trên project LiveKit thử, hoặc ghi tay), viết `reference.txt` và `expected-actions.json`, có sự đồng ý của người trong buổi họp. Dữ liệu chỉ để trong `.superpowers/eval/` (gitignored). Chạy script với tài khoản thử. Ngưỡng chốt: STT có CER ≤ 15% và nhận đúng ≥ 80% thuật ngữ; LLM không bịa việc nào và đúng người phụ trách ≥ 90% trên 3 buổi. Chọn phương án rẻ nhất đạt ngưỡng. Ghi kết quả (con số, không kèm nội dung họp) và lựa chọn vào `docs/DEPLOY.md` mục "Biên bản AI", đổi mặc định env tương ứng trong `.env.prod.example`. Không làm Task 9 ở production trước khi xong bước này.
- [ ] **Step 6: Commit** — `git commit -m "Record the speech-to-text and minutes model evaluation results"`

---

### Task 5: App `recorder` — bot thu âm từng người

**Files:**
- Create: `backend/apps/recorder/package.json` (`@luna/recorder`; deps `@livekit/rtc-node: 1.2.1`, `@luna/meetings`, `@luna/shared`, `@luna/db`, `@nestjs/bullmq`, `bullmq`, `nestjs-pino`), `tsconfig.json`, `vitest.config.ts`, `vitest.config.e2e.ts`
- Create: `backend/apps/recorder/src/main.ts`, `config.ts`, `recorder.module.ts`, `chunker.ts`, `track-recorder.ts`, `recording-session.ts`, `recorder.processor.ts`, `opus-encoder.ts`
- Modify: `backend/Dockerfile` (target `recorder` từ `runtime`, cài `ffmpeg`, `mkdir /var/tmp/luna-recorder`), `backend/docker/docker-compose.prod.yml` (service `recorder`), `backend/docker/docker-compose.dev.yml` không đổi (dev chạy `pnpm dev`)
- Test: `backend/apps/recorder/src/chunker.spec.ts`, `backend/apps/recorder/test/recording-session.e2e-spec.ts`

**Interfaces:**
- Consumes: `MeetingMedia.joinToken({ role: 'recorder', identity: 'luna-recorder', name: 'Luna AI' })`, `decodeRoomMetadata`, `ObjectStore.putFile('meetingAudio', key, path, 'audio/ogg')`, `promoteMinutes`.
- Produces:
  - `recorderEnvSchema` = base + database + redis + s3 + `meetingsEnvSchema` + `{ MEETING_RECORDER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3), RECORDER_TMP_DIR: z.string().default('/var/tmp/luna-recorder'), FFMPEG_PATH: z.string().default('ffmpeg'), MEETING_AUDIO_RETENTION_DAYS: z.coerce.number().int().min(1).default(7) }`
  - `type ChunkEvent = { type: 'open'; startMs: number } | { type: 'data'; samples: Int16Array } | { type: 'close'; startMs: number; durationMs: number; voicedMs: number; keep: boolean }`
  - `class SpeechChunker { constructor(opts?: { sampleRate?: 16000; voiceRms?: 500; closeAfterSilenceMs?: 1500; maxChunkMs?: 300000; minVoicedMs?: 400; preRollMs?: 300 }); push(samples: Int16Array, atMs: number): ChunkEvent[]; flush(atMs: number): ChunkEvent[] }` — thuật toán: mỗi frame tính RMS; khi đang đóng và frame có tiếng → `open` với `startMs = atMs - preRollMs` (giữ bộ đệm vòng `preRollMs` để phát ra trong `data` đầu tiên); khi đang mở → mọi frame thành `data`; đóng khi im lặng liên tục ≥ `closeAfterSilenceMs` hoặc độ dài ≥ `maxChunkMs` (đóng do độ dài thì mở ngay đoạn mới nếu frame hiện tại có tiếng); khoảng trống thời gian giữa hai frame (`atMs` nhảy > 200 ms, ví dụ người đó tắt mic) tính như im lặng; `keep = voicedMs >= minVoicedMs`.
  - `class OpusEncoder { start(path: string): void; write(samples: Int16Array): void; finish(): Promise<{ sizeBytes: number }>; abort(): void }` — `ffmpeg -hide_banner -loglevel error -f s16le -ar 16000 -ac 1 -i pipe:0 -c:a libopus -b:a 24k -application voip -f ogg <path>` chạy `nice` theo `FFMPEG_NICE`.
  - `class TrackRecorder { constructor(deps, meeting: { id: string; startedAt: Date }, userId: string); consume(stream: AsyncIterable<AudioFrame>): Promise<void>; pause(): Promise<void>; resume(): void; stop(): Promise<void> }` — `atMs = Date.now() - startedAt - frameDurationMs`; đoạn `keep` → `putFile('meetingAudio', 'meetings/<meetingId>/<userId>/<startMs>.ogg')` rồi `meetingAudioChunk.create` (bắt P2002 thì bỏ qua); đoạn không `keep` → xoá file tạm. `pause` đóng đoạn đang mở và bỏ frame tới khi `resume`.
  - `class RecordingSession { run(meetingId: string, signal: AbortSignal): Promise<'ended' | 'disabled' | 'empty'> }` — upsert `meeting_minutes` (status `RECORDING`, `audioPurgeAfter = now + MEETING_AUDIO_RETENTION_DAYS`); `room.connect(media.serverUrl, token, { autoSubscribe: false })`; với mỗi `RemoteTrackPublication` có `kind === audio` và `source === TrackSource.SOURCE_MICROPHONE` của participant không ẩn và identity là uuid → `setSubscribed(true)`, khi `TrackSubscribed` → `new AudioStream(track, { sampleRate: 16000, numChannels: 1 })` → `TrackRecorder.consume`; `RoomMetadataChanged` với `aiNotesEnabled=false` → `pause` mọi recorder, `true` → `resume`; mỗi 10 giây đọc DB: meeting không còn `LIVE` → kết thúc; không còn participant người thật trong `MEETING_EMPTY_GRACE_SEC` → kết thúc. Kết thúc: `stop` mọi recorder (chờ upload xong), `room.disconnect()`, đặt `audioCompletedAt = now`, `promoteMinutes`.
  - `RecorderProcessor` trên queue `meeting-recorder`, concurrency `MEETING_RECORDER_CONCURRENCY`, `lockDuration: 60_000`.
  - Compose service `recorder`: `<<: *app-env`, target `recorder`, `environment: <<: *no-owner-secrets` + `RECORDER_TMP_DIR`, `networks: [internal]`, `cpus: '1'`, `mem_limit: 1g`, volume `recorder-tmp:/var/tmp/luna-recorder`, `stop_grace_period: 60s`, healthcheck như worker (cổng metrics riêng `RECORDER_METRICS_PORT` 9465).

- [ ] **Step 1: Viết test**

```ts
it('chunker: im lặng 1,5 giây đóng đoạn; đoạn bắt đầu sớm hơn 300 ms nhờ pre-roll', ...)
it('chunker: nói liền 6 phút tách thành đoạn 5 phút và đoạn tiếp theo bắt đầu đúng ở 300000 ms', ...)
it('chunker: tiếng lách cách 200 ms bị bỏ (keep false)', ...)
it('chunker: mic tắt 10 giây giữa câu (frame nhảy thời gian) đóng đoạn cũ, mở đoạn mới đúng mốc', ...)
it('phiên ghi: chỉ đăng ký mic, không đăng ký camera và màn hình; bỏ qua participant ẩn', ...)
it('phiên ghi: chủ trì tắt ghi biên bản giữa chừng → không có đoạn nào trong khoảng tắt', ...)
it('phiên ghi: bot chạy lại sau khi chết không tạo đoạn trùng offset', ...)
it('phiên ghi: buổi họp kết thúc → đặt audioCompletedAt và đẩy job biên bản chạy ngay', ...)
```

Test e2e dùng `FakeRoom` (EventEmitter cùng tên sự kiện `RoomEvent.*` mà `RecordingSession` dùng, inject qua tham số `connectRoom: (url, token) => Promise<RoomLike>`), `FakeMeetingMedia`, MinIO và Postgres của testcontainers như worker; ffmpeg thật (CI đã có cho worker).

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/recorder test && pnpm --filter @luna/recorder test:e2e` → FAIL.
- [ ] **Step 3: Cài đặt.**
- [ ] **Step 4: Chạy, thấy pass**; `docker compose -f backend/docker/docker-compose.prod.yml config` hợp lệ; `docker build --target recorder backend` thành công.
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Add a server-side recorder that saves each participant's speech to MinIO"`

---

### Task 6: Worker — pipeline biên bản, thử lại, xoá âm thanh

**Files:**
- Create: `backend/apps/worker/src/processors/meeting-minutes.processor.ts`
- Modify: `backend/apps/worker/src/worker.module.ts` (queue `meeting-minutes`, `meeting-recorder`; provider `SPEECH_TO_TEXT`, `MINUTES_WRITER` từ env), `backend/apps/worker/src/config/worker-config.ts` (`minutesAiEnvSchema`, `MEETING_MINUTES_CONCURRENCY` mặc định 1, `MEETING_AUDIO_WAIT_SEC` mặc định 900), `backend/apps/worker/src/processors/meetings.processor.ts` (job `reconcile` dùng `MEETING_ENDED_HOOK` thật)
- Test: `backend/apps/worker/test/meeting-minutes.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 bảng + job; Task 3 hàm thuần; Task 4 seam; `writeAudit`, `writeNotifications`.
- Produces:
  - `meetingEndedHook(queue): MeetingEndedHook` (đặt trong `@luna/meetings/src/minutes/hook.ts`) — nếu meeting có dòng `meeting_minutes` thì `enqueueMinutes(queue, id, { delayMs: MEETING_AUDIO_WAIT_SEC * 1000 })`; recorder `promoteMinutes` khi xong nên thường chạy ngay.
  - Job `process`:
    1. Đọc `meeting_minutes`; status `AWAITING_REVIEW | PUBLISHING | PUBLISHED` → trả về. Meeting chưa `ENDED` → trả về.
    2. `audioCompletedAt` null và `endedAt` mới hơn `MEETING_AUDIO_WAIT_SEC` → `job.moveToDelayed(Date.now() + 30_000, token)` + `throw new DelayedError()`.
    3. Đặt `PROCESSING`. Chép lời mọi chunk `transcribedAt IS NULL AND deletedAt IS NULL`, song song tối đa 4: tải qua `store.getStream`, `stt.transcribe(…, { keyterms: MEETING_KEYTERMS })`, trong một transaction ghi `meeting_utterances` (`startMs = chunk.startOffsetMs + seg.startMs`), `transcribedAt`, `meeting_ai_usage` kind `stt`. Chunk lỗi không thử lại được → đánh dấu bỏ qua (đặt `transcribedAt`, không có lời nói) và ghi `error` cảnh báo.
    4. Khi hết chunk chưa chép: `transcriptCompletedAt = now`, xoá object của mọi chunk (`store.delete`), đặt `deletedAt`, `audioPurgedAt`.
    5. `buildTimeline` (chat qua bảng `meeting_chat_messages`); không có lời nói → draft rỗng, không gọi LLM; có → `writer.write({ system: MINUTES_SYSTEM_PROMPT + MINUTES_OUTPUT_RULES, user: buildMinutesUserMessage(...) })`, ghi `meeting_ai_usage` kind `llm`.
    6. `validateDraft`; với việc có `ownerName` mà không có `ownerSpeakerId`: `matchPerson` trên **thành viên workspace** → `suggestions`.
    7. `renderMinutesDoc`; cập nhật `draft`, `draftDoc`, `suggestions`, `droppedItemCount`, `draftRevision = 1`, status `AWAITING_REVIEW`, xoá `error`/`failedStage`; audit `meeting.minutes_draft` (actor null, metadata `{ meetingId, actionItems, dropped, provider, model }`); thông báo `meeting.minutes_review` cho người tạo buổi họp.
  - Lỗi: lần thử cuối (`job.attemptsMade + 1 >= job.opts.attempts`) hoặc lỗi không thử lại được → status `FAILED`, `failedStage` = `'transcribe' | 'draft'`, `error` (≤ 500 ký tự, không chứa khoá), thông báo `meeting.minutes_failed` cho người tạo; lỗi không thử lại được ném `UnrecoverableError`.
  - Job `purge-audio` (scheduler `0 4 * * *` tz `Asia/Ho_Chi_Minh` ở `MaintenanceProcessor` hoặc processor này): chunk chưa xoá thuộc `meeting_minutes.audioPurgeAfter < now` → xoá object, đặt `deletedAt`, `audioPurgedAt`.

- [ ] **Step 1: Viết test**

```ts
it('đầy đủ: 3 người, 5 đoạn → lời nói có mốc đúng, biên bản chờ duyệt, âm thanh bị xoá, 2 dòng chi phí, thông báo chủ trì', ...)
it('chạy lại job đã xong không gọi STT hay LLM lần nữa', ...)
it('STT lỗi tạm thời rồi khỏi: chỉ chép lại đoạn chưa chép', ...)
it('LLM lỗi hết số lần: FAILED ở bước draft, lời nói còn, âm thanh đã xoá, thông báo meeting.minutes_failed', ...)
it('STT lỗi hết số lần: FAILED ở bước transcribe, âm thanh giữ lại tới audioPurgeAfter', ...)
it('không có lời nói: không gọi LLM, bản nháp chỉ có chat', ...)
it('âm thanh chưa xong và buổi họp mới kết thúc: job hoãn 30 giây, không đổi trạng thái', ...)
it('purge-audio xoá âm thanh quá hạn, giữ âm thanh chưa tới hạn', ...)
it('gợi ý người vắng: "anh Hùng sẽ làm" khớp thành viên Hùng duy nhất; người ngoài workspace không được gợi ý', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/worker test:e2e -- meeting-minutes` → FAIL.
- [ ] **Step 3: Cài đặt.**
- [ ] **Step 4: Chạy, thấy pass.**
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Turn recorded meeting audio into a draft minutes document in the worker"`

---

### Task 7: API — bật thu âm, xem/sửa/gửi/thử lại biên bản

**Files:**
- Create: `backend/apps/api/src/meetings/minutes/minutes.service.ts`, `minutes.controller.ts`, `minutes.schemas.ts`, `minutes-queue.service.ts`
- Modify: `backend/apps/api/src/meetings/meetings.module.ts` (provide `MEETING_ENDED_HOOK` = `meetingEndedHook(queue)`), `meeting-room.service.ts` (sau khi buổi họp vào `LIVE` hoặc bật ghi khi `LIVE` → `enqueueRecording`), `backend/apps/api/src/infra/queue/queue.module.ts` (2 queue mới), `backend/apps/api/src/documents/documents.service.ts` (thêm `createWithContent`), `backend/apps/api/src/meetings/meetings.schemas.ts` (`MeetingDetailDto.minutes`)
- Test: `backend/apps/api/test/meeting-minutes.e2e-spec.ts`

**Interfaces:**
- Consumes: `MeetingAccess`, `NodeTree`, `ContentAccessService.resolveMany`, `NotificationsService`, `AuditService`, Task 3 `applyMentionConfirmations`, `collectMentionIds`.
- Produces:
  - `DocumentsService.createWithContent(user: AuthenticatedUser, input: { workspaceId: string; parentId: string | null; name: string; json: DocJSON; autoRename: boolean }, ctx: RequestContext, announce: Announce): Promise<CreatedNode>` — `tree.create` với `extra.document = documentFields(json)` (không gọi mạng trong khoá).
  - `canReview(access) = access.isHost || access.memberRole === 'ADMIN'`
  - `GET meetings/:id/minutes` → `MinutesDto = { status: MinutesStatus | 'NONE'; documentNodeId: string | null; canReview: boolean; error: string | null; failedStage: string | null; droppedItemCount: number; draft: { doc: DocJSON; revision: number; suggestions: MentionSuggestion[] } | null }` — `draft` chỉ khi `canReview` và status `AWAITING_REVIEW`; `documentNodeId` chỉ trả khi người xem có quyền đọc node đó.
  - `PUT meetings/:id/minutes/draft` body `{ doc: DocJSON (≤ 2 MB khi stringify, hợp lệ với editorSchema), revision: number }` → `{ revision }`; status khác `AWAITING_REVIEW` → 409 `These minutes are not waiting for review`; `revision` lệch → 409 `Someone else saved these minutes, reload to see their changes`; cập nhật có điều kiện `WHERE draft_revision = $rev`.
  - `POST meetings/:id/minutes/publish` body `{ revision: number; confirmedUserIds: string[] }` → `{ documentNodeId }`:
    1. Chiếm quyền: `UPDATE … SET status='PUBLISHING' WHERE meeting_id=$id AND status='AWAITING_REVIEW' AND draft_revision=$rev` → 0 dòng thì 409 như trên.
    2. `doc = applyMentionConfirmations(draftDoc, confirmed ∩ suggestions.userId)`.
    3. Thư mục: tìm node `FOLDER` chưa xoá ở gốc DOCS tên chuẩn hoá = `nameKey('Biên bản họp')`; không có thì `tree.create` FOLDER `Biên bản họp` (`autoRename: false`; gặp 409 trùng tên thì tìm lại một lần, nếu mục trùng không phải folder thì tạo với `autoRename: true`).
    4. `createWithContent` tên `Biên bản: <title> · dd/MM/yyyy` (`autoRename: true`), announce `{ action: 'meeting.minutes_publish', metadata: n => ({ meetingId, name: n.name, parentId: n.parentId }) }`.
    5. Người được mời và người dự không phải thành viên workspace → `nodeShare.createMany({ role: 'VIEWER', grantedById: publisher, skipDuplicates: true })` + audit `share.add` metadata `{ userId, role: 'VIEWER', via: 'meeting' }`.
    6. Status `PUBLISHED`, `documentNodeId`, `publishedAt`, `publishedById`.
    7. Người nhận = (người được mời ∪ người dự ∪ `collectMentionIds(doc)`) − người gửi; lọc theo `resolveMany(userId, [nodeId])` có `role`; `meeting.minutes_published` cho tất cả, `meeting.minutes_assigned` thêm cho người được gắn (payload `{ meetingId, workspaceId, nodeId, title, tasks: string[] }`).
    8. Bước 3–5 lỗi → trả status `AWAITING_REVIEW` (xoá node nếu đã tạo) rồi ném lại lỗi.
  - `POST meetings/:id/minutes/retry` (reviewer, status `FAILED`) → 202; nếu `failedStage = 'transcribe'` và `audioPurgedAt` đã có → 409 `The audio for this meeting has expired`; đặt `PROCESSING`, `enqueueMinutes(queue, id, { attempt: n })` với `n` = số lần thử lại trước đó + 1 (đếm audit `meeting.minutes_retry`); audit `meeting.minutes_retry`.
  - `MeetingDetailDto.minutes: { status: MinutesStatus | 'NONE'; documentNodeId: string | null }`.

- [ ] **Step 1: Viết test**

```ts
it('vào phòng khi bật ghi biên bản → có job record; tắt ghi trước khi bắt đầu → không có job', ...)
it('bản nháp chỉ người tạo và quản trị workspace xem được; thành viên khác chỉ thấy trạng thái; người ngoài 404', ...)
it('lưu nháp: revision lệch → 409; nội dung sai schema editor → 400', ...)
it('gửi biên bản: tạo thư mục "Biên bản họp" một lần, tài liệu có mention, share chỉ xem cho người được mời ngoài workspace, audit meeting.minutes_publish', ...)
it('gửi hai lần đồng thời → một tài liệu, lần sau 409', ...)
it('gợi ý không được xác nhận thành chữ thường và không nhận thông báo; được xác nhận thì nhận meeting.minutes_assigned', ...)
it('người được gắn nhưng không xem được tài liệu không nhận thông báo', ...)
it('tạo tài liệu lỗi giữa chừng → biên bản quay về chờ duyệt, không có tài liệu mồ côi', ...)
it('thử lại khi lỗi ở bước draft → job mới với jobId khác; âm thanh đã hết hạn ở bước transcribe → 409', ...)
```

- [ ] **Step 2: Chạy, thấy fail** — `pnpm --filter @luna/api test:e2e -- meeting-minutes` → FAIL.
- [ ] **Step 3: Cài đặt.**
- [ ] **Step 4: Chạy, thấy pass**; `pnpm --filter @luna/api openapi:types`; e2e `documents` vẫn PASS.
- [ ] **Step 5: Lệnh tổng xanh, commit** — `git commit -m "Let the host review, edit and publish AI meeting minutes as a Luna document"`

---

### Task 8: Chi phí AI cho admin

**Files:**
- Modify: `backend/apps/api/src/admin/meeting-usage.service.ts`, `admin.schemas.ts`, `backend/apps/api/src/config/app-config.ts` (`MEETING_LIVEKIT_USD_PER_PARTICIPANT_MIN: z.coerce.number().default(0.0005)`)
- Modify: `frontend/src/components/admin/overview-page.tsx` (khối "Cuộc họp": số buổi, phút họp, phút chép lời, token, chi phí ước tính tháng này và tháng trước)
- Test: `backend/apps/api/test/admin.e2e-spec.ts`

**Interfaces:**
- Produces: mỗi phần tử `months[]` thêm `{ sttMinutes: number; llmInputTokens: number; llmOutputTokens: number; aiCostUsd: number; liveKitEstimateUsd: number }`; `aiCostUsd = Σ cost_micro_usd / 1e6`; `liveKitEstimateUsd = participantMinutes × MEETING_LIVEKIT_USD_PER_PARTICIPANT_MIN` (ghi rõ trên UI là ước tính, gói cố định không tính).

- [ ] **Step 1: Viết test** — `it('chi phí AI theo tháng cộng đúng micro USD; dòng chi phí của buổi họp đã xoá vẫn được tính', ...)`.
- [ ] **Step 2: Chạy, thấy fail.** — `pnpm --filter @luna/api test:e2e -- admin` → FAIL.
- [ ] **Step 3: Cài đặt** backend, sinh openapi types; FE qua `evon:ui-ux` nhánh "sửa một component nhỏ".
- [ ] **Step 4: Chạy, thấy pass**; FE `pnpm lint && pnpm typecheck && pnpm build`; trình duyệt `?as=admin@lunatech.vn` thấy khối "Cuộc họp".
- [ ] **Step 5: Commit** — `git commit -m "Show meeting minutes and AI cost to admins"`

---

### Task 9: FE — trạng thái biên bản, duyệt và gửi (qua `evon:ui-ux`)

**Files:**
- Create: `frontend/src/components/meetings/minutes-panel.tsx`, `minutes-draft-editor.tsx`
- Modify: `frontend/src/components/meetings/meeting-page.tsx` (khối biên bản khi `ENDED`), `frontend/src/lib/meetings.ts` (`getMinutes`, `saveMinutesDraft`, `publishMinutes`, `retryMinutes`), `frontend/src/components/shell/notification-bell.tsx` (`meeting.minutes_review` → trang buổi họp; `meeting.minutes_published`, `meeting.minutes_assigned` → `docHref(workspaceId, nodeId)`; `meeting.minutes_failed` → trang buổi họp), `frontend/src/components/meetings/meetings-page.tsx` (cột/nhãn trạng thái biên bản)

**Interfaces:**
- Consumes: Task 7 route; `LunaMention` ở FE (Task 1).
- Produces:
  - `MinutesPanel` theo `MinutesDto.status`: `NONE` → "Buổi họp này không ghi biên bản"; `RECORDING`/`PROCESSING` → "Đang xử lý biên bản…" (tự tải lại 15 giây/lần); `AWAITING_REVIEW` + không duyệt được → "Biên bản đang chờ người chủ trì duyệt"; `AWAITING_REVIEW` + duyệt được → `MinutesDraftEditor`; `PUBLISHED` → link "Mở biên bản" (hoặc "Biên bản đã gửi" nếu không có quyền); `FAILED` → lý do ngắn + nút "Thử lại" cho người duyệt.
  - `MinutesDraftEditor`: Tiptap không collab (`StarterKit`, `TableKit`, `TaskList`, `LunaMention`, không `Collaboration`), mention `suggested` hiện màu khác kèm chữ "gợi ý"; danh sách gợi ý dạng checkbox "Gắn @Tên cho việc …"; dòng "AI đã bỏ N việc không có trích dẫn" khi `droppedItemCount > 0`; nút "Lưu nháp" (PUT, giữ `revision`), "Gửi biên bản" (xác nhận: "Biên bản sẽ hiện cho mọi người xem được workspace và gửi thông báo"); 409 → toast "Có người vừa lưu biên bản, tải lại để xem" và nút tải lại.

- [ ] **Step 1: Chạy quy trình `evon:ui-ux`** — brief: khối biên bản trên trang buổi họp đã kết thúc, 4 trạng thái, màn duyệt nháp; 2–3 wireframe; người dùng chọn.
- [ ] **Step 2: Dựng.**
- [ ] **Step 3: Kiểm** — `pnpm lint && pnpm typecheck && pnpm build`; dev với `MEETING_STT_PROVIDER=fake`, `MEETING_LLM_PROVIDER=fake`: `?as=qa.creator@lunatech.vn` họp, nói, kết thúc → thấy "Đang xử lý" rồi màn duyệt; bỏ chọn một gợi ý, sửa một câu, gửi → mở tài liệu thấy mention và bản ghi lời nói; `?as=qa.member@lunatech.vn` nhận thông báo và mở được tài liệu, trước khi gửi chỉ thấy "đang chờ duyệt"; `?as=qa.outsider@lunatech.vn` (được mời) mở được tài liệu ở chế độ chỉ xem qua "Được chia sẻ".
- [ ] **Step 4: Commit** — `git commit -m "Add the minutes review panel and minutes notifications"`

---

### Task 10: Triển khai, chạy thử thật

**Files:**
- Modify: `docs/DEPLOY.md` (mục "Biên bản AI": tạo tài khoản Deepgram/Anthropic (hoặc vendor đã chốt ở Task 4), biến env, bucket `luna-meeting-audio`, service `recorder`, thời gian giữ âm thanh, cách xem chi phí), `backend/.env.prod.example` (mọi biến mới; provider mặc định theo kết quả Task 4)

- [ ] **Step 1:** Cập nhật tài liệu và env mẫu.
- [ ] **Step 2:** Chạy một buổi họp thật 15–20 phút, 5+ người trên môi trường staging với tài khoản thử: đo thời gian từ khi kết thúc tới khi có bản nháp (mục tiêu ≤ 10 phút cho 45 phút họp), CPU/RAM container `recorder` (`docker stats`), kiểm bucket không còn âm thanh sau khi có bản nháp, chi phí ghi trong trang admin khớp bảng tính ước lượng ±30%.
- [ ] **Step 3:** Lệnh tổng backend + FE xanh, commit — `git commit -m "Document the AI minutes setup and the first live trial"`

---

## Self-review (đã chạy)

- Spec coverage: thu âm từng người (Task 5), chép lời có mốc + ghép chat + LLM (Task 3, 4, 6), 4 phần biên bản (Task 3 `renderMinutesDoc`), tài liệu rich-text trong thư mục "Biên bản họp" qua `NodeTree` (Task 7), @mention trong nội dung (Task 1, 3, 7), nháp chờ chủ trì/quản trị duyệt rồi mới hiện và thông báo (Task 6, 7, 9), "đang xử lý → chờ duyệt → link" (Task 9), AI lỗi vẫn có bản ghi lời nói + nút thử lại, chép lời lỗi giữ âm thanh tới hạn (Task 6, 7), xoá âm thanh với N env mặc định 7 (Task 5, 6), chỉ gửi âm thanh và chữ (Global Constraints, Task 5), chi phí theo phút (Task 8), §6 share chỉ xem cho người được mời và giao việc cho người vắng (Task 6, 7), §7 vendor + chi phí + đánh giá (mục đề xuất, Task 4).
- Kiểu nhất quán: `MinutesDraft`, `Speaker`, `TimelineEntry`, `MentionSuggestion`, `SpeechToText`, `MinutesWriter`, `enqueueMinutes`, `promoteMinutes`, `enqueueRecording`, `meetingEndedHook`, `MinutesStatus` dùng cùng tên ở mọi task; dùng `MEETING_ENDED_HOOK`, `endMeeting`, `MeetingAccess`, `roomNameFor` đúng như plan phòng họp.
