import {
  aclForUser,
  aclForWorkspace,
  createSearchClient,
  foldVietnamese,
  SEARCH_CONTENT_MAX,
  SEARCH_INDEX,
  type SearchDoc,
} from '@luna/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentAccessService } from '../content/content-access.service.js';
import { NodeDtoService } from '../content/node-dto.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { type Match, snippetAround, splitMatches } from './highlight.js';
import type { SearchQuery } from './search.schemas.js';

type Positions = Partial<Record<'nameAscii' | 'contentAscii' | 'tagsAscii', Match[]>>;

const quote = (v: string) => `"${v.replace(/["\\]/g, '')}"`;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly dto: NodeDtoService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.client = createSearchClient(config.MEILI_URL, config.MEILI_MASTER_KEY);
  }

  async search(user: AuthenticatedUser, q: SearchQuery) {
    const folded = foldVietnamese(q.q).trim();
    if (!folded) throw AppError.validation('Enter something to search for');

    const memberships = await this.prisma.client.workspaceMember.findMany({
      where: { userId: user.id, workspace: { deletedAt: null } },
      select: { workspaceId: true },
    });
    const acl = [...memberships.map((m) => aclForWorkspace(m.workspaceId)), aclForUser(user.id)];
    const filter = [`acl IN [${acl.map(quote).join(', ')}]`];
    if (q.workspaceId) filter.push(`workspaceId = ${quote(q.workspaceId)}`);
    if (q.section) filter.push(`section = ${quote(q.section)}`);
    if (q.type) filter.push(`type = ${quote(q.type)}`);
    if (q.createdBy) filter.push(`createdById = ${quote(q.createdBy)}`);
    for (const tagId of q.tagIds) filter.push(`tagIds = ${quote(tagId)}`);
    if (q.from) filter.push(`updatedAt >= ${Math.floor(new Date(q.from).getTime() / 1000)}`);
    if (q.to) filter.push(`updatedAt <= ${Math.floor(new Date(q.to).getTime() / 1000)}`);

    const offset = q.cursor ? Number(q.cursor) : 0;
    let res;
    try {
      res = await this.client.index<SearchDoc>(SEARCH_INDEX).search(folded, {
        filter,
        offset,
        limit: q.limit,
        attributesToRetrieve: ['id'],
        showMatchesPosition: true,
      });
    } catch (err) {
      this.logger.error({ err }, 'Search backend failed');
      throw AppError.unavailable('Search is temporarily unavailable');
    }

    const hits = res.hits as Array<{ id: string; _matchesPosition?: Positions }>;
    const ids = hits.map((h) => h.id);
    const accessMap = await this.access.resolveMany(user.id, ids);
    const allowed = ids.filter((id) => {
      const a = accessMap.get(id);
      return !!a?.role && !a.deletedAt;
    });
    const [dtos, texts, paths, workspaces] = await Promise.all([
      this.dto.build(user.id, allowed),
      this.contentTexts(allowed),
      this.paths(allowed),
      this.prisma.client.workspace.findMany({
        where: { id: { in: [...new Set(allowed.map((id) => accessMap.get(id)!.workspaceId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const byId = new Map(dtos.map((d) => [d.id, d]));
    const wsById = new Map(workspaces.map((w) => [w.id, w]));

    const items = hits.flatMap((h) => {
      const node = byId.get(h.id);
      if (!node) return [];
      const pos = h._matchesPosition ?? {};
      const nameMatches = pos.nameAscii ?? [];
      const contentMatches = pos.contentAscii ?? [];
      const text = texts.get(h.id);
      const snippet =
        contentMatches.length && text ? snippetAround([...text], contentMatches) : null;
      const isMember = accessMap.get(h.id)!.isMember;
      return [
        {
          node,
          workspace: wsById.get(node.workspaceId)!,
          path: isMember ? (paths.get(h.id) ?? []) : [],
          name: splitMatches([...node.name.normalize('NFC')], nameMatches),
          snippet,
          matchedIn: nameMatches.length
            ? ('name' as const)
            : contentMatches.length
              ? ('content' as const)
              : ('tags' as const),
        },
      ];
    });
    const total = res.estimatedTotalHits ?? items.length;
    const next = offset + q.limit;
    return {
      items,
      total,
      nextCursor: next < total && hits.length === q.limit ? String(next) : null,
    };
  }

  private async contentTexts(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const rows = await this.prisma.client.$queryRaw<{ id: string; content: string | null }[]>`
      SELECT n.id, COALESCE(d.content_text, f.extracted_text) AS content
        FROM nodes n
        LEFT JOIN documents d ON d.node_id = n.id
        LEFT JOIN files f ON f.node_id = n.id
       WHERE n.id = ANY(${ids}::uuid[])`;
    return new Map(
      rows
        .filter((r) => r.content)
        .map((r) => [r.id, r.content!.normalize('NFC').slice(0, SEARCH_CONTENT_MAX)]),
    );
  }

  private async paths(ids: string[]) {
    if (!ids.length) return new Map<string, string[]>();
    const rows = await this.prisma.client.$queryRaw<{ id: string; names: string[] | null }[]>`
      SELECT n.id,
             (SELECT array_agg(a.name ORDER BY nlevel(a.path))
                FROM nodes a WHERE a.path @> n.path AND a.id <> n.id) AS names
        FROM nodes n
       WHERE n.id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.names ?? []]));
  }
}
