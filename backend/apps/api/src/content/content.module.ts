import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { ContentAccessService } from './content-access.service.js';
import { LibraryController } from './library.controller.js';
import { LibraryService } from './library.service.js';
import { NodeDtoService } from './node-dto.service.js';
import { NodeTree } from './node-tree.service.js';
import { NodesController } from './nodes.controller.js';
import { NodesService } from './nodes.service.js';
import { SharesController } from './shares.controller.js';
import { SharesService } from './shares.service.js';
import { TrashController } from './trash.controller.js';
import { TrashService } from './trash.service.js';

@Module({
  imports: [UsersModule],
  controllers: [NodesController, TrashController, SharesController, LibraryController],
  providers: [
    ContentAccessService,
    NodeDtoService,
    NodeTree,
    NodesService,
    TrashService,
    SharesService,
    LibraryService,
  ],
  exports: [ContentAccessService, NodeDtoService, NodeTree, NodesService],
})
export class ContentModule {}
