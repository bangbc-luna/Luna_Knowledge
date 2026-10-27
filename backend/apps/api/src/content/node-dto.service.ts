import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { ContentAccessService, type NodeAccess } from './content-access.service.js';
import type { NodeDto } from './nodes.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;

@Injectable()
export class NodeDtoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
  ) {}

  async build(
    userId: string,
    nodeIds: string[],
    known?: Map<string, NodeAccess>,
  ): Promise<NodeDto[]> {
    if (nodeIds.length === 0) return [];
    const [rows, accessMap] = await Promise.all([
      this.prisma.client.node.findMany({
        where: { id: { in: nodeIds } },
        include: {
          createdBy: { select: userSummary },
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          favorites: { where: { userId }, select: { userId: true } },
          _count: { select: { children: { where: { deletedAt: null } } } },
          file: {
            select: {
              currentVersion: { select: { original: { select: { sizeBytes: true, mime: true } } } },
            },
          },
        },
      }),
      known ?? this.access.resolveMany(userId, nodeIds),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return nodeIds.flatMap((id) => {
      const n = byId.get(id);
      const role = accessMap.get(id)?.role;
      if (!n || !role) return [];
      return [
        {
          id: n.id,
          workspaceId: n.workspaceId,
          parentId: n.parentId,
          type: n.type,
          section: n.section,
          name: n.name,
          description: n.description,
          status: n.status,
          createdBy: n.createdBy,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          myRole: role,
          isFavorite: n.favorites.length > 0,
          tags: n.tags.map((t) => t.tag).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
          childCount: n.type === 'FOLDER' ? n._count.children : null,
          size: n.file?.currentVersion ? Number(n.file.currentVersion.original.sizeBytes) : null,
          mime: n.file?.currentVersion?.original.mime ?? null,
        },
      ];
    });
  }

  async one(userId: string, nodeId: string): Promise<NodeDto> {
    const [dto] = await this.build(userId, [nodeId]);
    return dto!;
  }
}
