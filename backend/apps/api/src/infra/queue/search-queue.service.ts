import { type JobQueue, QUEUES, SEARCH_JOB_OPTS } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

type Jobs = Parameters<JobQueue<'search-index'>['addBulk']>[0];

@Injectable()
export class SearchQueueService {
  private readonly logger = new Logger(SearchQueueService.name);

  constructor(@InjectQueue(QUEUES.SEARCH_INDEX) private readonly queue: JobQueue<'search-index'>) {}

  node(...nodeIds: string[]) {
    return this.add(nodeIds.map((nodeId) => ({ name: 'index-node' as const, data: { nodeId } })));
  }

  tree(nodeId: string) {
    return this.add([{ name: 'index-tree', data: { nodeId } }]);
  }

  dropWorkspace(workspaceId: string) {
    return this.add([{ name: 'drop-workspace', data: { workspaceId } }]);
  }

  reindexAll() {
    return this.add([
      {
        name: 'reindex-all',
        data: {},
        opts: { ...SEARCH_JOB_OPTS, jobId: 'reindex-all-manual' },
      },
    ]);
  }

  private async add(jobs: Jobs) {
    if (!jobs.length) return;
    try {
      await this.queue.addBulk(jobs.map((j) => ({ ...j, opts: j.opts ?? SEARCH_JOB_OPTS })));
    } catch (err) {
      this.logger.warn({ err }, 'Could not enqueue search indexing');
    }
  }
}
