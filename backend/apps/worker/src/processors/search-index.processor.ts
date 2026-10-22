import {
  createSearchClient,
  loadSearchDocs,
  QUEUES,
  SEARCH_INDEX,
  SEARCH_INDEX_BUILD,
  SEARCH_JOBS,
  type SearchDoc,
  searchSettings,
} from '@luna/shared';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';
import { PrismaService } from '../infra/prisma.provider.js';

const BATCH = 500;

@Processor(QUEUES.SEARCH_INDEX, { concurrency: 2 })
export class SearchIndexProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchIndexProcessor.name);
  private readonly client;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKER_CONFIG) config: WorkerConfig,
    @InjectQueue(QUEUES.SEARCH_INDEX) private readonly queue: Queue,
  ) {
    super();
    this.client = createSearchClient(config.MEILI_URL, config.MEILI_MASTER_KEY);
  }

  async onApplicationBootstrap() {
    try {
      await this.ensureIndex(SEARCH_INDEX);
      const stats = await this.client.index(SEARCH_INDEX).getStats();
      if (!stats.numberOfDocuments) {
        await this.queue.add(
          SEARCH_JOBS.REINDEX_ALL,
          {},
          { jobId: 'reindex-boot', removeOnComplete: true, removeOnFail: 20 },
        );
      }
      await this.queue.upsertJobScheduler(
        SEARCH_JOBS.REINDEX_ALL,
        { pattern: '30 3 * * *', tz: 'Asia/Ho_Chi_Minh' },
        { name: SEARCH_JOBS.REINDEX_ALL, opts: { removeOnComplete: 30, removeOnFail: 100 } },
      );
    } catch (err) {
      this.logger.error({ err }, 'Search index bootstrap failed');
    }
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case SEARCH_JOBS.INDEX_NODE:
        return this.indexIds([(job.data as { nodeId: string }).nodeId]);
      case SEARCH_JOBS.INDEX_TREE:
        return this.indexTree((job.data as { nodeId: string }).nodeId);
      case SEARCH_JOBS.DROP_WORKSPACE: {
        const { workspaceId } = job.data as { workspaceId: string };
        await this.client
          .index(SEARCH_INDEX)
          .deleteDocuments({ filter: `workspaceId = "${workspaceId}"` })
          .waitTask();
        return { dropped: workspaceId };
      }
      case SEARCH_JOBS.REINDEX_ALL:
        return this.reindexAll();
      default:
        return { skipped: job.name };
    }
  }

  private async ensureIndex(uid: string) {
    const exists = await this.client
      .getIndex(uid)
      .then(() => true)
      .catch(() => false);
    if (!exists) await this.client.createIndex(uid, { primaryKey: 'id' }).waitTask();
    await this.client.index(uid).updateSettings(searchSettings).waitTask();
  }

  private async indexIds(ids: string[], uid = SEARCH_INDEX) {
    if (!ids.length) return { indexed: 0, removed: 0 };
    const docs = await loadSearchDocs(this.prisma.client, ids);
    const found = new Set(docs.map((d) => d.id));
    const gone = ids.filter((id) => !found.has(id));
    const index = this.client.index<SearchDoc>(uid);
    if (docs.length) await index.addDocuments(docs).waitTask();
    if (gone.length && uid === SEARCH_INDEX) await index.deleteDocuments(gone).waitTask();
    return { indexed: docs.length, removed: gone.length };
  }

  private async indexTree(rootId: string) {
    const rows = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT n.id FROM nodes n
       WHERE n.path <@ (SELECT path FROM nodes WHERE id = ${rootId}::uuid)`;
    const ids = rows.length ? rows.map((r) => r.id) : [rootId];
    let indexed = 0;
    let removed = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const r = await this.indexIds(ids.slice(i, i + BATCH));
      indexed += r.indexed;
      removed += r.removed;
    }
    return { indexed, removed };
  }

  private async reindexAll() {
    await this.ensureIndex(SEARCH_INDEX);
    await this.client.deleteIndexIfExists(SEARCH_INDEX_BUILD);
    let cursor = '00000000-0000-0000-0000-000000000000';
    let total = 0;
    for (;;) {
      const rows = await this.prisma.client.$queryRaw<{ id: string }[]>`
        SELECT id FROM nodes WHERE id > ${cursor}::uuid ORDER BY id LIMIT ${BATCH}`;
      if (!rows.length) break;
      const r = await this.indexIds(rows.map((x) => x.id));
      total += r.indexed;
      cursor = rows[rows.length - 1]!.id;
    }
    const orphans = await this.orphanIds();
    if (orphans.length) await this.client.index(SEARCH_INDEX).deleteDocuments(orphans).waitTask();
    this.logger.log(`Reindexed ${total} item(s), removed ${orphans.length} orphan(s)`);
    return { total, orphans: orphans.length };
  }

  private async orphanIds() {
    const index = this.client.index<SearchDoc>(SEARCH_INDEX);
    const orphans: string[] = [];
    for (let offset = 0; ; offset += BATCH) {
      const page = await index.getDocuments({ fields: ['id'], limit: BATCH, offset });
      const ids = page.results.map((d) => d.id);
      if (!ids.length) break;
      const existing = await this.prisma.client.node.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const found = new Set(existing.map((n) => n.id));
      orphans.push(...ids.filter((id) => !found.has(id)));
      if (ids.length < BATCH) break;
    }
    return orphans;
  }
}
