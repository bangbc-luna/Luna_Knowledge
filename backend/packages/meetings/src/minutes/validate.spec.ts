import type { MinutesDraft } from './schema.js';
import type { Speaker } from './timeline.js';
import { validateDraft } from './validate.js';

const speakers: Speaker[] = [
  { speakerId: 'S1', userId: 'u1', name: 'Tuấn' },
  { speakerId: 'S2', userId: 'u2', name: 'Lan' },
];
const refs = new Set(['U1', 'U2', 'C1']);

type Item = Partial<MinutesDraft['actionItems'][number]>;
function draftWith(items: Item[], extra: Partial<MinutesDraft> = {}): MinutesDraft {
  return {
    overview: { summary: 's', decisions: [], deferred: [], openQuestions: [] },
    actionItems: items.map((i) => ({
      task: 'x',
      ownerSpeakerId: null,
      ownerName: null,
      dueText: null,
      dueDate: null,
      ambiguous: false,
      evidence: ['U1'],
      ...i,
    })),
    topics: [],
    notableChat: [],
    ...extra,
  };
}

describe('validateDraft', () => {
  it('việc không có trích dẫn hợp lệ bị bỏ, không gắn mention', () => {
    const r = validateDraft(
      draftWith([{ task: 'Viết test', ownerSpeakerId: 'S2', evidence: ['U999'] }]),
      refs,
      speakers,
    );
    expect(r.draft.actionItems).toHaveLength(0);
    expect(r.droppedItemCount).toBe(1);
  });

  it('việc có task rỗng bị bỏ; trích dẫn lạ được lọc khỏi việc còn lại', () => {
    const r = validateDraft(
      draftWith([{ task: '  ' }, { task: 'Ok', evidence: ['U1', 'U999'] }]),
      refs,
      speakers,
    );
    expect(r.draft.actionItems.map((i) => i.evidence)).toEqual([['U1']]);
    expect(r.droppedItemCount).toBe(1);
  });

  it('ownerSpeakerId không thuộc người dự → chuyển thành tên để khớp', () => {
    const r = validateDraft(
      draftWith([
        { ownerSpeakerId: 'S9', ownerName: 'Hùng' },
        { ownerSpeakerId: 'S9' },
        { ownerSpeakerId: 'Hùng' },
        { ownerSpeakerId: 'S2' },
      ]),
      refs,
      speakers,
    );
    expect(r.draft.actionItems.map((i) => [i.ownerSpeakerId, i.ownerName])).toEqual([
      [null, 'Hùng'],
      [null, null],
      [null, 'Hùng'],
      ['S2', null],
    ]);
  });

  it('bỏ notableChat không tồn tại hoặc không phải chat, giữ ambiguous, cắt giới hạn', () => {
    const r = validateDraft(
      draftWith([{ ambiguous: true }], {
        notableChat: ['C1', 'C7', 'U1', 'C1'],
        overview: {
          summary: 'a'.repeat(5000),
          decisions: Array.from({ length: 150 }, (_, i) => String(i)),
          deferred: [],
          openQuestions: [],
        },
      }),
      refs,
      speakers,
    );
    expect(r.draft.notableChat).toEqual(['C1']);
    expect(r.draft.actionItems[0]?.ambiguous).toBe(true);
    expect(r.draft.overview.summary).toHaveLength(4000);
    expect(r.draft.overview.decisions).toHaveLength(100);
  });
});

describe('validateDraft bổ sung', () => {
  it('việc ambiguous không giữ người phụ trách', () => {
    const r = validateDraft(
      draftWith([{ ambiguous: true, ownerSpeakerId: 'S1', ownerName: 'Lan' }]),
      refs,
      speakers,
    );
    expect(r.draft.actionItems[0]).toMatchObject({
      ambiguous: true,
      ownerSpeakerId: null,
      ownerName: null,
    });
  });

  it('dueDate không phải ngày thật thì thành null', () => {
    const r = validateDraft(
      draftWith([{ dueDate: '2026-02-30' }, { dueDate: '2026-11-05' }, { dueDate: '2026-13-01' }]),
      refs,
      speakers,
    );
    expect(r.draft.actionItems.map((i) => i.dueDate)).toEqual([null, '2026-11-05', null]);
  });

  it('cắt độ dài chuỗi', () => {
    const long = (n: number) => 'x'.repeat(n + 50);
    const r = validateDraft(
      draftWith([{ task: long(500), ownerName: long(120), dueText: long(120) }], {
        topics: [{ title: long(200), points: [long(1000)] }],
        overview: {
          summary: 's',
          decisions: [long(1000)],
          deferred: [long(1000)],
          openQuestions: [long(1000)],
        },
      }),
      refs,
      speakers,
    );
    const i = r.draft.actionItems[0]!;
    expect([i.task.length, i.ownerName?.length, i.dueText?.length]).toEqual([500, 120, 120]);
    expect(r.draft.topics[0]!.title).toHaveLength(200);
    expect(r.draft.topics[0]!.points[0]).toHaveLength(1000);
    expect(r.draft.overview.decisions[0]).toHaveLength(1000);
    expect(r.draft.overview.deferred[0]).toHaveLength(1000);
    expect(r.draft.overview.openQuestions[0]).toHaveLength(1000);
  });
});
