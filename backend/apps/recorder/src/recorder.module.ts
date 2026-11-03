import { LiveKitMeetingMedia, MEETING_MEDIA } from '@luna/meetings';
import { ObjectStore, QUEUES } from '@luna/shared';
import { BullModule } from '@nestjs/bullmq';
import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import {
  loadRecorderConfig,
  RECORDER_CONFIG,
  type RecorderConfig,
  redisConnection,
} from './config.js';
import { MetricsServer } from './metrics.server.js';
import { PrismaService } from './prisma.provider.js';
import { RecorderProcessor } from './recorder.processor.js';
import { RECORDER_HOOKS, RecordingSession } from './recording-session.js';

@Global()
@Module({
  providers: [{ provide: RECORDER_CONFIG, useFactory: () => loadRecorderConfig() }],
  exports: [RECORDER_CONFIG],
})
class RecorderConfigModule {}

@Module({
  imports: [
    RecorderConfigModule,
    LoggerModule.forRootAsync({
      inject: [RECORDER_CONFIG],
      useFactory: (config: RecorderConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          transport:
            config.NODE_ENV === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
                }
              : undefined,
        },
      }),
    }),
    BullModule.forRootAsync({
      inject: [RECORDER_CONFIG],
      useFactory: (config: RecorderConfig) => ({
        connection: redisConnection(config.REDIS_URL),
        prefix: 'luna',
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.MEETING_RECORDER }, { name: QUEUES.MEETING_MINUTES }),
  ],
  providers: [
    PrismaService,
    {
      provide: ObjectStore,
      inject: [RECORDER_CONFIG],
      useFactory: (c: RecorderConfig) => new ObjectStore(c),
    },
    {
      provide: MEETING_MEDIA,
      inject: [RECORDER_CONFIG],
      useFactory: (c: RecorderConfig) => new LiveKitMeetingMedia(c),
    },
    { provide: RECORDER_HOOKS, useValue: {} },
    RecordingSession,
    RecorderProcessor,
    MetricsServer,
  ],
})
export class RecorderModule implements OnApplicationShutdown {
  constructor(private readonly store: ObjectStore) {}

  onApplicationShutdown() {
    this.store.destroy();
  }
}
