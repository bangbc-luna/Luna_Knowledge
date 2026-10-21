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
