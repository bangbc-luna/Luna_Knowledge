import { randomUUID } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  type DocJSON,
  emptyDoc,
  htmlToJSON,
  jsonToHTML,
  jsonToMarkdown,
  jsonToState,
  jsonToText,
  wordCount,
} from '@luna/editor';
import { COLLAB_TOKEN_AUDIENCE, collabDocumentName } from '@luna/shared';
import { Inject, Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { SignJWT } from 'jose';
import mammoth from 'mammoth';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentAccessService } from '../content/content-access.service.js';
import { NodeDtoService } from '../content/node-dto.service.js';
import { nameKey, suggestName } from '../content/node-names.js';
import { NodesService } from '../content/nodes.service.js';
import { StorageService } from '../files/storage.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { BUCKETS, type Buckets, S3 } from '../infra/s3/s3.module.js';
import type { CreateDocumentBody } from './documents.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const COLLAB_TOKEN_TTL_SEC = 300;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ASSET_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  DOCX_MIME,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export interface UploadedAsset {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly nodes: NodesService,
    private readonly dto: NodeDtoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(BUCKETS) private readonly buckets: Buckets,
  ) {}

  async create(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateDocumentBody,
    ctx: RequestContext,
  ) {
    const parentId = body.parentId ?? null;
    await this.nodes.requireContainer(user, workspaceId, parentId, 'DOCS');
    const nodeId = await this.createNode(user, workspaceId, parentId, body.name, emptyDoc());
    await this.audit.log({
      actorId: user.id,
      action: 'node.create',
      targetType: 'node',
      targetId: nodeId,
      workspaceId,
      metadata: { type: 'DOCUMENT', name: body.name, parentId },
      ctx,
    });
    return this.detail(user, nodeId);
  }

  async get(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireDocument(user, nodeId, 'VIEWER');
    await this.audit.logView(user.id, node, ctx);
    await this.prisma.client.recentView.upsert({
      where: { userId_nodeId: { userId: user.id, nodeId } },
      create: { userId: user.id, nodeId },
      update: { viewedAt: new Date() },
    });
    return this.detail(user, nodeId);
  }

  async collabToken(user: AuthenticatedUser, nodeId: string) {
    const node = await this.requireDocument(user, nodeId, 'VIEWER');
    const expiresAt = new Date(Date.now() + COLLAB_TOKEN_TTL_SEC * 1000);
    const token = await new SignJWT({ doc: nodeId, name: user.name })
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
    format: 'html' | 'md',
    ctx: RequestContext,
  ) {
    const node = await this.requireDocument(user, nodeId, 'VIEWER');
    const doc = await this.prisma.client.document.findUnique({ where: { nodeId } });
    const json = await this.withFreshAssetUrls(
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
    const base = node.name.replace(/\.(md|html?)$/i, '');
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
    await this.requireDocument(user, nodeId, 'EDITOR');
    if (!file?.buffer?.length) throw AppError.validation('Attach a file in the "file" field');
    if (file.size > MAX_ASSET_BYTES)
      throw AppError.tooLarge('Embedded files are limited to 20 MB', { maxBytes: MAX_ASSET_BYTES });
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !ASSET_MIMES.has(detected.mime)) {
      throw AppError.unsupportedType(
        'Only images (PNG, JPEG, WebP, GIF), PDF and Office files can be embedded',
      );
    }
    const asset = await this.storeAsset(
      user.id,
      nodeId,
      file.originalname.normalize('NFC'),
      file.buffer,
      detected.mime,
    );
    return this.assetDto(asset);
  }

  async listAssets(user: AuthenticatedUser, nodeId: string) {
    await this.requireDocument(user, nodeId, 'VIEWER');
    const assets = await this.prisma.client.documentAsset.findMany({
      where: { nodeId },
      include: { blob: true },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(assets.map((a) => this.assetDto(a)));
  }

  async importDocx(user: AuthenticatedUser, fileNodeId: string, ctx: RequestContext) {
    const file = await this.access.requireNode(user, fileNodeId, 'VIEWER');
    if (file.type !== 'FILE') throw AppError.notFound('File not found');
    await this.nodes.requireContainer(user, file.workspaceId, file.parentId);
    const info = await this.prisma.client.fileInfo.findUnique({
      where: { nodeId: fileNodeId },
      include: { currentVersion: { include: { original: true } } },
    });
    const original = info?.currentVersion?.original;
    if (!original || original.mime !== DOCX_MIME) {
      throw AppError.unsupportedType('Only Word documents (.docx) can be converted');
    }
    const { body } = await this.storage.forRef(original).getStream(original);
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.from(c as Buffer));
    const buffer = Buffer.concat(chunks);

    const taken = await this.nodes.siblingKeys(file.workspaceId, file.parentId);
    const base = file.name.replace(/\.docx$/i, '') || 'Tài liệu';
    const name = taken.has(nameKey(base)) ? suggestName(base, taken) : base;
    const nodeId = await this.createNode(user, file.workspaceId, file.parentId, name, emptyDoc());
    try {
      const result = await mammoth.convertToHtml(
        { buffer },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            const data = Buffer.from(await image.readAsBase64String(), 'base64');
            const mime = (await fileTypeFromBuffer(data))?.mime ?? image.contentType;
            if (
              !ASSET_MIMES.has(mime) ||
              !mime.startsWith('image/') ||
              data.length > MAX_ASSET_BYTES
            )
              return { src: '' };
            const asset = await this.storeAsset(
              user.id,
              nodeId,
              `image-${randomUUID().slice(0, 8)}`,
              data,
              mime,
            );
            const url = (await this.assetDto(asset)).url;
            return { src: url, 'data-asset-id': asset.id } as { src: string };
          }),
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
    return this.detail(user, nodeId);
  }

  async requireDocument(user: AuthenticatedUser, nodeId: string, min: 'VIEWER' | 'EDITOR') {
    const node = await this.access.requireNode(user, nodeId, min);
    if (node.type !== 'DOCUMENT') throw AppError.notFound('Document not found');
    return node;
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
      contentJson: await this.withFreshAssetUrls(
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
      const node = await this.prisma.client.node.create({
        data: {
          workspaceId,
          parentId,
          type: 'DOCUMENT',
          name,
          nameNormalized: nameKey(name),
          createdById: user.id,
          updatedById: user.id,
          document: { create: this.contentFields(json) },
        },
      });
      return node.id;
    } catch (err) {
      throw await this.nodes.mapNameConflict(err, workspaceId, parentId, name);
    }
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

  private async storeAsset(
    userId: string,
    nodeId: string,
    fileName: string,
    data: Buffer,
    mime: string,
  ) {
    const id = randomUUID();
    const key = `docs/${nodeId}/${id}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.buckets.assets,
        Key: key,
        Body: data,
        ContentType: mime,
      }),
    );
    const blob = await this.prisma.client.blob.create({
      data: {
        nodeId,
        kind: 'ASSET',
        provider: 'S3',
        container: this.buckets.assets,
        key,
        sizeBytes: BigInt(data.length),
        mime,
      },
    });
    return this.prisma.client.documentAsset.create({
      data: { id, nodeId, blobId: blob.id, fileName, createdById: userId },
      include: { blob: true },
    });
  }

  private async assetDto(a: {
    id: string;
    fileName: string;
    blob: {
      provider: 'S3' | 'GDRIVE';
      container: string;
      key: string;
      mime: string;
      sizeBytes: bigint;
    };
  }) {
    const isImage = a.blob.mime.startsWith('image/');
    const { url } = await this.storage.presignGet(a.blob, {
      fileName: a.fileName,
      contentType: a.blob.mime,
      disposition: isImage ? 'inline' : 'attachment',
    });
    return {
      id: a.id,
      fileName: a.fileName,
      mime: a.blob.mime,
      size: Number(a.blob.sizeBytes),
      url,
      isImage,
    };
  }

  private async withFreshAssetUrls(nodeId: string, json: DocJSON): Promise<DocJSON> {
    const ids = new Set<string>();
    const walk = (n: DocJSON) => {
      if (n.type === 'image' && typeof n.attrs?.assetId === 'string') ids.add(n.attrs.assetId);
      n.content?.forEach(walk);
    };
    walk(json);
    if (!ids.size) return json;
    const assets = await this.prisma.client.documentAsset.findMany({
      where: { nodeId, id: { in: [...ids] } },
      include: { blob: true },
    });
    const urls = new Map(
      await Promise.all(assets.map(async (a) => [a.id, (await this.assetDto(a)).url] as const)),
    );
    const map = (n: DocJSON): DocJSON => ({
      ...n,
      ...(n.type === 'image' && urls.has(n.attrs?.assetId as string)
        ? { attrs: { ...n.attrs, src: urls.get(n.attrs!.assetId as string) } }
        : {}),
      ...(n.content ? { content: n.content.map(map) } : {}),
    });
    return map(json);
  }
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}
