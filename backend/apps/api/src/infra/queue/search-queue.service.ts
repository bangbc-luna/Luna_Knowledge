import { QUEUES, SEARCH_JOBS } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

const OPTS = { removeOnComplete: true, removeOnFail: 100 };

@Injectable()
export class SearchQueueService {
  private readonly logger = new Logger(SearchQueueService.name);

  constructor(@InjectQueue(QUEUES.SEARCH_INDEX) private readonly queue: Queue) {}

  node(...nodeIds: string[]) {
    return this.add(nodeIds.map((nodeId) => ({ name: SEARCH_JOBS.INDEX_NODE, data: { nodeId } })));
  }

  tree(nodeId: string) {
    return this.add([{ name: SEARCH_JOBS.INDEX_TREE, data: { nodeId } }]);
  }

  dropWorkspace(workspaceId: string) {
    return this.add([{ name: SEARCH_JOBS.DROP_WORKSPACE, data: { workspaceId } }]);
  }

  reindexAll() {
    return this.add([
      { name: SEARCH_JOBS.REINDEX_ALL, data: {}, opts: { ...OPTS, jobId: 'reindex-all-manual' } },
    ]);
  }

  private async add(jobs: Array<{ name: string; data: object; opts?: object }>) {
    if (!jobs.length) return;
    try {
      await this.queue.addBulk(jobs.map((j) => ({ ...j, opts: j.opts ?? OPTS })));
    } catch (err) {
      this.logger.warn({ err }, 'Could not enqueue search indexing');
    }
  }
}
