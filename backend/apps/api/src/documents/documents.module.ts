import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { FilesModule } from '../files/files.module.js';
import { CollabClient } from './collab-client.service.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { VersionsService } from './versions.service.js';

@Module({
  imports: [ContentModule, FilesModule],
  controllers: [DocumentsController, CommentsController],
  providers: [DocumentsService, VersionsService, CommentsService, CollabClient],
})
export class DocumentsModule {}
