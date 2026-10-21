import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { FilesModule } from '../files/files.module.js';
import { AdminVideosService } from './admin-videos.service.js';
import {
  AdminVideoDownloadController,
  AdminVideosController,
  VideosController,
} from './videos.controller.js';
import { VideosService } from './videos.service.js';

@Module({
  imports: [ContentModule, FilesModule],
  controllers: [VideosController, AdminVideosController, AdminVideoDownloadController],
  providers: [VideosService, AdminVideosService],
})
export class VideosModule {}
