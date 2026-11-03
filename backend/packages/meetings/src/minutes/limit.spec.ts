import { limitTimeline, TIMELINE_TRUNCATION_MARKER } from './limit.js';
import type { TimelineEntry } from './timeline.js';

const entry = (n: number, text: string): TimelineEntry => ({
  refId: `U${n}`,
  kind: 'speech',
  speakerId: 'S1',
  userId: 'u1',
  startMs: n * 1000,
  endMs: n * 1000 + 500,
  text,
});

const speakers = [{ speakerId: 'S1', userId: 'u1', name: 'An' }];

describe('limitTimeline', () => {
  it('bản ghi vừa giới hạn thì giữ nguyên', () => {
    const entries = [entry(1, 'xin chào'), entry(2, 'tạm biệt')];
    const out = limitTimeline({ speakers, entries }, 10_000);
    expect(out.truncated).toBe(false);
    expect(out.entries).toBe(entries);
    expect(out.text).not.toContain(TIMELINE_TRUNCATION_MARKER);
  });

  it('bản ghi quá dài thì cắt phần giữa, giữ đầu và cuối, có dấu hiệu cắt', () => {
    const entries = Array.from({ length: 100 }, (_, i) => entry(i + 1, 'a'.repeat(100)));
    const out = limitTimeline({ speakers, entries }, 2000);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(2000);
    expect(out.text).toContain(TIMELINE_TRUNCATION_MARKER);
    expect(out.entries[0]!.refId).toBe('U1');
    expect(out.entries.at(-1)!.refId).toBe('U100');
    expect(out.entries.length).toBeLessThan(100);
    expect(new Set(out.entries.map((e) => e.refId)).size).toBe(out.entries.length);
    expect(out.text).toContain('[U1 ');
    expect(out.text).not.toContain('[U50 ');
  });

  it('dòng đầu hoặc cuối quá lớn thì cắt cứng thay vì bỏ hẳn', () => {
    const entries = [entry(1, 'a'.repeat(5000)), entry(2, 'b'.repeat(5000))];
    const out = limitTimeline({ speakers, entries }, 2000);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(2000);
    expect(out.text).toContain('[U1 ');
    expect(out.text).toContain('[U2 ');
    expect(out.entries.map((e) => e.refId)).toEqual(['U1', 'U2']);
  });
});
