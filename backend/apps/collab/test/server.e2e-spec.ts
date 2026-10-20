import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Server } from '@hocuspocus/server';
import { pino } from 'pino';
import { createCollabServer } from '../src/server.js';

describe('Collab server (e2e)', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createCollabServer(
      { NODE_ENV: 'test', LOG_LEVEL: 'silent' as never, COLLAB_PORT: 0 },
      pino({ level: 'silent' }),
    );
    await server.listen(0);
    base = `127.0.0.1:${server.address.port}`;
  });

  afterAll(async () => {
    await server.destroy();
  });

  it('GET /health trả ok', async () => {
    const res = await fetch(`http://${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('từ chối kết nối khi chưa có xác thực (an toàn mặc định)', async () => {
    // Node >= 22 có WebSocket toàn cục nên provider chạy được không cần polyfill.
    const reason = await new Promise<string>((resolve) => {
      const provider = new HocuspocusProvider({
        url: `ws://${base}`,
        name: 'doc:test',
        token: 'anything',
        onAuthenticationFailed: ({ reason }) => {
          resolve(reason);
          provider.destroy();
        },
      });
    });
    expect(reason).toBeTruthy();
  });
});
