import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { LunaThrottlerGuard } from '../common/security/throttle.guard.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { REDIS } from '../infra/redis/redis.token.js';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { GOOGLE_IDENTITY } from './google/google-identity.js';
import { OpenIdGoogleIdentity } from './google/openid-google-identity.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, REDIS],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: (ctx) => {
              const req = ctx.switchToHttp().getRequest<{ auth?: unknown }>();
              return req.auth ? config.RATE_LIMIT_USER_PER_MIN : config.RATE_LIMIT_ANON_PER_MIN;
            },
          },
        ],
        storage: new ThrottlerStorageRedisService(redis),
        errorMessage: 'Too many requests, please slow down',
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    { provide: GOOGLE_IDENTITY, useClass: OpenIdGoogleIdentity },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: LunaThrottlerGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
