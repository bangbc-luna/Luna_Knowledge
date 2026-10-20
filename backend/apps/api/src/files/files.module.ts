import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { NodeEventsService } from './node-events.service.js';
import { StorageService } from './storage.service.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

/** Upload multipart, xem trước, tải về, phiên bản file, sự kiện xử lý (Phase 3). */
@Module({
  imports: [ContentModule],
  controllers: [UploadsController, FilesController],
  providers: [StorageService, NodeEventsService, UploadsService, FilesService],
})
export class FilesModule {}
