import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildSprite,
  extractPoster,
  ffmpegCommand,
  InvalidVideoError,
  probe,
  threadArgs,
  transcodeHls,
} from './ffmpeg.js';

const tools = {
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  encoder: 'libx264' as const,
  threads: 4,
  nice: 10,
};

describe('ffmpegCommand', () => {
  it('wraps ffmpeg in nice when nice is positive', () => {
    expect(ffmpegCommand(tools, ['-i', 'a'])).toEqual({
      cmd: 'nice',
      args: ['-n', '10', 'ffmpeg', '-i', 'a'],
    });
  });

  it('runs ffmpeg directly when nice is 0', () => {
    expect(ffmpegCommand({ ...tools, nice: 0 }, ['-i', 'a'])).toEqual({
      cmd: 'ffmpeg',
      args: ['-i', 'a'],
    });
  });
});

describe('threadArgs', () => {
  it('limits filter and encoder threads when positive', () => {
    expect(threadArgs(4)).toEqual({
      global: ['-filter_complex_threads', '4'],
      output: ['-threads', '4'],
    });
  });

  it('leaves thread choice to ffmpeg when 0', () => {
    expect(threadArgs(0)).toEqual({ global: [], output: [] });
  });
});

describe('local-files-only protocol whitelist', () => {
  let dir: string;
  let fake: { ffmpeg: string; ffprobe: string; encoder: 'libx264'; threads: number; nice: number };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ffmpeg-spec-'));
    const log = join(dir, 'args.log');
    const probeJson = JSON.stringify({
      format: { duration: '10', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [{ codec_type: 'video', width: 640, height: 360 }],
    });
    const ffmpeg = join(dir, 'fake-ffmpeg');
    const ffprobe = join(dir, 'fake-ffprobe');
    await writeFile(ffmpeg, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\n`);
    await writeFile(ffprobe, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\necho '${probeJson}'\n`);
    await chmod(ffmpeg, 0o755);
    await chmod(ffprobe, 0o755);
    fake = { ffmpeg, ffprobe, encoder: 'libx264', threads: 2, nice: 10 };
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  const lastCall = async () => {
    const lines = (await readFile(join(dir, 'args.log'), 'utf8')).trim().split('\n');
    return lines[lines.length - 1]!;
  };

  it('puts the whitelist right before -i for ffprobe and every ffmpeg call', async () => {
    await probe(fake, '/in.mp4');
    expect(await lastCall()).toContain('-protocol_whitelist file /in.mp4');
    await extractPoster(fake, '/in.mp4', '/out.jpg', 10);
    expect(await lastCall()).toContain('-protocol_whitelist file -i /in.mp4');
    await buildSprite(fake, '/in.mp4', '/out.jpg', {
      durationSec: 10,
      width: 640,
      height: 360,
      hasAudio: false,
    });
    expect(await lastCall()).toContain('-protocol_whitelist file -i /in.mp4');
    await transcodeHls(fake, {
      src: '/in.mp4',
      outDir: dir,
      workDir: dir,
      ladder: [{ name: '360p', width: 640, height: 360, videoKbps: 800, audioKbps: 96 }],
      hasAudio: false,
      key: Buffer.alloc(16),
      iv: Buffer.alloc(16),
      durationSec: 10,
      onProgress: () => {},
    });
    expect(await lastCall()).toContain('-protocol_whitelist file -i /in.mp4');
  });
});

describe('probe container allowlist', () => {
  let dir: string;
  let n = 0;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ffprobe-formats-'));
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  const probeAs = async (formatName: string | undefined) => {
    const json = JSON.stringify({
      format: { duration: '10', format_name: formatName },
      streams: [{ codec_type: 'video', width: 640, height: 360 }],
    });
    const ffprobe = join(dir, `fake-ffprobe-${++n}`);
    await writeFile(ffprobe, `#!/bin/sh\necho '${json}'\n`);
    await chmod(ffprobe, 0o755);
    return probe({ ...tools, ffprobe }, '/in.bin');
  };

  it.each(['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'])('accepts %s', async (formatName) => {
    await expect(probeAs(formatName)).resolves.toMatchObject({ width: 640, height: 360 });
  });

  it.each(['hls', 'concat', 'tty', 'image2', 'lavfi', 'mpegts', 'avi', 'mov', undefined])(
    'rejects %s as not a supported video container',
    async (formatName) => {
      const err = await probeAs(formatName).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidVideoError);
      expect((err as InvalidVideoError).message).toBe(
        'This file is not in a supported video format (MP4, MOV, M4V, WebM or MKV).',
      );
    },
  );
});
