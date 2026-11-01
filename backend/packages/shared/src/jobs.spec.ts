import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  enqueueFileJob,
  enqueueIndexNode,
  enqueueTranscode,
  type JobName,
  transcodeJobOptions,
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
  });
});
