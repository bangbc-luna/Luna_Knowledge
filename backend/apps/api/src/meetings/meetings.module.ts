import { LiveKitMeetingMedia, MEETING_MEDIA } from '@luna/meetings';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentModule } from '../content/content.module.js';
import { UsersModule } from '../users/users.module.js';
import { MeetingAccess } from './meeting-access.service.js';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';

@Module({
  imports: [ContentModule, UsersModule],
  controllers: [MeetingsController],
  providers: [
    MeetingAccess,
    MeetingsService,
    {
      provide: MEETING_MEDIA,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LiveKitMeetingMedia(config),
    },
  ],
  exports: [MeetingAccess, MEETING_MEDIA],
})
export class MeetingsModule {}
