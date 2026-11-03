import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { QUEUES } from './constants.js';
import {
  enqueueFileJob,
  enqueueIndexNode,
  enqueueMeetingReminder,
  enqueueMinutes,
  enqueueRecording,
  RECORDER_BACKOFF_CAP_MS,
  RECORDER_JOB_OPTS,
  recorderBackoffMs,
  promoteMinutes,
  enqueueReindexAll,
  enqueueTranscode,
  upsertScheduler,
  type ScheduledJobQueue,
  type JobName,
  type JobPayloads,
  type JobQueueName,
  transcodeJobOptions,
  type ProcessUploadJob,
  type RegenerateJob,
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
      'index-node' | 'index-tree' | 'drop-workspace' | 'reindex-all'
    >();
    expectTypeOf<JobName<'file-process'>>().toEqualTypeOf<'process-upload' | 'regenerate'>();
    expectTypeOf<JobName<'video-transcode'>>().toEqualTypeOf<'transcode'>();
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
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
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

describe('meeting minutes jobs', () => {
  it('enqueueMinutes: jobId lần đầu và lần thử lại khác nhau; promoteMinutes đẩy job đang chờ chạy ngay', async () => {
    const q = fakeQueue();
    await enqueueMinutes(q, 'm1', { delayMs: 60_000 });
    await enqueueMinutes(q, 'm1', { attempt: 2 });
    expect(q.add).toHaveBeenNthCalledWith(
      1,
      'process',
      { meetingId: 'm1' },
      expect.objectContaining({ jobId: 'minutes-m1', delay: 60_000, attempts: 4 }),
    );
    expect(q.add).toHaveBeenNthCalledWith(
      2,
      'process',
      { meetingId: 'm1' },
      expect.objectContaining({ jobId: 'minutes-m1-retry-2' }),
    );
    expect(q.add.mock.calls[1]![2]).not.toHaveProperty('delay');

    const promote = vi.fn().mockResolvedValue(undefined);
    const delayed = { isDelayed: vi.fn().mockResolvedValue(true), promote };
    const waiting = { isDelayed: vi.fn().mockResolvedValue(false), promote: vi.fn() };
    const withJob = (job: unknown) => ({ ...fakeQueue(), getJob: vi.fn().mockResolvedValue(job) });
    await promoteMinutes(withJob(delayed), 'm1');
    expect(promote).toHaveBeenCalledTimes(1);
    await promoteMinutes(withJob(waiting), 'm1');
    expect(waiting.promote).not.toHaveBeenCalled();
    const empty = withJob(undefined);
    await promoteMinutes(empty, 'm1');
    expect(empty.add).toHaveBeenCalledWith(
      'process',
      { meetingId: 'm1' },
      expect.objectContaining({ jobId: 'minutes-m1' }),
    );
  });
});

describe('meeting recorder jobs', () => {
  const recorderQueue = (job?: { state: string; remove?: () => Promise<void> }) => {
    const remove = job?.remove ?? vi.fn().mockResolvedValue(undefined);
    return {
      ...fakeQueue(),
      remove,
      getJob: vi
        .fn()
        .mockResolvedValue(
          job ? { getState: vi.fn().mockResolvedValue(job.state), remove } : undefined,
        ),
    };
  };

  it('thêm job record-<id> khi chưa có', async () => {
    const q = recorderQueue();
    await enqueueRecording(q, 'm1');
    expect(q.add).toHaveBeenCalledWith(
      'record',
      { meetingId: 'm1' },
      expect.objectContaining({ jobId: 'record-m1', ...RECORDER_JOB_OPTS }),
    );
  });

  it.each(['failed', 'completed'])('job %s cũ bị gỡ rồi thêm lại', async (state) => {
    const q = recorderQueue({ state });
    await enqueueRecording(q, 'm1');
    expect(q.remove).toHaveBeenCalledTimes(1);
    expect(q.add).toHaveBeenCalledTimes(1);
  });

  it.each(['active', 'waiting', 'delayed', 'prioritized'])(
    'job %s giữ nguyên, không thêm lần hai',
    async (state) => {
      const q = recorderQueue({ state });
      await enqueueRecording(q, 'm1');
      expect(q.remove).not.toHaveBeenCalled();
      expect(q.add).not.toHaveBeenCalled();
    },
  );

  it('thử lại nhiều lần với backoff tuỳ biến, tăng gấp đôi và chặn ở 10 phút', () => {
    expect(RECORDER_JOB_OPTS.attempts).toBeGreaterThanOrEqual(10);
    expect(RECORDER_JOB_OPTS.backoff).toEqual({ type: 'custom' });
    expect(RECORDER_BACKOFF_CAP_MS).toBe(600_000);
    expect([1, 2, 3, 4].map(recorderBackoffMs)).toEqual([5000, 10_000, 20_000, 40_000]);
    expect(recorderBackoffMs(8)).toBe(600_000);
    expect(recorderBackoffMs(40)).toBe(600_000);
  });

  describe('scheduler helpers', () => {
    it('upsertScheduler dùng tên job làm id và gắn tuỳ chọn giữ lại mặc định', async () => {
      const upsertJobScheduler = vi.fn().mockResolvedValue({});
      const q = { ...fakeQueue(), upsertJobScheduler } as ScheduledJobQueue<'maintenance'>;
      await upsertScheduler(q, 'blob-gc', { every: 600_000 });
      expect(upsertJobScheduler).toHaveBeenCalledWith(
        'blob-gc',
        { every: 600_000 },
        { name: 'blob-gc', opts: { removeOnComplete: 30, removeOnFail: 100 } },
      );
    });

    it('upsertScheduler chỉ nhận job không có dữ liệu của đúng hàng đợi', () => {
      type Name = Parameters<typeof upsertScheduler<'search-index'>>[1];
      expectTypeOf<Name>().toEqualTypeOf<'reindex-all'>();
      type Maint = Parameters<typeof upsertScheduler<'maintenance'>>[1];
      expectTypeOf<Maint>().toEqualTypeOf<
        'purge-trash' | 'retention' | 'clean-uploads' | 'blob-gc'
      >();
    });

    it('enqueueReindexAll thêm reindex-all với jobId và tuỳ chọn gọn', async () => {
      const q = fakeQueue();
      await enqueueReindexAll(q, 'reindex-boot');
      expect(q.add).toHaveBeenCalledWith(
        'reindex-all',
        {},
        { jobId: 'reindex-boot', removeOnComplete: true, removeOnFail: 20 },
      );
    });
  });
});
