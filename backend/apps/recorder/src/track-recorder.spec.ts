import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { vi } from 'vitest';
import type { AudioEncoder } from './opus-encoder.js';
import { TrackRecorder, type TrackRecorderDeps } from './track-recorder.js';

const loud = () => ({ data: new Int16Array(160).fill(3000) });
const quiet = () => ({ data: new Int16Array(160) });

function fakeEncoder(): AudioEncoder {
  return {
    start: () => undefined,
    write: () => undefined,
    finish: async () => ({ sizeBytes: 10 }),
    abort: () => undefined,
  };
}

function setup(overrides: Partial<TrackRecorderDeps> & { db?: unknown; store?: unknown } = {}) {
  const create = vi.fn(async (_args: unknown) => ({}));
  const findUnique = vi.fn(async (_args: unknown): Promise<unknown> => null);
  const putFile = vi.fn(async (_b: string, key: string) => ({
    provider: 'S3' as const,
    container: 'bucket',
    key,
  }));
  const deps = {
    db: { meetingAudioChunk: { create, findUnique } },
    store: { putFile },
    tmpDir: tmpdir(),
    createEncoder: fakeEncoder,
    now: () => 0,
    retryDelayMs: 1,
    logger: { warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as unknown as TrackRecorderDeps;
  const recorder = new TrackRecorder(deps, { id: 'm1', startedAt: new Date(0) }, 'u1');
  return { recorder, create, findUnique, putFile, deps };
}

async function* burst(n: number, make: () => { data: Int16Array }) {
  for (let i = 0; i < n; i++) yield make();
}

async function* speechThenSilence() {
  yield* burst(100, loud);
  yield* burst(200, quiet);
}

function countingEncoder(written: { samples: number }): AudioEncoder {
  return {
    start: () => undefined,
    write: (samples: Int16Array) => {
      written.samples += samples.length;
    },
    finish: async () => ({ sizeBytes: 10 }),
    abort: () => undefined,
  };
}

describe('TrackRecorder', () => {
  it('luồng âm thanh lỗi giữa chừng: consume báo lỗi, đoạn đang mở vẫn được lưu, stop không treo', async () => {
    const { recorder, create } = setup();
    async function* broken() {
      yield* burst(100, loud);
      throw new Error('stream broke');
    }
    await expect(recorder.consume(broken())).rejects.toThrow('stream broke');
    await recorder.stop();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('một đoạn lỗi lưu không làm hỏng các đoạn sau', async () => {
    const { recorder, create } = setup();
    create.mockRejectedValueOnce(new Error('db down'));
    async function* two() {
      yield* speechThenSilence();
      yield* burst(100, loud);
      yield* burst(200, quiet);
    }
    await recorder.consume(two());
    await recorder.stop();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('tải lên lỗi thì thử lại tối đa 3 lần', async () => {
    const { recorder, putFile, create } = setup();
    putFile.mockRejectedValueOnce(new Error('s3')).mockRejectedValueOnce(new Error('s3'));
    await recorder.consume(speechThenSilence());
    await recorder.stop();
    expect(putFile).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('đã có dòng cùng offset thì không tải lên đè', async () => {
    const { recorder, putFile, create, findUnique } = setup();
    findUnique.mockResolvedValue({ id: 'existing' });
    await recorder.consume(speechThenSilence());
    await recorder.stop();
    expect(putFile).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('event loop kẹt rồi frame dồn về một lúc không chèn im lặng vào đoạn ghi', async () => {
    const clock = { t: 0 };
    const written = { samples: 0 };
    const { recorder, create } = setup({
      now: () => clock.t,
      monotonic: () => clock.t,
      createEncoder: () => countingEncoder(written),
    });
    async function* stalled() {
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
      clock.t += 300;
      for (let i = 0; i < 30; i++) yield loud();
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
      for (let i = 0; i < 200; i++) {
        clock.t += 10;
        yield quiet();
      }
    }
    await recorder.consume(stalled());
    await recorder.stop();
    expect(create).toHaveBeenCalledTimes(1);
    const data = (create.mock.calls[0]![0] as { data: { startOffsetMs: number } }).data;
    expect(data.startOffsetMs).toBe(0);
    expect(written.samples).toBe((100 + 30 + 100 + 150) * 160);
  });

  it('mic tắt thật hơn ngưỡng: đồng hồ mẫu nhảy theo đồng hồ thật và mở đoạn mới đúng mốc', async () => {
    const clock = { t: 0 };
    const { recorder, create } = setup({ now: () => clock.t, monotonic: () => clock.t });
    async function* muted() {
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
      clock.t += 10_000;
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
    }
    await recorder.consume(muted());
    await recorder.stop();
    const offsets = create.mock.calls.map(
      (call) => (call[0] as { data: { startOffsetMs: number } }).data.startOffsetMs,
    );
    expect(offsets).toEqual([0, 11_000]);
  });

  it('dựng thật: đồng hồ đơn điệu lấy từ performance.now, không rơi về Date.now', async () => {
    const spy = vi.spyOn(performance, 'now');
    try {
      const { recorder } = setup({ now: () => 0 });
      await recorder.consume(burst(3, loud));
      await recorder.stop();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('kẹt 2 giây rồi frame dồn về: đồng hồ mẫu không vượt đồng hồ thật quá một frame', async () => {
    const clock = { t: 0 };
    const { recorder } = setup({ now: () => clock.t, monotonic: () => clock.t });
    async function* stalled() {
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
      clock.t += 2000;
      for (let i = 0; i < 200; i++) yield loud();
      for (let i = 0; i < 50; i++) {
        clock.t += 10;
        yield loud();
      }
    }
    await recorder.consume(stalled());
    const sampleClock = (recorder as unknown as { sampleClockMs: number }).sampleClockMs;
    expect(Math.abs(sampleClock - clock.t)).toBeLessThanOrEqual(10);
  });

  it('mic tắt thật 800 ms giữa câu: khoảng trống được đệm im lặng trong cùng một đoạn', async () => {
    const clock = { t: 0 };
    const written = { samples: 0 };
    const { recorder, create } = setup({
      now: () => clock.t,
      monotonic: () => clock.t,
      createEncoder: () => countingEncoder(written),
    });
    async function* gapped() {
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
      clock.t += 800;
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
    }
    await recorder.consume(gapped());
    await recorder.stop();
    expect(create).toHaveBeenCalledTimes(1);
    expect(written.samples).toBe((100 + 80 + 100) * 160);
  });

  it('hai lần kẹt liền nhau, mỗi lần frame đầu cách frame thứ hai một nhịp rồi dồn: đồng hồ mẫu không vượt đồng hồ thật quá một frame', async () => {
    const clock = { t: 0 };
    const { recorder } = setup({ now: () => clock.t, monotonic: () => clock.t });
    async function* stalls() {
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
      for (let round = 0; round < 2; round++) {
        clock.t += 2000;
        yield loud();
        clock.t += 10;
        for (let i = 0; i < 199; i++) yield loud();
        for (let i = 0; i < 20; i++) {
          clock.t += 10;
          yield loud();
        }
      }
    }
    await recorder.consume(stalls());
    const sampleClock = (recorder as unknown as { sampleClockMs: number }).sampleClockMs;
    expect(sampleClock - clock.t).toBeLessThanOrEqual(10);
  });

  it('tạm dừng khi đang giữ một frame: frame đó vẫn được ghi vào đoạn đang mở', async () => {
    const clock = { t: 0 };
    const written = { samples: 0 };
    const { recorder } = setup({
      now: () => clock.t,
      monotonic: () => clock.t,
      createEncoder: () => countingEncoder(written),
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* held() {
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
      clock.t += 2000;
      yield loud();
      await gate;
    }
    const consuming = recorder.consume(held());
    await new Promise((resolve) => setImmediate(resolve));
    await recorder.pause();
    expect(written.samples).toBe(101 * 160);
    release();
    await consuming;
    await recorder.stop();
    expect(written.samples).toBe(101 * 160);
  });

  it('luồng kết thúc khi đang giữ một frame: frame đó vẫn được ghi', async () => {
    const clock = { t: 0 };
    const written = { samples: 0 };
    const { recorder } = setup({
      now: () => clock.t,
      monotonic: () => clock.t,
      createEncoder: () => countingEncoder(written),
    });
    async function* endsHeld() {
      for (let i = 0; i < 100; i++) {
        clock.t += 10;
        yield loud();
      }
      clock.t += 2000;
      yield loud();
    }
    await recorder.consume(endsHeld());
    await recorder.stop();
    expect(written.samples).toBe(101 * 160);
  });
});
