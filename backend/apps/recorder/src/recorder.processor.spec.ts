import { DelayedError, type Job } from 'bullmq';
import { vi } from 'vitest';
import type { RecorderConfig } from './config.js';
import { RecorderProcessor } from './recorder.processor.js';
import type { RecordingSession } from './recording-session.js';

function setup() {
  const run = vi.fn(async () => 'finished' as const);
  const processor = new RecorderProcessor(
    { run } as unknown as RecordingSession,
    { MEETING_RECORDER_CONCURRENCY: 1 } as unknown as RecorderConfig,
  );
  const moveToDelayed = vi.fn(async () => undefined);
  const job = {
    name: 'record',
    data: { meetingId: 'm1' },
    moveToDelayed,
  } as unknown as Job;
  return { processor, run, moveToDelayed, job };
}

describe('RecorderProcessor', () => {
  it('đã nhận tín hiệu tắt thì hoãn job và không mở phiên ghi', async () => {
    const { processor, run, moveToDelayed, job } = setup();
    await processor.onModuleDestroy();
    await expect(processor.process(job, 'token')).rejects.toBeInstanceOf(DelayedError);
    expect(run).not.toHaveBeenCalled();
    expect(moveToDelayed).toHaveBeenCalledTimes(1);
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
  });

  it('chưa tắt thì mở phiên ghi như bình thường', async () => {
    const { processor, run, moveToDelayed, job } = setup();
    await expect(processor.process(job, 'token')).resolves.toBe('finished');
    expect(run).toHaveBeenCalledTimes(1);
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  it('tắt máy mà hoãn job thất bại vẫn ném DelayedError', async () => {
    const { processor, moveToDelayed, job } = setup();
    moveToDelayed.mockRejectedValueOnce(new Error('redis down'));
    await processor.onModuleDestroy();
    await expect(processor.process(job, 'token')).rejects.toBeInstanceOf(DelayedError);
  });

  it('job lạ báo đúng tên job', async () => {
    const { processor, job } = setup();
    (job as unknown as { name: string }).name = 'other';
    await expect(processor.process(job, 'token')).rejects.toThrow('Unknown job "other"');
  });
});
