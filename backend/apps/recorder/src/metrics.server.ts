import { createServer, type Server } from 'node:http';
import { createMetricsRegistry, listenHost, metricsAllowed } from '@luna/shared';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { RECORDER_CONFIG, type RecorderConfig } from './config.js';

@Injectable()
export class MetricsServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsServer.name);
  private readonly registry = createMetricsRegistry('recorder');
  private server?: Server;

  constructor(@Inject(RECORDER_CONFIG) private readonly config: RecorderConfig) {}

  onModuleInit() {
    if (!this.config.RECORDER_METRICS_PORT) return;
    this.server = createServer(async (req, res) => {
      if (req.url === '/health') return void res.writeHead(200).end('ok');
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
    this.server.listen(this.config.RECORDER_METRICS_PORT, listenHost(this.config));
  }

  async onModuleDestroy() {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
