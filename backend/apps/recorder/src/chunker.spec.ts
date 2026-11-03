import { type ChunkEvent, SpeechChunker } from './chunker.js';

const FRAME_MS = 10;
const frame = (loud: boolean) => new Int16Array(FRAME_MS * 16).fill(loud ? 3000 : 0);

function feed(chunker: SpeechChunker, fromMs: number, durationMs: number, loud: boolean) {
  const events: ChunkEvent[] = [];
  for (let t = fromMs; t < fromMs + durationMs; t += FRAME_MS) {
    events.push(...chunker.push(frame(loud), t));
  }
  return events;
}

const closes = (events: ChunkEvent[]) =>
  events.filter((e): e is Extract<ChunkEvent, { type: 'close' }> => e.type === 'close');
const opens = (events: ChunkEvent[]) =>
  events.filter((e): e is Extract<ChunkEvent, { type: 'open' }> => e.type === 'open');

describe('SpeechChunker', () => {
  it('im lặng 1,5 giây đóng đoạn; đoạn bắt đầu sớm hơn 300 ms nhờ pre-roll', () => {
    const chunker = new SpeechChunker();
    const events = [
      ...feed(chunker, 0, 2000, false),
      ...feed(chunker, 2000, 1000, true),
      ...feed(chunker, 3000, 1400, false),
    ];
    expect(closes(events)).toHaveLength(0);
    events.push(...feed(chunker, 4400, 200, false));
    expect(opens(events)).toEqual([{ type: 'open', startMs: 1700 }]);
    const [close] = closes(events);
    expect(close).toMatchObject({ startMs: 1700, keep: true });
    expect(close!.voicedMs).toBe(1000);
    expect(close!.durationMs).toBe(300 + 1000 + 1500);
  });

  it('pre-roll được phát ra trong data đầu tiên', () => {
    const chunker = new SpeechChunker();
    feed(chunker, 0, 1000, false);
    const events = chunker.push(frame(true), 1000);
    const data = events.find((e) => e.type === 'data');
    expect(data && data.type === 'data' && data.samples.length).toBe((300 + FRAME_MS) * 16);
  });

  it('nói liền 6 phút tách thành đoạn 5 phút và đoạn tiếp theo bắt đầu đúng ở 300000 ms', () => {
    const chunker = new SpeechChunker();
    const events = feed(chunker, 0, 360_000, true);
    events.push(...chunker.flush(360_000));
    const cs = closes(events);
    expect(opens(events).map((o) => o.startMs)).toEqual([0, 300_000]);
    expect(cs.map((c) => [c.startMs, c.durationMs])).toEqual([
      [0, 300_000],
      [300_000, 60_000],
    ]);
    expect(cs.every((c) => c.keep)).toBe(true);
  });

  it('tiếng lách cách 200 ms bị bỏ (keep false)', () => {
    const chunker = new SpeechChunker();
    const events = [
      ...feed(chunker, 0, 1000, false),
      ...feed(chunker, 1000, 200, true),
      ...feed(chunker, 1200, 2000, false),
    ];
    const [close] = closes(events);
    expect(close).toMatchObject({ keep: false, voicedMs: 200 });
  });

  it('mic tắt 10 giây giữa câu (frame nhảy thời gian) đóng đoạn cũ, mở đoạn mới đúng mốc', () => {
    const chunker = new SpeechChunker();
    const events = [
      ...feed(chunker, 0, 1000, true),
      ...feed(chunker, 11_000, 1000, true),
      ...chunker.flush(12_000),
    ];
    expect(closes(events).map((c) => [c.startMs, c.durationMs, c.keep])).toEqual([
      [0, 1000, true],
      [11_000, 1000, true],
    ]);
  });

  it('khoảng trống ngắn giữa câu được đệm im lặng, không tách đoạn', () => {
    const chunker = new SpeechChunker();
    const events = [...feed(chunker, 0, 1000, true), ...feed(chunker, 1500, 1000, true)];
    events.push(...chunker.flush(2500));
    expect(closes(events)).toHaveLength(1);
    expect(closes(events)[0]).toMatchObject({ startMs: 0, durationMs: 2500 });
  });

  it('flush đóng đoạn đang mở và xoá pre-roll', () => {
    const chunker = new SpeechChunker();
    feed(chunker, 0, 500, true);
    expect(closes(chunker.flush(500))).toHaveLength(1);
    const events = chunker.push(frame(true), 600);
    expect(opens(events)).toEqual([{ type: 'open', startMs: 600 }]);
  });
});
