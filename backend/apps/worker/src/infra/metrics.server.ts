import { createServer, type Server } from 'node:http';
import { createMetricsRegistry, listenHost, metricsAllowed, QUEUES } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Gauge } from 'prom-client';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';

const STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;

@Injectable()
export class MetricsServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsServer.name);
  private readonly registry = createMetricsRegistry('worker');
  private server?: Server;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @InjectQueue(QUEUES.SYSTEM) system: Queue,
    @InjectQueue(QUEUES.MAINTENANCE) maintenance: Queue,
    @InjectQueue(QUEUES.FILE_PROCESS) files: Queue,
    @InjectQueue(QUEUES.VIDEO_TRANSCODE) videos: Queue,
    @InjectQueue(QUEUES.SEARCH_INDEX) search: Queue,
  ) {
    const queues = [system, maintenance, files, videos, search];
    new Gauge({
      name: 'queue_jobs',
      help: 'BullMQ jobs by queue and state',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
      async collect() {
        for (const q of queues) {
          const counts = await q.getJobCounts(...STATES).catch(() => null);
          if (!counts) continue;
          for (const s of STATES) this.set({ queue: q.name, state: s }, counts[s] ?? 0);
        }
      },
    });
  }

  onModuleInit() {
    if (!this.config.WORKER_METRICS_PORT) return;
    this.server = createServer(async (req, res) => {
      if (req.url !== '/metrics') return void res.writeHead(404).end();
      if (
        !metricsAllowed(
          req.socket.remoteAddress,
          req.headers.authorization,
          this.config.METRICS_TOKEN,
        )
      ) {
        return void res.writeHead(404).end();
      }
      res.writeHead(200, { 'Content-Type': this.registry.contentType });
      res.end(await this.registry.metrics());
    });
    this.server.on('error', (err) => this.logger.warn({ err }, 'Metrics server failed'));
    this.server.listen(this.config.WORKER_METRICS_PORT, listenHost(this.config));
  }

  async onModuleDestroy() {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
