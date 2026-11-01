import { randomUUID } from 'node:crypto';
import type { DocJSON } from '@luna/editor';
import { ObjectStore } from '@luna/shared';
import { Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { PREVIEW_URL } from '../infra/s3/s3.module.js';

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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

export interface AssetDto {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  url: string;
  isImage: boolean;
}

@Injectable()
export class DocumentAssets {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ObjectStore,
  ) {}

  async upload(userId: string, nodeId: string, file: UploadedAsset | undefined): Promise<AssetDto> {
    if (!file?.buffer?.length) throw AppError.validation('Attach a file in the "file" field');
    if (file.size > MAX_ASSET_BYTES)
      throw AppError.tooLarge('Embedded files are limited to 20 MB', { maxBytes: MAX_ASSET_BYTES });
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !ASSET_MIMES.has(detected.mime)) {
      throw AppError.unsupportedType(
        'Only images (PNG, JPEG, WebP, GIF), PDF and Office files can be embedded',
      );
    }
    const asset = await this.saveBlob(
      userId,
      nodeId,
      file.originalname.normalize('NFC'),
      file.buffer,
      detected.mime,
    );
    return this.toDto(asset);
  }

  async list(nodeId: string): Promise<AssetDto[]> {
    const assets = await this.prisma.client.documentAsset.findMany({
      where: { nodeId },
      include: { blob: true },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(assets.map((a) => this.toDto(a)));
  }

  async copyAll(userId: string, fromNodeId: string, toNodeId: string) {
    const assets = await this.prisma.client.documentAsset.findMany({
      where: { nodeId: fromNodeId },
      include: { blob: true },
    });
    const copied = await Promise.all(
      assets.map(async (a) => {
        const id = randomUUID();
        const key = `docs/${toNodeId}/${id}`;
        const blob = await this.prisma.client.blob.create({
          data: {
            nodeId: toNodeId,
            kind: 'ASSET',
            provider: 'S3',
            container: this.store.buckets.assets,
            key,
            sizeBytes: a.blob.sizeBytes,
            mime: a.blob.mime,
          },
        });
        await this.store.copy(a.blob, 'assets', key);
        return { from: a.id, id, blobId: blob.id, fileName: a.fileName };
      }),
    );
    await this.prisma.client.documentAsset.createMany({
      data: copied.map((c) => ({
        id: c.id,
        nodeId: toNodeId,
        blobId: c.blobId,
        fileName: c.fileName,
        createdById: userId,
      })),
    });
    return new Map(copied.map((c) => [c.from, c.id]));
  }

  async withFreshUrls(nodeId: string, json: DocJSON): Promise<DocJSON> {
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
      await Promise.all(assets.map(async (a) => [a.id, (await this.toDto(a)).url] as const)),
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

  docxImage(userId: string, nodeId: string) {
    return async (image: {
      readAsBase64String(): Promise<string>;
      contentType: string;
    }): Promise<{ src: string }> => {
      const data = Buffer.from(await image.readAsBase64String(), 'base64');
      const mime = (await fileTypeFromBuffer(data))?.mime ?? image.contentType;
      if (!ASSET_MIMES.has(mime) || !mime.startsWith('image/') || data.length > MAX_ASSET_BYTES)
        return { src: '' };
      const asset = await this.saveBlob(
        userId,
        nodeId,
        `image-${randomUUID().slice(0, 8)}`,
        data,
        mime,
      );
      const { url } = await this.toDto(asset);
      return { src: url, 'data-asset-id': asset.id } as { src: string };
    };
  }

  private async saveBlob(
    userId: string,
    nodeId: string,
    fileName: string,
    data: Buffer,
    mime: string,
  ) {
    const id = randomUUID();
    const key = `docs/${nodeId}/${id}`;
    const stored = await this.store.putBuffer('assets', key, data, mime);
    const blob = await this.prisma.client.blob.create({
      data: {
        nodeId,
        kind: 'ASSET',
        ...stored,
        sizeBytes: BigInt(data.length),
        mime,
      },
    });
    return this.prisma.client.documentAsset.create({
      data: { id, nodeId, blobId: blob.id, fileName, createdById: userId },
      include: { blob: true },
    });
  }

  private async toDto(a: {
    id: string;
    fileName: string;
    blob: {
      provider: 'S3' | 'GDRIVE';
      container: string;
      key: string;
      mime: string;
      sizeBytes: bigint;
    };
  }): Promise<AssetDto> {
    const isImage = a.blob.mime.startsWith('image/');
    const { url } = await this.store.presignGet(a.blob, {
      ...PREVIEW_URL,
      contentType: a.blob.mime,
      disposition: { type: isImage ? 'inline' : 'attachment', fileName: a.fileName },
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
}

export function remapAssets(json: DocJSON, ids: Map<string, string>): DocJSON {
  const assetId = json.attrs?.assetId;
  const marks = json.marks?.filter((m) => m.type !== 'comment');
  return {
    ...json,
    ...(json.marks ? { marks: marks?.length ? marks : undefined } : {}),
    ...(json.type === 'image' && typeof assetId === 'string'
      ? { attrs: { ...json.attrs, assetId: ids.get(assetId) ?? null } }
      : {}),
    ...(json.content ? { content: json.content.map((c) => remapAssets(c, ids)) } : {}),
  };
}
