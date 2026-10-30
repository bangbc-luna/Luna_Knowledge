import { describe, expect, it } from 'vitest';
import { ffmpegCommand, threadArgs } from './ffmpeg.js';

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
