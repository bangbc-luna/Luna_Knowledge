import { Server } from '@hocuspocus/server';
import { pino } from 'pino';
import type { CollabConfig } from './config.js';

export function createLogger(config: CollabConfig) {
  return pino({
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
        : undefined,
  });
}

/**
 * Server Hocuspocus cho soạn thảo real-time (SPEC §5.5).
 * Phase 0: chỉ có health check; mọi kết nối WebSocket bị từ chối cho đến khi Phase 5
 * cài đặt xác thực collab token + permission engine (an toàn mặc định).
 */
export function createCollabServer(config: CollabConfig, logger = createLogger(config)) {
  return new Server({
    name: 'luna-collab',
    port: config.COLLAB_PORT,
    quiet: true,
    stopOnSignals: true,

    async onRequest({ request, response }) {
      if (
        request.method === 'GET' &&
        (request.url === '/health' || request.url === '/health/live')
      ) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        // Hocuspocus quy ước `throw null` để dừng chuỗi xử lý request mặc định.
        throw null;
      }
    },

    async onAuthenticate({ documentName, socketId }) {
      logger.warn(
        { documentName, socketId },
        'Rejected connection: authentication not implemented',
      );
      throw new Error('Authentication not implemented');
    },

    async onListen({ configuration }) {
      logger.info(`Collab server listening on :${(configuration as { port?: number }).port}`);
    },
  });
}
