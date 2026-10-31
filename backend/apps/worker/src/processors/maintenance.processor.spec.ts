import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '../config/worker-config.js';
import type { PrismaService } from '../infra/prisma.provider.js';
import type { StorageService } from '../infra/storage.provider.js';
import { MaintenanceProcessor } from './maintenance.processor.js';

const dbDown = new Error('db down');
const failing = () => Promise.reject(dbDown);

const failingPrisma = {
  client: {
    $queryRaw: failing,
    $executeRaw: failing,
    $transaction: failing,
    workspace: { findMany: failing },
    blobGc: { findMany: failing },
  },
} as unknown as PrismaService;

const makeProcessor = () =>
  new MaintenanceProcessor(
    failingPrisma,
    {} as StorageService,
    {} as Queue,
    { WORKSPACE_PURGE_DAYS: 30, AUTO_VERSION_THIN_DAYS: 30 } as WorkerConfig,
  );

describe('MaintenanceProcessor retention', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both the retention error and the garbage collection error when both fail', async () => {
    const processor = makeProcessor();
    const gcError = new Error('storage down');
    vi.spyOn(processor, 'collectGarbage').mockRejectedValue(gcError);
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const err = await processor.process({ name: 'retention' } as Job).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AggregateError);
    const { errors } = err as AggregateError;
    expect(errors).toHaveLength(2);
    expect((errors[0] as Error).name).toBe('RetentionError');
    expect(errors[1]).toBe(gcError);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ err: errors[0] }),
      expect.stringContaining('Retention failed'),
    );
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ err: gcError }),
      expect.stringContaining('Blob GC failed'),
    );
  });

  it('rethrows the retention error unchanged when garbage collection succeeds', async () => {
    const processor = makeProcessor();
    vi.spyOn(processor, 'collectGarbage').mockResolvedValue({ deleted: 0, failed: 0 });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const err = await processor.process({ name: 'retention' } as Job).catch((e: unknown) => e);

    expect((err as Error).name).toBe('RetentionError');
  });
});
