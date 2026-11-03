import { editorSchema } from '@luna/editor';
import { Node as PMNode } from '@tiptap/pm/model';
import type { DocJSON } from '@luna/editor';
import { applyMentionConfirmations, collectMentionIds, renderMinutesDoc } from './render.js';
import type { RenderInput } from './render.js';
import { buildTimeline } from './timeline.js';

const startedAt = new Date('2026-11-03T07:00:00Z');
const endedAt = new Date('2026-11-03T07:38:00Z');
const names = new Map([
  ['u1', 'Tuấn'],
  ['u2', 'Lan'],
]);

function build(over: Partial<RenderInput> = {}, withSpeech = true) {
  const t = buildTimeline({
    utterances: withSpeech
      ? [
          { userId: 'u1', startMs: 360000, endMs: 365000, text: 'Mình fix lỗi phân quyền.' },
          { userId: 'u2', startMs: 600000, endMs: 604000, text: 'Hùng ước lượng nhé.' },
        ]
      : [],
    chat: [{ userId: 'u2', body: 'link issue', createdAt: new Date(startedAt.getTime() + 420000) }],
    meetingStartedAt: startedAt,
    names,
  });
  const input: RenderInput = {
    title: 'Họp sprint 13',
    startedAt,
    endedAt,
    hostName: 'Bằng',
    attendeeCount: 2,
    absentees: ['Hùng'],
    droppedItemCount: 0,
    draft: {
      overview: {
        summary: 'Chốt phạm vi.',
        decisions: ['Bỏ camera'],
        deferred: ['Đồng bộ Lark'],
        openQuestions: ['Ai viết hướng dẫn'],
      },
      actionItems: [
        {
          task: 'Sửa lỗi quyền',
          ownerSpeakerId: 'S1',
          ownerName: null,
          dueText: null,
          dueDate: '2026-11-05',
          ambiguous: false,
          evidence: ['U1'],
        },
        {
          task: 'Ước lượng Lark',
          ownerSpeakerId: null,
          ownerName: 'Hùng',
          dueText: 'sprint sau',
          dueDate: null,
          ambiguous: false,
          evidence: ['U2'],
        },
        {
          task: 'Viết hướng dẫn',
          ownerSpeakerId: null,
          ownerName: null,
          dueText: null,
          dueDate: null,
          ambiguous: true,
          evidence: ['U1', 'U2'],
        },
        {
          task: 'Việc lạ',
          ownerSpeakerId: null,
          ownerName: 'Khách',
          dueText: null,
          dueDate: null,
          ambiguous: false,
          evidence: ['U2'],
        },
      ],
      topics: [{ title: 'Phân quyền', points: ['Ý một', 'Ý hai'] }],
      notableChat: ['C1'],
    },
    speakers: t.speakers,
    entries: t.entries,
    suggestions: [{ actionIndex: 1, name: 'Hùng', userId: 'u9', userName: 'Phạm Quốc Hùng' }],
    timeZone: 'Asia/Ho_Chi_Minh',
    ...over,
  };
  return renderMinutesDoc(input);
}

const flat = (n: DocJSON): string =>
  n.type === 'text'
    ? (n.text ?? '')
    : n.type === 'mention'
      ? `@${n.attrs?.label}`
      : (n.content ?? []).map(flat).join(n.type === 'paragraph' ? '' : '\n');
const headings = (d: DocJSON) =>
  (d.content ?? []).filter((n) => n.type === 'heading').map((n) => [n.attrs?.level, flat(n)]);
const findAll = (n: DocJSON, type: string): DocJSON[] => [
  ...(n.type === type ? [n] : []),
  ...(n.content ?? []).flatMap((c) => findAll(c, type)),
];

describe('renderMinutesDoc', () => {
  it('dựng tài liệu đủ mục theo khuôn đã duyệt, giờ theo Asia/Ho_Chi_Minh, qua được editorSchema', () => {
    const doc = build();
    PMNode.fromJSON(editorSchema, doc).check();
    expect(headings(doc)).toEqual([
      [1, 'Biên bản: Họp sprint 13'],
      [2, '1. Tổng quan'],
      [2, '2. Phân việc'],
      [2, '3. Chi tiết theo chủ đề'],
      [3, '3.1 Phân quyền'],
      [2, '4. Tin nhắn chat đáng chú ý'],
      [2, '5. Bản ghi lời nói'],
    ]);
    const body = doc.content!;
    expect(flat(body[1]!)).toBe(
      '03/11/2026 · 14:00–14:38 (38 phút) · Chủ trì: Bằng · Thư ký: AI Luna (bản nháp, chờ chủ trì duyệt)',
    );
    expect(flat(body[2]!)).toBe('Người dự (2): Tuấn, Lan. Vắng: Hùng.');
    expect(flat(body[3]!)).toContain('Nguồn: chép lời âm thanh riêng từng người + 1 tin nhắn chat');
    const text = flat(doc);
    expect(text).toContain('Đã chốt:');
    expect(text).toContain('Hoãn lại:');
    expect(text).toContain('Còn bỏ ngỏ:');
    expect(findAll(doc, 'bulletList')).toHaveLength(3);
    expect(text).toContain('[14:07] Lan: link issue');
    expect(text).toContain('[14:06] Tuấn: Mình fix lỗi phân quyền.');
  });

  it('bảng phân việc 5 cột: mention người dự, gợi ý người vắng, chữ thường, chưa rõ, căn cứ', () => {
    const doc = build();
    const table = findAll(doc, 'table')[0]!;
    const rows = table.content!;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.content!.length === 5)).toBe(true);
    expect(rows[0]!.content!.map(flat)).toEqual(['#', 'Việc', 'Người phụ trách', 'Hạn', 'Căn cứ']);
    const mentions = findAll(table, 'mention').map((m) => m.attrs);
    expect(mentions).toEqual([
      { id: 'u1', label: 'Tuấn', suggested: false },
      { id: 'u9', label: 'Phạm Quốc Hùng', suggested: true },
    ]);
    const owner = (i: number) => flat(rows[i]!.content![2]!);
    expect(owner(2)).toBe('@Phạm Quốc Hùng (vắng, cần chủ trì xác nhận)');
    expect(owner(3)).toBe('Chưa rõ người phụ trách');
    expect(owner(4)).toBe('Khách');
    expect(flat(rows[1]!.content![3]!)).toBe('05/11');
    expect(flat(rows[2]!.content![3]!)).toBe('sprint sau');
    expect(flat(rows[4]!.content![3]!)).toBe('—');
    expect(flat(rows[3]!.content![4]!)).toBe('[14:06] Tuấn, [14:10] Lan');
    expect(flat(doc)).toContain('Ghi chú cho chủ trì khi duyệt: 1 việc giao cho người vắng mặt');
  });

  it('bỏ nhóm tổng quan rỗng, bỏ mục chat rỗng, không ghi chú khi không cần', () => {
    const doc = build({
      draft: {
        overview: { summary: 'S', decisions: ['A'], deferred: [], openQuestions: [] },
        actionItems: [],
        topics: [],
        notableChat: [],
      },
      suggestions: [],
    });
    PMNode.fromJSON(editorSchema, doc).check();
    const text = flat(doc);
    expect(text).not.toContain('Hoãn lại:');
    expect(text).not.toContain('Còn bỏ ngỏ:');
    expect(text).not.toContain('Tin nhắn chat đáng chú ý');
    expect(text).not.toContain('Ghi chú cho chủ trì');
  });

  it('ghi chú nhắc việc bị bỏ', () => {
    const doc = build({ droppedItemCount: 2, suggestions: [] });
    expect(flat(doc)).toContain('2 việc bị bỏ vì không có căn cứ');
  });

  it('không có lời nói: tài liệu có chat và câu "Không có lời nói được ghi lại."', () => {
    const doc = build(
      {
        draft: {
          overview: { summary: '', decisions: [], deferred: [], openQuestions: [] },
          actionItems: [],
          topics: [],
          notableChat: ['C1'],
        },
        absentees: [],
      },
      false,
    );
    PMNode.fromJSON(editorSchema, doc).check();
    const text = flat(doc);
    expect(text).toContain('Không có lời nói được ghi lại.');
    expect(text).toContain('[14:07] Lan: link issue');
    expect(text).toContain('Vắng: không có.');
  });

  it('bản ghi lời nói in đậm tên', () => {
    const doc = build();
    const last = doc.content!.at(-1)!;
    expect(last.content![0]!.marks).toEqual([{ type: 'bold' }]);
  });
});

describe('mention confirmations', () => {
  it('xác nhận gợi ý: mention được xác nhận giữ lại, không xác nhận thành chữ thường; collectMentionIds chỉ lấy mention đã xác nhận', () => {
    const doc = build({
      suggestions: [
        { actionIndex: 1, name: 'Hùng', userId: 'u9', userName: 'Phạm Quốc Hùng' },
        { actionIndex: 3, name: 'Khách', userId: 'u8', userName: 'Khách Quý' },
      ],
    });
    expect(collectMentionIds(doc)).toEqual(['u1']);

    const confirmed = applyMentionConfirmations(doc, new Set(['u9']));
    PMNode.fromJSON(editorSchema, confirmed).check();
    expect(collectMentionIds(confirmed).sort()).toEqual(['u1', 'u9']);

    const none = applyMentionConfirmations(doc, new Set());
    PMNode.fromJSON(editorSchema, none).check();
    expect(collectMentionIds(none)).toEqual(['u1']);
    expect(findAll(none, 'mention').every((m) => m.attrs?.suggested === false)).toBe(true);
    expect(flat(none)).toContain('Phạm Quốc Hùng (vắng, cần chủ trì xác nhận)');
  });
});
