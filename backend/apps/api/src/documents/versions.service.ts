import { createDocumentVersion } from '@luna/db';
import { type DocJSON, jsonToHTML, jsonToText, stateToJSON, wordCount } from '@luna/editor';
import { Injectable } from '@nestjs/common';
import { diffWordsWithSpace } from 'diff';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CollabClient } from './collab-client.service.js';
import { DocumentsService } from './documents.service.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const summarySelect = {
  id: true,
  versionNo: true,
  name: true,
  isAuto: true,
  restoredFromId: true,
  wordCount: true,
  wordsAdded: true,
  wordsRemoved: true,
  createdAt: true,
  createdBy: { select: userSummary },
} as const;

type SummaryRow = {
  id: string;
  versionNo: number;
  name: string | null;
  isAuto: boolean;
  restoredFromId: string | null;
  wordCount: number;
  wordsAdded: number;
  wordsRemoved: number;
  createdAt: Date;
  createdBy: { id: string; email: string; name: string; avatarUrl: string | null } | null;
};

@Injectable()
export class VersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly collab: CollabClient,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, nodeId: string) {
    await this.documents.requireDocument(user, nodeId, 'VIEWER');
    const rows = await this.prisma.client.documentVersion.findMany({
      where: { nodeId },
      select: summarySelect,
      orderBy: { versionNo: 'desc' },
    });
    return this.withRestoredFrom(rows);
  }

  async createNamed(user: AuthenticatedUser, nodeId: string, name: string, ctx: RequestContext) {
    const node = await this.documents.requireDocument(user, nodeId, 'EDITOR');
    const state = await this.collab.snapshot(nodeId, node.workspaceId, user.id);
    const version = await this.save(nodeId, state, { name, createdById: user.id });
    await this.audit.log({
      actorId: user.id,
      action: 'document.version_create',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, versionNo: version.versionNo, versionName: name },
      ctx,
    });
    return (await this.withRestoredFrom([version]))[0]!;
  }

  async get(user: AuthenticatedUser, nodeId: string, versionId: string) {
    await this.documents.requireDocument(user, nodeId, 'VIEWER');
    const v = await this.find(nodeId, versionId);
    const [summary] = await this.withRestoredFrom([v]);
    return { ...summary!, contentJson: v.contentJson, html: jsonToHTML(v.contentJson as DocJSON) };
  }

  async diff(user: AuthenticatedUser, nodeId: string, versionId: string, withId: string) {
    const node = await this.documents.requireDocument(user, nodeId, 'VIEWER');
    const from = await this.find(nodeId, versionId);
    let toText: string;
    let to: { id: string; versionNo: number | null };
    if (withId === 'current') {
      const state = await this.collab.snapshot(nodeId, node.workspaceId, user.id);
      toText = jsonToText(stateToJSON(state));
      to = { id: 'current', versionNo: null };
    } else {
      const other = await this.find(nodeId, withId);
      toText = other.contentText;
      to = { id: other.id, versionNo: other.versionNo };
    }
    const parts = diffWordsWithSpace(from.contentText, toText).map((p) => ({
      type: p.added ? ('added' as const) : p.removed ? ('removed' as const) : ('same' as const),
      text: p.value,
    }));
    const count = (t: 'added' | 'removed') =>
      parts.filter((p) => p.type === t).reduce((n, p) => n + wordCount(p.text), 0);
    return {
      from: { id: from.id, versionNo: from.versionNo },
      to,
      stats: { added: count('added'), removed: count('removed') },
      parts,
    };
  }

  async restore(user: AuthenticatedUser, nodeId: string, versionId: string, ctx: RequestContext) {
    const node = await this.documents.requireDocument(user, nodeId, 'EDITOR');
    const source = await this.find(nodeId, versionId);
    const state = await this.collab.replace(
      nodeId,
      node.workspaceId,
      user.id,
      source.contentJson as DocJSON,
    );
    const version = await this.save(nodeId, state, {
      name: `Khôi phục từ phiên bản ${source.versionNo}`,
      createdById: user.id,
      restoredFromId: source.id,
    });
    await this.audit.log({
      actorId: user.id,
      action: 'document.version_restore',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: {
        name: node.name,
        fromVersionNo: source.versionNo,
        newVersionNo: version.versionNo,
      },
      ctx,
    });
    return (await this.withRestoredFrom([version]))[0]!;
  }

  private async save(
    nodeId: string,
    state: Uint8Array,
    opts: { name: string; createdById: string; restoredFromId?: string },
  ): Promise<SummaryRow> {
    const json = stateToJSON(state);
    const text = jsonToText(json);
    const created = await createDocumentVersion(this.prisma.client, {
      nodeId,
      yjsSnapshot: state,
      contentJson: json as object,
      contentText: text,
      wordCount: wordCount(text),
      name: opts.name,
      createdById: opts.createdById,
      restoredFromId: opts.restoredFromId ?? null,
    });
    return this.prisma.client.documentVersion.findUniqueOrThrow({
      where: { id: created.id },
      select: summarySelect,
    });
  }

  private async find(nodeId: string, versionId: string) {
    const v = await this.prisma.client.documentVersion.findFirst({
      where: { id: versionId, nodeId },
      include: { createdBy: { select: userSummary } },
    });
    if (!v) throw AppError.notFound('Version not found');
    return v;
  }

  private async withRestoredFrom(rows: SummaryRow[]) {
    const ids = rows.map((r) => r.restoredFromId).filter((id): id is string => Boolean(id));
    const sources = ids.length
      ? await this.prisma.client.documentVersion.findMany({
          where: { id: { in: ids } },
          select: { id: true, versionNo: true },
        })
      : [];
    const byId = new Map(sources.map((s) => [s.id, s]));
    return rows.map(({ restoredFromId, ...r }) => ({
      ...r,
      restoredFrom: restoredFromId ? (byId.get(restoredFromId) ?? null) : null,
    }));
  }
}
