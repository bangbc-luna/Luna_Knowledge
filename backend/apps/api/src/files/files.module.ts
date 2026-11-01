import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { NodeEventsService } from './node-events.service.js';
import { TranscodeQueueService } from './transcode-queue.service.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({
  imports: [ContentModule],
  controllers: [UploadsController, FilesController],
  providers: [NodeEventsService, UploadsService, FilesService, TranscodeQueueService],
  exports: [NodeEventsService, TranscodeQueueService],
})
export class FilesModule {}
