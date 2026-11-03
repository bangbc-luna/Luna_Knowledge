import type { DocJSON } from '@luna/editor';
import type { MinutesDraft } from './schema.js';
import type { Speaker, TimelineEntry } from './timeline.js';

export interface MentionSuggestion {
  actionIndex: number;
  name: string;
  userId: string;
  userName: string;
}

export interface RenderInput {
  title: string;
  startedAt: Date;
  endedAt: Date;
  hostName: string;
  attendeeCount: number;
  absentees: string[];
  droppedItemCount: number;
  draft: MinutesDraft;
  speakers: Speaker[];
  entries: TimelineEntry[];
  suggestions: MentionSuggestion[];
  timeZone: 'Asia/Ho_Chi_Minh';
}

const AMBIGUOUS_OWNER = 'Chưa rõ người phụ trách';
const ABSENT_NOTE = ' (vắng, cần chủ trì xác nhận)';
const EMPTY = '—';

const bold = [{ type: 'bold' }];

function text(value: string, marks?: Array<{ type: string }>): DocJSON {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

function para(...inline: DocJSON[]): DocJSON {
  return inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
}

function textPara(value: string): DocJSON {
  return value === '' ? para() : para(text(value));
}

function heading(level: number, value: string): DocJSON {
  return { type: 'heading', attrs: { level }, content: [text(value)] };
}

function bullets(items: string[]): DocJSON {
  return {
    type: 'bulletList',
    content: items.map((i) => ({ type: 'listItem', content: [textPara(i)] })),
  };
}

function mention(id: string, label: string, suggested: boolean): DocJSON {
  return { type: 'mention', attrs: { id, label, suggested } };
}

function cell(type: 'tableCell' | 'tableHeader', ...inline: DocJSON[]): DocJSON {
  return { type, content: [para(...inline)] };
}

function formatters(timeZone: string) {
  const parts = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', ...opts })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
  return {
    date: (d: Date) => {
      const p = parts(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
      return `${p.day}/${p.month}/${p.year}`;
    },
    time: (d: Date) => {
      const p = parts(d, { hour: '2-digit', minute: '2-digit' });
      return `${p.hour}:${p.minute}`;
    },
  };
}

function formatDue(dueDate: string | null, dueText: string | null): string {
  if (dueDate) return `${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)}`;
  return dueText && dueText.trim() !== '' ? dueText : EMPTY;
}

export function renderMinutesDoc(input: RenderInput): DocJSON {
  const fmt = formatters(input.timeZone);
  const { draft } = input;
  const speakerById = new Map(input.speakers.map((s) => [s.speakerId, s]));
  const speakerByUser = new Map(input.speakers.map((s) => [s.userId, s]));
  const entryByRef = new Map(input.entries.map((e) => [e.refId, e]));
  const clock = (e: TimelineEntry) => fmt.time(new Date(input.startedAt.getTime() + e.startMs));
  const nameOf = (e: TimelineEntry) => speakerById.get(e.speakerId)?.name ?? '';

  const minutes = Math.max(
    1,
    Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 60000),
  );
  const speechEntries = input.entries.filter((e) => e.kind === 'speech');
  const chatEntries = input.entries.filter((e) => e.kind === 'chat');

  const content: DocJSON[] = [
    heading(1, `Biên bản: ${input.title}`),
    textPara(
      `${fmt.date(input.startedAt)} · ${fmt.time(input.startedAt)}–${fmt.time(input.endedAt)} (${minutes} phút) · Chủ trì: ${input.hostName} · Thư ký: AI Luna (bản nháp, chờ chủ trì duyệt)`,
    ),
    para(
      text(`Người dự (${input.attendeeCount}): `, bold),
      text(`${input.speakers.map((s) => s.name).join(', ')}. `),
      text('Vắng: ', bold),
      text(input.absentees.length ? `${input.absentees.join(', ')}.` : 'không có.'),
    ),
    para(
      text('Nguồn: ', bold),
      text(
        `chép lời âm thanh riêng từng người + ${chatEntries.length} tin nhắn chat trong phòng. Mỗi việc dưới đây có mốc thời gian dẫn về câu nói gốc ở mục "Bản ghi lời nói".`,
      ),
    ),
    heading(2, '1. Tổng quan'),
  ];

  if (speechEntries.length === 0) {
    content.push(textPara('Không có lời nói được ghi lại.'));
  } else {
    content.push(textPara(draft.overview.summary));
    const groups: Array<[string, string[]]> = [
      ['Đã chốt:', draft.overview.decisions],
      ['Hoãn lại:', draft.overview.deferred],
      ['Còn bỏ ngỏ:', draft.overview.openQuestions],
    ];
    for (const [label, items] of groups) {
      if (items.length === 0) continue;
      content.push(textPara(label), bullets(items));
    }
  }

  if (draft.actionItems.length > 0) {
    content.push(heading(2, '2. Phân việc'));
    const header = ['#', 'Việc', 'Người phụ trách', 'Hạn', 'Căn cứ'];
    const rows: DocJSON[] = [
      { type: 'tableRow', content: header.map((h) => cell('tableHeader', text(h, bold))) },
    ];
    let absentSuggestions = 0;
    let ambiguousItems = 0;
    draft.actionItems.forEach((item, index) => {
      let owner: DocJSON[];
      const attendee = item.ownerSpeakerId ? speakerById.get(item.ownerSpeakerId) : undefined;
      const suggestion = input.suggestions.find((s) => s.actionIndex === index);
      if (item.ambiguous) {
        ambiguousItems += 1;
        owner = [text(AMBIGUOUS_OWNER)];
      } else if (attendee) {
        owner = [mention(attendee.userId, attendee.name, false)];
      } else if (suggestion && !speakerByUser.has(suggestion.userId)) {
        absentSuggestions += 1;
        owner = [mention(suggestion.userId, suggestion.userName, true), text(ABSENT_NOTE)];
      } else if (item.ownerName && item.ownerName.trim() !== '') {
        owner = [text(item.ownerName)];
      } else {
        owner = [text(EMPTY)];
      }
      const basis = item.evidence
        .map((ref) => entryByRef.get(ref))
        .filter((e): e is TimelineEntry => e !== undefined)
        .map((e) => `[${clock(e)}] ${nameOf(e)}`)
        .join(', ');
      rows.push({
        type: 'tableRow',
        content: [
          cell('tableCell', text(String(index + 1))),
          cell('tableCell', text(item.task)),
          cell('tableCell', ...owner),
          cell('tableCell', text(formatDue(item.dueDate, item.dueText))),
          cell('tableCell', text(basis === '' ? EMPTY : basis)),
        ],
      });
    });
    content.push({ type: 'table', content: rows });

    const notes: string[] = [];
    if (absentSuggestions > 0) {
      notes.push(
        `${absentSuggestions} việc giao cho người vắng mặt, AI chỉ gợi ý theo câu nói, không gửi thông báo cho tới khi bạn xác nhận`,
      );
    }
    if (ambiguousItems > 0) {
      notes.push(
        `${ambiguousItems} việc có nhiều người cùng nhận nên AI không tự chọn người phụ trách`,
      );
    }
    if (input.droppedItemCount > 0) {
      notes.push(`${input.droppedItemCount} việc bị bỏ vì không có căn cứ trong bản ghi`);
    }
    if (notes.length > 0) {
      content.push(textPara(`Ghi chú cho chủ trì khi duyệt: ${notes.join('; ')}.`));
    }
  } else {
    content.push(heading(2, '2. Phân việc'));
    if (input.droppedItemCount > 0) {
      content.push(
        textPara(
          `Ghi chú cho chủ trì khi duyệt: ${input.droppedItemCount} việc bị bỏ vì không có căn cứ trong bản ghi.`,
        ),
      );
    } else {
      content.push(textPara('Không có việc nào được giao.'));
    }
  }

  if (draft.topics.length > 0) {
    content.push(heading(2, '3. Chi tiết theo chủ đề'));
    draft.topics.forEach((topic, index) => {
      content.push(heading(3, `3.${index + 1} ${topic.title}`));
      for (const point of topic.points) content.push(textPara(point));
    });
  }

  const chosenChat = draft.notableChat
    .map((ref) => entryByRef.get(ref))
    .filter((e): e is TimelineEntry => e !== undefined && e.kind === 'chat');
  if (chosenChat.length > 0) {
    content.push(heading(2, '4. Tin nhắn chat đáng chú ý'));
    for (const e of chosenChat) content.push(textPara(`[${clock(e)}] ${nameOf(e)}: ${e.text}`));
  }

  content.push(heading(2, '5. Bản ghi lời nói'));
  if (speechEntries.length === 0) {
    content.push(textPara('Không có lời nói được ghi lại.'));
  }
  for (const e of speechEntries) {
    content.push(para(text(`[${clock(e)}] ${nameOf(e)}: `, bold), text(e.text)));
  }

  return { type: 'doc', content };
}

function mapMentions(node: DocJSON, fn: (m: DocJSON) => DocJSON | null): DocJSON {
  if (!node.content) return node;
  const content: DocJSON[] = [];
  for (const child of node.content) {
    if (child.type === 'mention') {
      const out = fn(child);
      if (out) content.push(out);
    } else {
      content.push(mapMentions(child, fn));
    }
  }
  return { ...node, content };
}

export function applyMentionConfirmations(doc: DocJSON, confirmedUserIds: Set<string>): DocJSON {
  return mapMentions(doc, (m) => {
    const attrs = m.attrs ?? {};
    if (attrs.suggested !== true) return m;
    if (confirmedUserIds.has(String(attrs.id))) {
      return { ...m, attrs: { ...attrs, suggested: false } };
    }
    const label = String(attrs.label ?? '');
    return label === '' ? null : text(label);
  });
}

export function collectMentionIds(doc: DocJSON): string[] {
  const ids = new Set<string>();
  const walk = (node: DocJSON) => {
    if (node.type === 'mention' && node.attrs?.suggested !== true && node.attrs?.id) {
      ids.add(String(node.attrs.id));
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return [...ids];
}
