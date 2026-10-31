import { timingSafeEqual } from 'node:crypto';
import {
  createDocumentVersion,
  createPrismaClient,
  type PrismaClient,
  resolveDocumentAccess,
} from '@luna/db';
import {
  type DocJSON,
  jsonToState,
  jsonToText,
  replaceContent,
  ydocToJSON,
  wordCount,
} from '@luna/editor';
import {
  COLLAB_ACCESS_CHANNEL,
  type CollabAccessEvent,
  createMetricsRegistry,
  listenHost,
  metricsAllowed,
  QUEUES,
  redisConnection,
} from '@luna/shared';
import { Gauge } from 'prom-client';
import { type Connection, type Document, Server } from '@hocuspocus/server';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import * as Y from 'yjs';
import { verifyCollabToken } from './auth.js';
import type { CollabConfig } from './config.js';
import { enqueueIndexNode } from './index-queue.js';

export interface CollabContext {
  userId: string;
  name: string;
  nodeId: string;
  workspaceId: string;
  sessionId?: string;
  internal?: boolean;
}

const DOC_PREFIX = 'doc:';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function createLogger(config: Pick<CollabConfig, 'LOG_LEVEL' | 'NODE_ENV'>) {
  return pino({
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
        : undefined,
  });
}

const nodeIdOf = (documentName: string) =>
  documentName.startsWith(DOC_PREFIX) ? documentName.slice(DOC_PREFIX.length) : null;

function secretMatches(given: string | undefined, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createCollabServer(
  config: CollabConfig,
  logger = createLogger(config),
  deps: { prisma?: PrismaClient } = {},
) {
  const prisma =
    deps.prisma ??
    createPrismaClient({
      connectionString: config.DATABASE_URL,
      max: 5,
      connectTimeoutMs: config.DB_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
      idleInTransactionTimeoutMs: config.DB_IDLE_TX_TIMEOUT_MS,
    });
  const searchQueue = new Queue(QUEUES.SEARCH_INDEX, {
    connection: redisConnection(config.REDIS_URL),
    prefix: 'luna',
  });
  const subscriber = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
  subscriber.on('error', () => undefined);

  const snapshot = (doc: Y.Doc) => {
    const json = ydocToJSON(doc);
    const text = jsonToText(json);
    return { state: Y.encodeStateAsUpdate(doc), json, text, words: wordCount(text) };
  };

  const metrics = createMetricsRegistry('collab');
  new Gauge({
    name: 'collab_documents_open',
    help: 'Documents currently loaded in memory',
    registers: [metrics],
    collect() {
      this.set(server.hocuspocus.documents.size);
    },
  });
  new Gauge({
    name: 'collab_connections',
    help: 'Open editor connections',
    registers: [metrics],
    collect() {
      let n = 0;
      for (const doc of server.hocuspocus.documents.values()) n += doc.getConnectionsCount();
      this.set(n);
    },
  });

  const autoVersion = async (nodeId: string, createdById: string | null) => {
    const row = await prisma.document.findUnique({
      where: { nodeId },
      include: { node: { select: { workspaceId: true, name: true } } },
    });
    if (!row?.dirtySinceVersion || !row.yjsState) return;
    const version = await createDocumentVersion(prisma, {
      nodeId,
      yjsSnapshot: row.yjsState,
      contentJson: (row.contentJson ?? {}) as object,
      contentText: row.contentText ?? '',
      wordCount: row.wordCount,
      isAuto: true,
      createdById,
    });
    await prisma.auditLog
      .create({
        data: {
          actorId: createdById,
          action: 'document.edit',
          targetType: 'node',
          targetId: nodeId,
          workspaceId: row.node.workspaceId,
          metadata: {
            name: row.node.name,
            versionId: version.id,
            versionNo: version.versionNo,
            wordsAdded: version.wordsAdded,
            wordsRemoved: version.wordsRemoved,
          },
        },
      })
      .catch((err) => logger.error({ err, nodeId }, 'Could not write edit log'));
  };

  const closeSession = (server: Server, sessionId: string) => {
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of [...document.connections.keys()] as Connection<CollabContext>[]) {
        const ctx = connection.context;
        if (!ctx || ctx.internal || ctx.sessionId !== sessionId) continue;
        logger.info(
          { userId: ctx.userId, nodeId: ctx.nodeId },
          'Session ended, closing collab connection',
        );
        connection.close({ code: 4401, reason: 'Session ended' });
      }
    }
  };

  const recheck = async (server: Server, event: CollabAccessEvent) => {
    if (event.sessionId) return closeSession(server, event.sessionId);
    for (const [name, document] of server.hocuspocus.documents) {
      const nodeId = nodeIdOf(name);
      if (!nodeId || (event.nodeId && event.nodeId !== nodeId)) continue;
      for (const connection of [...document.connections.keys()] as Connection<CollabContext>[]) {
        const ctx = connection.context;
        if (!ctx || ctx.internal) continue;
        if (event.userId && event.userId !== ctx.userId) continue;
        if (event.workspaceId && event.workspaceId !== ctx.workspaceId) continue;
        const access = await resolveDocumentAccess(prisma, ctx.userId, nodeId);
        if (!access) {
          logger.info({ userId: ctx.userId, nodeId }, 'Access revoked, closing collab connection');
          connection.close({ code: 4403, reason: 'Forbidden' });
        } else {
          connection.readOnly = access.role === 'VIEWER';
        }
      }
    }
  };

  const server = new Server<CollabContext>({
    name: 'luna-collab',
    port: config.COLLAB_PORT,
    address: listenHost(config),
    quiet: true,
    stopOnSignals: true,
    debounce: 2000,
    maxDebounce: 10000,

    async onRequest({ request, response, instance }) {
      const url = new URL(request.url ?? '/', 'http://collab');
      if (
        request.method === 'GET' &&
        (url.pathname === '/health' || url.pathname === '/health/live')
      ) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        throw null;
      }
      if (request.method === 'GET' && url.pathname === '/metrics') {
        if (
          metricsAllowed(
            request.socket.remoteAddress,
            request.headers.authorization,
            config.METRICS_TOKEN,
          )
        ) {
          response.writeHead(200, { 'Content-Type': metrics.contentType });
          response.end(await metrics.metrics());
        } else {
          response.writeHead(404);
          response.end();
        }
        throw null;
      }
      const match = /^\/internal\/documents\/([0-9a-f-]{36})\/(replace|snapshot)$/.exec(
        url.pathname,
      );
      if (!match) return;
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      try {
        if (request.method !== 'POST') {
          send(405, { error: 'Method not allowed' });
        } else if (
          !secretMatches(
            request.headers['x-internal-secret'] as string | undefined,
            config.COLLAB_INTERNAL_SECRET,
          )
        ) {
          send(401, { error: 'Unauthorized' });
        } else {
          const nodeId = match[1]!;
          const body = JSON.parse((await readBody(request)) || '{}') as {
            json?: DocJSON;
            actorId: string;
            workspaceId: string;
          };
          const connection = await instance.openDirectConnection(`${DOC_PREFIX}${nodeId}`, {
            userId: body.actorId,
            name: '',
            nodeId,
            workspaceId: body.workspaceId,
            internal: true,
          });
          let state: Uint8Array = new Uint8Array();
          await connection.transact((doc) => {
            if (match[2] === 'replace' && body.json) replaceContent(doc, body.json, 'restore');
            state = Y.encodeStateAsUpdate(doc);
          });
          await connection.disconnect();
          send(200, { state: Buffer.from(state).toString('base64') });
        }
      } catch (err) {
        logger.error({ err }, 'Internal document call failed');
        send(500, { error: 'Internal call failed' });
      }
      throw null;
    },

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const nodeId = nodeIdOf(documentName);
      if (!nodeId) throw new Error('Unknown document');
      const claims = await verifyCollabToken(token, config.COLLAB_TOKEN_SECRET).catch(() => {
        throw new Error('Invalid token');
      });
      if (claims.nodeId !== nodeId) throw new Error('Token is for another document');
      if (claims.sessionId) {
        const session = await prisma.session.findUnique({
          where: { id: claims.sessionId },
          select: { userId: true, revokedAt: true },
        });
        if (!session || session.revokedAt || session.userId !== claims.userId)
          throw new Error('Session ended');
      }
      const access = await resolveDocumentAccess(prisma, claims.userId, nodeId);
      if (!access || access.type !== 'DOCUMENT') throw new Error('Forbidden');
      connectionConfig.readOnly = access.role === 'VIEWER';
      return {
        userId: claims.userId,
        name: claims.name,
        nodeId,
        workspaceId: access.workspaceId,
        sessionId: claims.sessionId,
      };
    },

    async onLoadDocument({ documentName, document }) {
      const nodeId = nodeIdOf(documentName);
      if (!nodeId) return document;
      const row = await prisma.document.findUnique({ where: { nodeId } });
      const state =
        row?.yjsState ?? (row?.contentJson ? jsonToState(row.contentJson as DocJSON) : null);
      if (state) Y.applyUpdate(document, state);
      return document;
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      const nodeId = nodeIdOf(documentName);
      if (!nodeId) return;
      const s = snapshot(document as Document);
      const now = new Date();
      const editor = lastContext?.userId ?? null;
      if (editor && !lastContext?.internal) {
        const prev = await prisma.document.findUnique({
          where: { nodeId },
          select: { lastEditedBy: true, dirtySinceVersion: true },
        });
        if (prev?.dirtySinceVersion && prev.lastEditedBy && prev.lastEditedBy !== editor) {
          await autoVersion(nodeId, prev.lastEditedBy).catch((err) =>
            logger.error({ err, nodeId }, 'Auto version on editor change failed'),
          );
        }
      }
      const row = await prisma.document.update({
        where: { nodeId },
        data: {
          yjsState: new Uint8Array(s.state),
          contentJson: s.json as object,
          contentText: s.text,
          wordCount: s.words,
          lastEditedAt: now,
          lastEditedBy: editor,
          dirtySinceVersion: true,
        },
      });
      const node = await prisma.node.update({
        where: { id: nodeId },
        data: { updatedById: editor ?? undefined },
        select: { createdAt: true },
      });
      await enqueueIndexNode(searchQueue, nodeId, config.COLLAB_INDEX_DELAY_MS).catch(
        () => undefined,
      );
      const since = row.lastVersionAt ?? node.createdAt;
      const due = now.getTime() - since.getTime() >= config.COLLAB_AUTO_VERSION_MIN * 60_000;
      if (due && !lastContext?.internal) await autoVersion(nodeId, editor);
    },

    async afterUnloadDocument({ documentName }) {
      const nodeId = nodeIdOf(documentName);
      if (!nodeId) return;
      const row = await prisma.document.findUnique({
        where: { nodeId },
        select: { lastEditedBy: true },
      });
      await autoVersion(nodeId, row?.lastEditedBy ?? null).catch((err) =>
        logger.error({ err, nodeId }, 'Auto version failed'),
      );
    },

    async onListen({ port }) {
      await subscriber.connect().catch(() => undefined);
      await subscriber.subscribe(COLLAB_ACCESS_CHANNEL).catch(() => undefined);
      subscriber.on('message', (_channel: string, message: string) => {
        try {
          void recheck(server, JSON.parse(message) as CollabAccessEvent);
        } catch {
          return;
        }
      });
      logger.info(`Collab server listening on :${port}`);
    },

    async onDestroy() {
      await subscriber.quit().catch(() => undefined);
      await searchQueue.close().catch(() => undefined);
      if (!deps.prisma) await prisma.$disconnect();
    },
  });
  server.httpServer.keepAliveTimeout = config.HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.httpServer.headersTimeout = config.HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000;
  return server;
}
