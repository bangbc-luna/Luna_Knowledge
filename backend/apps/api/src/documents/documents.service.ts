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
import { NodeTree } from '../content/node-tree.service.js';
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
    private readonly tree: NodeTree,
    private readonly dto: NodeDtoService,
    private readonly store: ObjectStore,
    private readonly assets: DocumentAssets,
    private readonly audit: AuditService,
    private readonly collab: CollabClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateDocumentBody,
    ctx: RequestContext,
  ) {
    const node = await this.tree.create(
      user,
      {
        workspaceId,
        parentId: body.parentId ?? null,
        section: 'DOCS',
        type: 'DOCUMENT',
        name: body.name,
        extra: {
          document: this.documentFields(
            body.format === 'LATEX' ? latexJSON(LATEX_TEMPLATE) : emptyDoc(),
          ),
        },
      },
      ctx,
      {
        announce: {
          action: 'node.create',
          metadata: (n) => ({
            type: 'DOCUMENT',
            format: body.format,
            name: n.name,
            parentId: n.parentId,
          }),
        },
      },
    );
    return this.detail(user, node.id);
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
    const copy = await this.tree.create(
      user,
      {
        workspaceId,
        parentId,
        section: 'DOCS',
        type: 'DOCUMENT',
        name: body.name || `${source.name} (bản sao)`,
        autoRename: !body.name,
        extra: async () => {
          const json = await this.latestContent(source.id, source.workspaceId, user.id);
          return {
            fields: {
              document: this.documentFields(isLatexJSON(json) ? latexJSON('') : emptyDoc()),
            },
            context: json,
          };
        },
      },
      ctx,
      {
        fill: async (n, json) => {
          const assetIds = await this.assets.copyAll(user.id, source.id, n.id);
          await this.writeContent(n.id, remapAssets(json, assetIds));
        },
        announce: {
          action: 'document.copy',
          metadata: (n) => ({
            name: n.name,
            parentId: n.parentId,
            fromNodeId: source.id,
            fromName: source.name,
            fromWorkspaceId: source.workspaceId,
          }),
        },
      },
    );
    return this.detail(user, copy.id);
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
    const node = await this.tree.create(
      user,
      {
        workspaceId: file.workspaceId,
        parentId: file.parentId,
        type: 'DOCUMENT',
        name: file.name.replace(/\.docx$/i, '') || 'Tài liệu',
        autoRename: true,
        extra: async () => ({
          fields: { document: this.documentFields(emptyDoc()) },
          context: await this.readDocx(fileNodeId),
        }),
      },
      ctx,
      {
        fill: async (n, buffer) => {
          try {
            const result = await mammoth.convertToHtml(
              { buffer },
              {
                convertImage: mammoth.images.imgElement(this.assets.docxImage(user.id, n.id)),
              },
            );
            await this.writeContent(n.id, htmlToJSON(result.value));
          } catch (err) {
            throw err instanceof AppError
              ? err
              : AppError.unsupportedType('This Word document could not be converted');
          }
        },
        announce: {
          action: 'document.import',
          metadata: (n) => ({ name: n.name, fromNodeId: fileNodeId, fromName: file.name }),
        },
      },
    );
    return this.detail(user, node.id);
  }

  private async readDocx(fileNodeId: string): Promise<Buffer> {
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
    return buffer;
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

  private documentFields(json: DocJSON) {
    return { ...this.contentFields(json), format: isLatexJSON(json) ? 'LATEX' : 'RICH' } as const;
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
