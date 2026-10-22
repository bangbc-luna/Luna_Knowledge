import { metricsAllowed } from '@luna/shared';
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { MetricsService } from './metrics.service.js';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  async scrape(@Req() req: Request, @Res() res: Response) {
    if (!metricsAllowed(req.ip, req.headers.authorization, this.config.METRICS_TOKEN)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
