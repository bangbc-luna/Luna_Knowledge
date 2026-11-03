import { tmpdir } from 'node:os';
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
});
