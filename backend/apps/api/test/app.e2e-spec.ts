import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app.js';

describe('App bootstrap (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
  });

  afterAll(async () => {
    await close();
  });

  it('GET /health báo database, redis, storage đều up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.details).toEqual({
      database: { status: 'up' },
      redis: { status: 'up' },
      storage: { status: 'up' },
    });
  });

  it('GET /health/live không cần phụ thuộc', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('route không tồn tại trả lỗi chuẩn kèm request-id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('giữ x-request-id hợp lệ do client gửi lên', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'trace-1234567890');
    expect(res.headers['x-request-id']).toBe('trace-1234567890');
  });

  it('route cần đăng nhập trả 401 UNAUTHENTICATED khi không có token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('Swagger JSON có sẵn tại /api/docs-json', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(res.body.info.title).toBe('Luna Knowledge API');
    expect(res.body.paths).toHaveProperty('/health');
  });
});
