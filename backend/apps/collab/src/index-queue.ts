import { SEARCH_JOBS } from '@luna/shared';
import type { Queue } from 'bullmq';

export async function enqueueIndexNode(
  queue: Queue,
  nodeId: string,
  delayMs: number,
): Promise<void> {
  await queue.add(
    SEARCH_JOBS.INDEX_NODE,
    { nodeId },
    {
      delay: delayMs,
      deduplication: { id: `index-node-${nodeId}`, ttl: delayMs },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}
