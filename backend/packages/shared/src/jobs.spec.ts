import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { JOBS, QUEUES } from './constants.js';
import {
  enqueueFileJob,
  enqueueIndexNode,
  enqueueMeetingReminder,
  enqueueTranscode,
  type JobName,
  type JobPayloads,
  type JobQueueName,
  transcodeJobOptions,
  type ProcessUploadJob,
  type RegenerateJob,
  SEARCH_JOBS,
} from './index.js';

const fakeQueue = () => {
  const add = vi.fn().mockResolvedValue({});
  return { add, addBulk: vi.fn() };
};

describe('enqueue helpers', () => {
  it('enqueueIndexNode without debounce uses the default search options', async () => {
    const q = fakeQueue();
    await enqueueIndexNode(q, 'n1');
    expect(q.add).toHaveBeenCalledWith(
      'index-node',
      { nodeId: 'n1' },
      { removeOnComplete: true, removeOnFail: 100 },
    );
  });

  it('enqueueIndexNode with debounce delays and dedups by node id', async () => {
    const q = fakeQueue();
    await enqueueIndexNode(q, 'n1', { debounceMs: 1500 });
    expect(q.add).toHaveBeenCalledWith(
      'index-node',
      { nodeId: 'n1' },
      {
        delay: 1500,
        deduplication: { id: 'index-node-n1', ttl: 1500 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  });

  it('enqueueFileJob keeps the job id and retries three times', async () => {
    const q = fakeQueue();
    await enqueueFileJob(q, 'process-upload', { uploadId: 'u1' }, 'upload-u1');
    expect(q.add).toHaveBeenCalledWith(
      'process-upload',
      { uploadId: 'u1' },
      {
        jobId: 'upload-u1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  });

  it('enqueueFileJob without job id omits it', async () => {
    const q = fakeQueue();
    await enqueueFileJob(q, 'regenerate', { nodeId: 'n', versionId: 'v' });
    expect(q.add).toHaveBeenCalledWith(
      'regenerate',
      { nodeId: 'n', versionId: 'v' },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  });

  it('enqueueTranscode prioritises by size', async () => {
    const q = fakeQueue();
    await enqueueTranscode(q, { nodeId: 'n', versionId: 'v' }, 120 * 1024 * 1024, 'transcode-v');
    expect(q.add).toHaveBeenCalledWith(
      'transcode',
      { nodeId: 'n', versionId: 'v' },
      transcodeJobOptions(120 * 1024 * 1024, 'transcode-v'),
    );
  });

  it('types reject wrong payloads', () => {
    expectTypeOf(enqueueFileJob<'regenerate'>)
      .parameter(2)
      .toEqualTypeOf<RegenerateJob>();
    expectTypeOf<JobName<'maintenance'>>().toEqualTypeOf<
      'purge-trash' | 'retention' | 'clean-uploads' | 'blob-gc'
    >();
    expectTypeOf<{ nodeId: string }>().not.toMatchTypeOf<ProcessUploadJob>();
    expectTypeOf<'nope'>().not.toMatchTypeOf<JobName<'file-process'>>();
    expectTypeOf<
      JobPayloads['file-process']['process-upload']
    >().not.toEqualTypeOf<RegenerateJob>();
  });

  it('JobPayloads keys match the runtime constants', () => {
    type Queues = (typeof QUEUES)[keyof typeof QUEUES];
    expectTypeOf<JobQueueName>().toEqualTypeOf<Exclude<Queues, 'audit'>>();
    expectTypeOf<JobName<'search-index'>>().toEqualTypeOf<
      (typeof SEARCH_JOBS)[keyof typeof SEARCH_JOBS]
    >();
    expectTypeOf<JobName<'file-process'>>().toEqualTypeOf<
      typeof JOBS.PROCESS_UPLOAD | typeof JOBS.REGENERATE
    >();
    expectTypeOf<JobName<'video-transcode'>>().toEqualTypeOf<typeof JOBS.TRANSCODE>();
    expectTypeOf<JobName<'maintenance'>>().toEqualTypeOf<
      | typeof JOBS.PURGE_TRASH
      | typeof JOBS.RETENTION
      | typeof JOBS.CLEAN_UPLOADS
      | typeof JOBS.BLOB_GC
    >();
  });

  describe('enqueueMeetingReminder', () => {
    afterEach(() => vi.useRealTimers());

    it('jobId follows the meeting time and the delay subtracts the reminder minutes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'));
      const q = fakeQueue();
      const at = new Date('2026-11-01T11:00:00.000Z');
      await enqueueMeetingReminder(q, 'm1', at, 10);
      expect(q.add).toHaveBeenCalledWith(
        'remind',
        { meetingId: 'm1', scheduledAt: at.toISOString() },
        {
          jobId: `remind-m1-${at.getTime()}`,
          delay: 50 * 60_000,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    });

    it('delay never goes below zero', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'));
      const q = fakeQueue();
      await enqueueMeetingReminder(q, 'm1', new Date('2026-11-01T10:05:00.000Z'), 10);
      expect(q.add.mock.calls[0]![2]).toMatchObject({ delay: 0 });
    });

    it('does nothing for a meeting starting within a minute', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'));
      const q = fakeQueue();
      await enqueueMeetingReminder(q, 'm1', new Date('2026-11-01T10:00:30.000Z'), 10);
      expect(q.add).not.toHaveBeenCalled();
    });
  });
});
