import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator.js';
import { InfraHealthIndicators } from './infra.health.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly infra: InfraHealthIndicators,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness: kiểm tra PostgreSQL, Redis, object storage' })
  check() {
    return this.health.check([
      () => this.infra.database(),
      () => this.infra.redisPing(),
      () => this.infra.storage(),
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness: process còn chạy (không kiểm tra phụ thuộc)' })
  live() {
    return { status: 'ok' };
  }
}
