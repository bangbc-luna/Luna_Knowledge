import { buildTimeline, formatTimelineForPrompt } from './timeline.js';

const start = new Date('2026-11-03T07:00:00Z');
const names = new Map([
  ['u1', 'Tuấn'],
  ['u2', 'Lan'],
]);

describe('buildTimeline', () => {
  it('dòng thời gian gộp lời nói liền nhau cùng người và chen chat đúng thời điểm', () => {
    const t = buildTimeline({
      utterances: [
        { userId: 'u2', startMs: 4000, endMs: 6000, text: 'Em nhận.' },
        { userId: 'u1', startMs: 0, endMs: 2000, text: 'Chào mọi người.' },
        { userId: 'u1', startMs: 3000, endMs: 3900, text: 'Bắt đầu nhé.' },
        { userId: 'u1', startMs: 9000, endMs: 9500, text: 'Xong.' },
      ],
      chat: [
        { userId: 'u1', body: 'link', createdAt: new Date(start.getTime() + 5000) },
        { userId: 'u2', body: 'sớm', createdAt: new Date(start.getTime() - 500) },
      ],
      meetingStartedAt: start,
      names,
    });
    expect(t.entries.map((e) => [e.refId, e.startMs, e.text])).toEqual([
      ['U1', 0, 'Chào mọi người. Bắt đầu nhé.'],
      ['C1', 0, 'sớm'],
      ['U2', 4000, 'Em nhận.'],
      ['C2', 5000, 'link'],
      ['U3', 9000, 'Xong.'],
    ]);
    expect(t.speakers.map((s) => [s.speakerId, s.name])).toEqual([
      ['S1', 'Tuấn'],
      ['S2', 'Lan'],
    ]);
    expect(formatTimelineForPrompt(t).split('\n')[3]).toBe('[C2 00:00:05] S1 Tuấn (chat): link');
  });
});
