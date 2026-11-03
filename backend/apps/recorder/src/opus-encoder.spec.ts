import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpusEncoder } from './opus-encoder.js';

function stalledFfmpeg(): string {
  const dir = mkdtempSync(join(tmpdir(), 'luna-fake-ffmpeg-'));
  const path = join(dir, 'ffmpeg');
  writeFileSync(path, '#!/bin/sh\nexec sleep 60\n');
  chmodSync(path, 0o755);
  return path;
}

describe('OpusEncoder', () => {
  it('ffmpeg không thoát trong hạn thì bị kill và finish báo lỗi', async () => {
    const encoder = new OpusEncoder({ ffmpegPath: stalledFfmpeg(), finishTimeoutMs: 200 });
    encoder.start(join(tmpdir(), 'never.ogg'));
    const started = Date.now();
    await expect(encoder.finish()).rejects.toThrow('did not finish');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('ghi dồn quá 2 MB mà ffmpeg không đọc thì huỷ đoạn', async () => {
    const encoder = new OpusEncoder({ ffmpegPath: stalledFfmpeg(), finishTimeoutMs: 5000 });
    encoder.start(join(tmpdir(), 'never.ogg'));
    encoder.write(new Int16Array(1_600_000));
    encoder.write(new Int16Array(16));
    await expect(encoder.finish()).rejects.toThrow('backlog');
  });
});
