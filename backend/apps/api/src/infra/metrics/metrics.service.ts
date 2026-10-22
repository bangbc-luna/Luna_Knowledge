import { createMetricsRegistry } from '@luna/shared';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Counter, Histogram } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = createMetricsRegistry('api');
  private readonly duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by route and status',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  private readonly rateLimited = new Counter({
    name: 'http_rate_limited_total',
    help: 'Requests rejected by the rate limiter',
    registers: [this.registry],
  });

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const end = this.duration.startTimer();
      res.on('finish', () => {
        const route = req.route?.path ? `${req.baseUrl}${req.route.path as string}` : 'unmatched';
        end({ method: req.method, route, status: String(res.statusCode) });
        if (res.statusCode === 429) this.rateLimited.inc();
      });
      next();
    };
  }
}
