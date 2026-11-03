import {
  LiveKitMeetingMedia,
  MEETING_ENDED_HOOK,
  MEETING_MEDIA,
  meetingEndedHook,
} from '@luna/meetings';
import { type JobQueue, QUEUES } from '@luna/shared';
import { getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentModule } from '../content/content.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { UsersModule } from '../users/users.module.js';
import { MeetingAccess } from './meeting-access.service.js';
import { MeetingChatService } from './meeting-chat.service.js';
import { MeetingRoomService } from './meeting-room.service.js';
import { MeetingWebhookController } from './meeting-webhook.controller.js';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';
import { MinutesController } from './minutes/minutes.controller.js';
import { MinutesQueueService } from './minutes/minutes-queue.service.js';
import { MinutesService } from './minutes/minutes.service.js';

@Module({
  imports: [ContentModule, DocumentsModule, UsersModule],
  controllers: [MeetingsController, MeetingWebhookController, MinutesController],
  providers: [
    MeetingAccess,
    MeetingsService,
    MeetingRoomService,
    MeetingChatService,
    MinutesQueueService,
    MinutesService,
    {
      provide: MEETING_ENDED_HOOK,
      inject: [PrismaService, getQueueToken(QUEUES.MEETING_MINUTES), APP_CONFIG],
      useFactory: (prisma: PrismaService, queue: JobQueue<'meeting-minutes'>, config: AppConfig) =>
        meetingEndedHook({
          db: prisma.client,
          queue,
          audioWaitSec: config.MEETING_AUDIO_WAIT_SEC,
        }),
    },
    {
      provide: MEETING_MEDIA,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LiveKitMeetingMedia(config),
    },
  ],
  exports: [MeetingAccess, MeetingChatService, MEETING_MEDIA, MEETING_ENDED_HOOK],
})
export class MeetingsModule {}
