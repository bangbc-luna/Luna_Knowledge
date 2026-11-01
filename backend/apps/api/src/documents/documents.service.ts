import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import {
  type DocJSON,
  emptyDoc,
  htmlToJSON,
  isLatexJSON,
  jsonToHTML,
  jsonToMarkdown,
  jsonToState,
  jsonToText,
  LATEX_TEMPLATE,
  latexJSON,
  stateToJSON,
  wordCount,
} from '@luna/editor';
import { COLLAB_TOKEN_AUDIENCE, collabDocumentName, ObjectStore } from '@luna/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SignJWT } from 'jose';
import mammoth from 'mammoth';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import {
  ContentAccessService,
  AS_DOCUMENT,
  AS_FILE_ONLY,
} from '../content/content-access.service.js';
import { NodeDtoService } from '../content/node-dto.service.js';
import { nameKey, suggestName } from '../content/node-names.js';
import { NodesService } from '../content/nodes.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import {
  DOCX_MIME,
  DocumentAssets,
  remapAssets,
  type UploadedAsset,
} from './document-assets.service.js';
import { CollabClient } from './collab-client.service.js';
import {
  DOCX_IMPORT_MAX_BYTES,
  DOCX_UNZIPPED_MAX_BYTES,
  measureUnzippedBytes,
} from './docx-limits.js';
import type { CopyDocumentBody, CreateDocumentBody } from './documents.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const COLLAB_TOKEN_TTL_SEC = 300;
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly nodes: NodesService,
    private readonly dto: NodeDtoService,
    private readonly store: ObjectStore,
    private readonly assets: DocumentAssets,
    private readonly audit: AuditService,
    private readonly search: SearchQueueService,
    private readonly collab: CollabClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateDocumentBody,
    ctx: RequestContext,
  ) {
    const parentId = body.parentId ?? null;
    await this.nodes.requireContainer(user, workspaceId, parentId, 'DOCS');
    const nodeId = await this.createNode(
      user,
      workspaceId,
      parentId,
      body.name,
      body.format === 'LATEX' ? latexJSON(LATEX_TEMPLATE) : emptyDoc(),
    );
    await this.audit.log({
      actorId: user.id,
      action: 'node.create',
      targetType: 'node',
      targetId: nodeId,
      workspaceId,
      metadata: { type: 'DOCUMENT', format: body.format, name: body.name, parentId },
      ctx,
    });
    await this.search.node(nodeId);
    return this.detail(user, nodeId);
  }

  async copy(user: AuthenticatedUser, nodeId: string, body: CopyDocumentBody, ctx: RequestContext) {
    const source = await this.access.requireNode(user, nodeId, 'VIEWER', AS_DOCUMENT);
    const workspaceId = body.workspaceId ?? source.workspaceId;
    const parentId =
      body.parentId !== undefined
        ? body.parentId
        : workspaceId === source.workspaceId
          ? source.parentId
          : null;
    await this.nodes.requireContainer(user, workspaceId, parentId, 'DOCS');
    const json = await this.latestContent(source.id, source.workspaceId, user.id);
    let name = body.name;
    if (!name) {
      const taken = await this.nodes.siblingKeys(workspaceId, parentId);
      const base = `${source.name} (bản sao)`;
      name = taken.has(nameKey(base)) ? suggestName(base, taken) : base;
    }
    const copyId = await this.createNode(
      user,
      workspaceId,
      parentId,
      name,
      isLatexJSON(json) ? latexJSON('') : emptyDoc(),
    );
    try {
      const assetIds = await this.assets.copyAll(user.id, source.id, copyId);
      await this.writeContent(copyId, remapAssets(json, assetIds));
    } catch (err) {
      await this.prisma.client.node.delete({ where: { id: copyId } }).catch(() => undefined);
      throw err;
    }
    await this.audit.log({
      actorId: user.id,
      action: 'document.copy',
      targetType: 'node',
      targetId: copyId,
      workspaceId,
      metadata: {
        name,
        parentId,
        fromNodeId: source.id,
        fromName: source.name,
        fromWorkspaceId: source.workspaceId,
      },
      ctx,
    });
    await this.search.node(copyId);
    return this.detail(user, copyId);
  }

  async get(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', AS_DOCUMENT);
    await this.audit.logView(user.id, node, ctx);
    await this.prisma.client.recentView.upsert({
      where: { userId_nodeId: { userId: user.id, nodeId } },
      create: { userId: user.id, nodeId },
      update: { viewedAt: new Date() },
    });
    return this.detail(user, nodeId);
  }

  async collabToken(user: AuthenticatedUser, nodeId: string, sessionId: string) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', AS_DOCUMENT);
    const expiresAt = new Date(Date.now() + COLLAB_TOKEN_TTL_SEC * 1000);
    const token = await new SignJWT({ doc: nodeId, name: user.name, sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setAudience(COLLAB_TOKEN_AUDIENCE)
      .setIssuer('luna-api')
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(this.config.COLLAB_TOKEN_SECRET));
    return {
      token,
      documentName: collabDocumentName(nodeId),
      url: this.config.COLLAB_PUBLIC_URL,
      readOnly: node.role === 'VIEWER',
      expiresAt,
      user: { id: user.id, name: user.name },
    };
  }

  async export(
    user: AuthenticatedUser,
    nodeId: string,
    format: 'html' | 'md' | 'tex',
    ctx: RequestContext,
  ) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', AS_DOCUMENT);
    const doc = await this.prisma.client.document.findUnique({ where: { nodeId } });
    const json = await this.assets.withFreshUrls(
      nodeId,
      (doc?.contentJson as DocJSON | null) ?? emptyDoc(),
    );
    await this.audit.log({
      actorId: user.id,
      action: 'document.export',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, format },
      ctx,
    });
    const base = node.name.replace(/\.(md|html?|tex)$/i, '');
    if (format === 'tex') {
      if (!isLatexJSON(json))
        throw AppError.validation('Only LaTeX documents can be exported as .tex');
      return {
        body: json.source,
        mime: 'application/x-tex; charset=utf-8',
        fileName: `${base}.tex`,
      };
    }
    if (format === 'md') {
      return {
        body: jsonToMarkdown(json),
        mime: 'text/markdown; charset=utf-8',
        fileName: `${base}.md`,
      };
    }
    const html = `<!doctype html>\n<html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(node.name)}</title></head><body>\n${jsonToHTML(json)}\n</body></html>\n`;
    return { body: html, mime: 'text/html; charset=utf-8', fileName: `${base}.html` };
  }

  async uploadAsset(user: AuthenticatedUser, nodeId: string, file: UploadedAsset | undefined) {
    await this.access.requireNode(user, nodeId, 'EDITOR', AS_DOCUMENT);
    return this.assets.upload(user.id, nodeId, file);
  }

  async listAssets(user: AuthenticatedUser, nodeId: string) {
    await this.access.requireNode(user, nodeId, 'VIEWER', AS_DOCUMENT);
    return this.assets.list(nodeId);
  }

  async importDocx(user: AuthenticatedUser, fileNodeId: string, ctx: RequestContext) {
    const file = await this.access.requireNode(user, fileNodeId, 'VIEWER', AS_FILE_ONLY);
    await this.nodes.requireContainer(user, file.workspaceId, file.parentId);
    const info = await this.prisma.client.fileInfo.findUnique({
      where: { nodeId: fileNodeId },
      include: { currentVersion: { include: { original: true } } },
    });
    const original = info?.currentVersion?.original;
    if (!original || original.mime !== DOCX_MIME) {
      throw AppError.unsupportedType('Only Word documents (.docx) can be converted');
    }
    const tooLarge = () =>
      AppError.tooLarge('Word documents larger than 20 MB cannot be converted', {
        maxBytes: DOCX_IMPORT_MAX_BYTES,
      });
    if (original.sizeBytes > BigInt(DOCX_IMPORT_MAX_BYTES)) throw tooLarge();
    const { body } = await this.store.getStream(original);
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const c of body) {
      const chunk = Buffer.from(c as Buffer);
      received += chunk.length;
      if (received > DOCX_IMPORT_MAX_BYTES) {
        (body as { destroy?: () => void }).destroy?.();
        throw tooLarge();
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const unzipped = measureUnzippedBytes(buffer, DOCX_UNZIPPED_MAX_BYTES);
    if (unzipped === null) {
      throw AppError.unsupportedType('This Word document could not be converted');
    }
    if (unzipped > DOCX_UNZIPPED_MAX_BYTES) {
      throw AppError.tooLarge(
        'This Word document expands to more than 100 MB and cannot be converted',
        {
          maxUnzippedBytes: DOCX_UNZIPPED_MAX_BYTES,
        },
      );
    }

    const taken = await this.nodes.siblingKeys(file.workspaceId, file.parentId);
    const base = file.name.replace(/\.docx$/i, '') || 'Tài liệu';
    const name = taken.has(nameKey(base)) ? suggestName(base, taken) : base;
    const nodeId = await this.createNode(user, file.workspaceId, file.parentId, name, emptyDoc());
    try {
      const result = await mammoth.convertToHtml(
        { buffer },
        {
          convertImage: mammoth.images.imgElement(this.assets.docxImage(user.id, nodeId)),
        },
      );
      const json = htmlToJSON(result.value);
      await this.writeContent(nodeId, json);
    } catch (err) {
      await this.prisma.client.node.delete({ where: { id: nodeId } }).catch(() => undefined);
      throw err instanceof AppError
        ? err
        : AppError.unsupportedType('This Word document could not be converted');
    }
    await this.audit.log({
      actorId: user.id,
      action: 'document.import',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: file.workspaceId,
      metadata: { name, fromNodeId: fileNodeId, fromName: file.name },
      ctx,
    });
    await this.search.node(nodeId);
    return this.detail(user, nodeId);
  }

  async detail(user: AuthenticatedUser, nodeId: string) {
    const [node, doc, versionCount, access] = await Promise.all([
      this.dto.one(user.id, nodeId),
      this.prisma.client.document.findUnique({ where: { nodeId } }),
      this.prisma.client.documentVersion.count({ where: { nodeId } }),
      this.access.requireNode(user, nodeId, 'VIEWER'),
    ]);
    const editor = doc?.lastEditedBy
      ? await this.prisma.client.user.findUnique({
          where: { id: doc.lastEditedBy },
          select: userSummary,
        })
      : null;
    return {
      node,
      format: doc?.format ?? 'RICH',
      contentJson: await this.assets.withFreshUrls(
        nodeId,
        (doc?.contentJson as DocJSON | null) ?? emptyDoc(),
      ),
      wordCount: doc?.wordCount ?? 0,
      lastEditedAt: doc?.lastEditedAt ?? null,
      lastEditedBy: editor,
      versionCount,
      readOnly: access.role === 'VIEWER',
    };
  }

  private async createNode(
    user: AuthenticatedUser,
    workspaceId: string,
    parentId: string | null,
    name: string,
    json: DocJSON,
  ) {
    try {
      const node = await this.nodes.withTreeLock(workspaceId, (tx) =>
        tx.node.create({
          data: {
            workspaceId,
            parentId,
            type: 'DOCUMENT',
            name,
            nameNormalized: nameKey(name),
            createdById: user.id,
            updatedById: user.id,
            document: {
              create: { ...this.contentFields(json), format: isLatexJSON(json) ? 'LATEX' : 'RICH' },
            },
          },
        }),
      );
      return node.id;
    } catch (err) {
      throw await this.nodes.mapNameConflict(err, workspaceId, parentId, name);
    }
  }

  private async latestContent(nodeId: string, workspaceId: string, actorId: string) {
    const state = await this.collab.snapshot(nodeId, workspaceId, actorId).catch((err) => {
      this.logger.warn({ err, nodeId }, 'Collab snapshot failed, copying the last saved content');
      return null;
    });
    if (state?.length) return stateToJSON(state);
    const doc = await this.prisma.client.document.findUnique({ where: { nodeId } });
    return (doc?.contentJson as DocJSON | null) ?? emptyDoc();
  }

  private async writeContent(nodeId: string, json: DocJSON) {
    await this.prisma.client.document.update({ where: { nodeId }, data: this.contentFields(json) });
  }

  private contentFields(json: DocJSON) {
    const text = jsonToText(json);
    return {
      yjsState: new Uint8Array(jsonToState(json)),
      contentJson: json as object,
      contentText: text,
      wordCount: wordCount(text),
    };
  }
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}
