import { randomBytes } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { QUEUES, redisConnection, sealVideoKey } from '@luna/shared';
import { Queue } from 'bullmq';
import request from 'supertest';
import { BUCKETS, type Buckets, S3 } from '../src/infra/s3/s3.module.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Videos: phát có bảo vệ (e2e)', () => {
  let ctx: TestContext;
  let sysadmin: LoggedIn;
  let owner: LoggedIn;
  let editor: LoggedIn;
  let viewer: LoggedIn;
  let outsider: LoggedIn;
  let wsId: string;
  let s3: S3Client;
  let buckets: Buckets;
  let videoQueue: Queue;
  const http = () => request(ctx.app.getHttpServer());
  const key = randomBytes(16);
  const original = Buffer.from('original video bytes');
  const segment = randomBytes(376);

  async function seedVideo(name: string, { ready = true } = {}) {
    const node = await ctx.prisma.node.create({
      data: {
        workspaceId: wsId,
        type: 'VIDEO',
        section: 'VIDEOS',
        name,
        nameNormalized: name.toLowerCase(),
        status: ready ? 'READY' : 'PROCESSING',
        createdById: editor.userId,
      },
    });
    await http()
      .post(`/api/v1/nodes/${node.id}/shares`)
      .set(owner.auth)
      .send({ email: 'viewer@lunatech.vn', role: 'VIEWER' })
      .expect(201);
    const put = (Bucket: string, Key: string, Body: Buffer | string) =>
      s3.send(new PutObjectCommand({ Bucket, Key, Body }));
    const versionId = crypto.randomUUID();
    const origKey = `ws/${wsId}/${node.id}/${versionId}`;
    await put(buckets.originals, origKey, original);
    const blob = (
      kind: 'ORIGINAL' | 'HLS' | 'POSTER' | 'SPRITE',
      container: string,
      k: string,
      mime: string,
    ) =>
      ctx.prisma.blob.create({
        data: {
          nodeId: node.id,
          kind,
          provider: 'S3',
          container,
          key: k,
          sizeBytes: BigInt(kind === 'ORIGINAL' ? original.length : 10),
          mime,
        },
      });
    const orig = await blob('ORIGINAL', buckets.originals, origKey, 'video/mp4');
    await ctx.prisma.fileVersion.create({
      data: {
        id: versionId,
        nodeId: node.id,
        versionNo: 1,
        fileName: name,
        originalBlobId: orig.id,
        uploadedById: editor.userId,
      },
    });
    await ctx.prisma.fileInfo.create({ data: { nodeId: node.id, currentVersionId: versionId } });
    if (!ready) return { nodeId: node.id, versionId };

    const prefix = `${node.id}/${versionId}-test/`;
    await put(
      buckets.hls,
      `${prefix}master.m3u8`,
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=640x360\n360p/index.m3u8\n',
    );
    await put(
      buckets.hls,
      `${prefix}360p/index.m3u8`,
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n' +
        '#EXT-X-KEY:METHOD=AES-128,URI="luna-key",IV=0x00000000000000000000000000000001\n' +
        '#EXTINF:6.0,\nseg_0000.ts\n#EXTINF:2.0,\nseg_0001.ts\n#EXT-X-ENDLIST\n',
    );
    await put(buckets.hls, `${prefix}360p/seg_0000.ts`, segment);
    await put(buckets.hls, `${prefix}360p/seg_0001.ts`, segment);
    await put(buckets.thumbnails, `${prefix.slice(0, -1)}-sprite.jpg`, 'jpg');
    const hls = await blob('HLS', buckets.hls, prefix, 'application/vnd.apple.mpegurl');
    const poster = await blob(
      'POSTER',
      buckets.thumbnails,
      `${prefix.slice(0, -1)}-poster.jpg`,
      'image/jpeg',
    );
    const sprite = await blob(
      'SPRITE',
      buckets.thumbnails,
      `${prefix.slice(0, -1)}-sprite.jpg`,
      'image/jpeg',
    );
    await ctx.prisma.video.create({
      data: {
        nodeId: node.id,
        versionId,
        durationSec: 8,
        width: 640,
        height: 360,
        renditions: [
          { name: '360p', width: 640, height: 360, bandwidth: 896000, playlist: '360p/index.m3u8' },
        ],
        hlsBlobId: hls.id,
        posterBlobId: poster.id,
        spriteBlobId: sprite.id,
        spriteVtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nsprite.jpg#xywh=0,0,160,90\n',
        keyEncrypted: new Uint8Array(sealVideoKey(key, process.env.VIDEO_MASTER_KEY!)),
      },
    });
    return { nodeId: node.id, versionId };
  }

  const play = (as: LoggedIn, id: string) =>
    http().post(`/api/v1/videos/${id}/playback`).set(as.auth);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    s3 = ctx.app.get(S3);
    buckets = ctx.app.get(BUCKETS);
    videoQueue = new Queue(QUEUES.VIDEO_TRANSCODE, {
      connection: redisConnection(process.env.REDIS_URL!),
      prefix: 'luna',
    });
    sysadmin = await loginAsAdmin(ctx);
    owner = await loginAs(ctx, 'owner@lunatech.vn');
    editor = await loginAs(ctx, 'editor@lunatech.vn');
    viewer = await loginAs(ctx, 'viewer@lunatech.vn', { name: 'Người Xem' });
    outsider = await loginAs(ctx, 'outsider@lunatech.vn');
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(owner.auth)
      .send({ name: 'Video', slug: 'video', memberEmails: ['editor@lunatech.vn'] })
      .expect(201);
    wsId = ws.body.id;
  });

  afterAll(async () => {
    await videoQueue?.close();
    await ctx?.close();
  });

  it('người xem qua cloudflared nhận trần 720p, người trong LAN không bị giới hạn', async () => {
    const { nodeId } = await seedVideo('Từ xa.mp4');
    const lan = await play(viewer, nodeId).expect(200);
    expect(lan.body.maxHeight).toBeNull();
    const remote = await play(viewer, nodeId).set('Cf-Connecting-IP', '203.0.113.9').expect(200);
    expect(remote.body.maxHeight).toBe(720);
    await http().get(remote.body.masterUrl).expect(200);
  });

  it('chi tiết video; người ngoài 404; chưa transcode xong thì chưa phát được', async () => {
    const { nodeId } = await seedVideo('Đào tạo.mp4');
    const d = await http().get(`/api/v1/videos/${nodeId}`).set(viewer.auth).expect(200);
    expect(d.body.video).toMatchObject({ durationSec: 8, width: 640, height: 360, viewCount: 0 });
    expect(d.body.video.renditions).toEqual([
      { name: '360p', width: 640, height: 360, bandwidth: 896000 },
    ]);
    await http().get(`/api/v1/videos/${nodeId}`).set(outsider.auth).expect(404);
    await play(outsider, nodeId).expect(404);

    const pending = await seedVideo('Chưa xong.mp4', { ready: false });
    await play(viewer, pending.nodeId).expect(409);
  });

  it('phiên xem: playlist viết lại, segment chuyển hướng URL ký ngắn hạn, khoá đúng 16 byte', async () => {
    const { nodeId } = await seedVideo('Phát.mp4');
    const pb = await play(viewer, nodeId).expect(200);
    expect(pb.body.watermark).toEqual({ name: 'Người Xem', email: 'viewer@lunatech.vn' });
    expect(pb.body.masterUrl).toBe(`/api/v1/videos/${nodeId}/hls/master.m3u8?s=${pb.body.token}`);
    expect(pb.body.posterUrl).toContain('X-Amz-Signature');

    const master = await http().get(pb.body.masterUrl).expect(200);
    expect(master.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    expect(master.text).toContain(
      `/api/v1/videos/${nodeId}/hls/360p/index.m3u8?s=${pb.body.token}`,
    );

    const media = await http()
      .get(`/api/v1/videos/${nodeId}/hls/360p/index.m3u8?s=${pb.body.token}`)
      .expect(200);
    expect(media.text).toContain(`URI="/api/v1/videos/${nodeId}/key?s=${pb.body.token}"`);
    expect(media.text).toContain(
      `/api/v1/videos/${nodeId}/hls/360p/seg_0000.ts?s=${pb.body.token}`,
    );
    expect(media.text).not.toContain('luna-key');

    const seg = await http()
      .get(`/api/v1/videos/${nodeId}/hls/360p/seg_0000.ts?s=${pb.body.token}`)
      .expect(302);
    expect(seg.headers.location).toMatch(/X-Amz-Expires=120/);
    const bytes = Buffer.from(await (await fetch(seg.headers.location!)).arrayBuffer());
    expect(bytes.equals(segment)).toBe(true);

    const k = await http()
      .get(`/api/v1/videos/${nodeId}/key?s=${pb.body.token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(k.body as Buffer, key)).toBe(0);
    expect(k.headers['cache-control']).toContain('no-store');

    await http()
      .get(`/api/v1/videos/${nodeId}/hls/360p/..%2Fmaster.m3u8?s=${pb.body.token}`)
      .expect(404);
    await http().get(`/api/v1/videos/${nodeId}/hls/abc/index.m3u8?s=${pb.body.token}`).expect(404);
  });

  it('phiên sai, phiên của video khác, phiên hết hạn đều bị chặn; khoá có giới hạn số lần', async () => {
    const a = await seedVideo('A.mp4');
    const b = await seedVideo('B.mp4');
    const pb = await play(viewer, a.nodeId).expect(200);
    await http()
      .get(`/api/v1/videos/${a.nodeId}/key?s=${'x'.repeat(32)}`)
      .expect(404);
    await http().get(`/api/v1/videos/${b.nodeId}/key?s=${pb.body.token}`).expect(404);
    await http().get(`/api/v1/videos/${b.nodeId}/hls/master.m3u8?s=${pb.body.token}`).expect(404);

    for (let i = 0; i < 30; i++)
      await http().get(`/api/v1/videos/${a.nodeId}/key?s=${pb.body.token}`).expect(200);
    const limited = await http()
      .get(`/api/v1/videos/${a.nodeId}/key?s=${pb.body.token}`)
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');

    const other = await play(viewer, a.nodeId).expect(200);
    const redis = ctx.app.get(
      (await import('../src/infra/redis/redis.module.js')).REDIS,
    ) as import('ioredis').Redis;
    await redis.del(`pb:${other.body.token}`);
    await http().get(other.body.masterUrl).expect(404);
  });

  it('thu hồi quyền giữa chừng: playlist và khoá bị chặn ngay', async () => {
    const { nodeId } = await seedVideo('Thu hồi.mp4');
    const temp = await loginAs(ctx, 'temp.viewer@lunatech.vn');
    const m = await http()
      .post(`/api/v1/workspaces/${wsId}/members`)
      .set(sysadmin.auth)
      .send({ email: 'temp.viewer@lunatech.vn' })
      .expect(201);
    const pb = await play(temp, nodeId).expect(200);
    await http().get(`/api/v1/videos/${nodeId}/key?s=${pb.body.token}`).expect(200);
    await http()
      .delete(`/api/v1/workspaces/${wsId}/members/${m.body.user.id}`)
      .set(sysadmin.auth)
      .expect(204);
    await http().get(`/api/v1/videos/${nodeId}/key?s=${pb.body.token}`).expect(404);
    await http().get(pb.body.masterUrl).expect(404);
  });

  it('thu hồi share chỉ xem giữa chừng: khoá bị chặn ngay', async () => {
    const { nodeId } = await seedVideo('Thu hồi share.mp4');
    const pb = await play(viewer, nodeId).expect(200);
    await http().get(`/api/v1/videos/${nodeId}/key?s=${pb.body.token}`).expect(200);
    await http().get(`/api/v1/nodes/${nodeId}/shares`).set(editor.auth).expect(403);
    const shares = await http().get(`/api/v1/nodes/${nodeId}/shares`).set(owner.auth).expect(200);
    await http()
      .delete(`/api/v1/nodes/${nodeId}/shares/${shares.body.direct[0].id}`)
      .set(owner.auth)
      .expect(204);
    await http().get(`/api/v1/videos/${nodeId}/key?s=${pb.body.token}`).expect(404);
  });

  it('lượt xem: mở lại trong 30 phút chỉ tính một lần; nhật ký video.play', async () => {
    const { nodeId } = await seedVideo('Đếm.mp4');
    await play(viewer, nodeId).expect(200);
    await play(viewer, nodeId).expect(200);
    await play(editor, nodeId).expect(200);
    const d = await http().get(`/api/v1/videos/${nodeId}`).set(viewer.auth).expect(200);
    expect(d.body.video.viewCount).toBe(2);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'video.play', targetId: nodeId } }),
    ).toBe(2);
  });

  it('lưu vị trí xem dở; poster, sprite VTT có URL ký', async () => {
    const { nodeId } = await seedVideo('Xem tiếp.mp4');
    await http()
      .put(`/api/v1/videos/${nodeId}/progress`)
      .set(viewer.auth)
      .send({ positionSec: 3.5 })
      .expect(204);
    const d = await http().get(`/api/v1/videos/${nodeId}`).set(viewer.auth).expect(200);
    expect(d.body.resumeAt).toBe(3.5);
    expect((await play(viewer, nodeId).expect(200)).body.resumeAt).toBe(3.5);
    await http()
      .put(`/api/v1/videos/${nodeId}/progress`)
      .set(viewer.auth)
      .send({ positionSec: -1 })
      .expect(400);

    const poster = await http().get(`/api/v1/videos/${nodeId}/poster`).set(viewer.auth).expect(302);
    expect(poster.headers.location).toContain('X-Amz-Signature');
    const vtt = await http()
      .get(`/api/v1/videos/${nodeId}/sprite.vtt`)
      .set(viewer.auth)
      .expect(200);
    expect(vtt.text).toMatch(/^WEBVTT/);
    expect(vtt.text).toMatch(/https?:\/\/[^\s]+X-Amz-Signature[^\s]*#xywh=0,0,160,90/);
  });

  it('không có đường tải video cho người dùng thường', async () => {
    const { nodeId } = await seedVideo('Không tải.mp4');
    await http().get(`/api/v1/files/${nodeId}/download`).set(owner.auth).expect(403);
    await http().post(`/api/v1/files/${nodeId}/download-link`).set(owner.auth).expect(403);
    await http().get(`/api/v1/admin/videos`).set(owner.auth).expect(403);
    await http().post(`/api/v1/admin/videos/${nodeId}/original-link`).set(owner.auth).expect(403);
  });

  it('System Admin lấy file gốc qua link dùng một lần, có ghi nhật ký', async () => {
    const { nodeId } = await seedVideo('Gốc.mp4');
    const list = await http().get('/api/v1/admin/videos?q=gốc').set(sysadmin.auth).expect(200);
    expect(list.body.map((v: { id: string }) => v.id)).toContain(nodeId);
    const link = await http()
      .post(`/api/v1/admin/videos/${nodeId}/original-link`)
      .set(sysadmin.auth)
      .expect(201);
    const res = await http().get(link.body.url).buffer(true).expect(200);
    expect(
      Buffer.from(res.body as Buffer).equals(original) || res.text === original.toString(),
    ).toBe(true);
    expect(res.headers['content-disposition']).toContain('attachment');
    await http().get(link.body.url).expect(404);
    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'video.original_access', targetId: nodeId },
    });
    expect(log?.actorId).toBe(sysadmin.userId);
  });

  it('video vừa transcode lại: phiên cũ không nhận khoá mới (404, mở phiên mới)', async () => {
    const { nodeId } = await seedVideo('Đổi bản.mp4');
    const old = await play(viewer, nodeId).expect(200);
    await http().get(`/api/v1/videos/${nodeId}/key?s=${old.body.token}`).expect(200);
    const fresh = await ctx.prisma.blob.create({
      data: {
        nodeId,
        kind: 'HLS',
        provider: 'S3',
        container: buckets.hls,
        key: `${nodeId}/moi-test/`,
        sizeBytes: 1n,
        mime: 'application/vnd.apple.mpegurl',
      },
    });
    await ctx.prisma.video.update({ where: { nodeId }, data: { hlsBlobId: fresh.id } });
    await http().get(`/api/v1/videos/${nodeId}/key?s=${old.body.token}`).expect(404);
  });

  it('tạo lại bản xem trước khi đang xử lý → 409 (không chạy trùng job)', async () => {
    const { nodeId } = await seedVideo('Đang chạy.mp4');
    await ctx.prisma.node.update({ where: { id: nodeId }, data: { status: 'PROCESSING' } });
    await http().post(`/api/v1/files/${nodeId}/regenerate`).set(editor.auth).expect(409);
  });

  it('transcode lại: đẩy job, chặn khi đang xử lý; người chỉ xem không được', async () => {
    const { nodeId, versionId } = await seedVideo('Làm lại.mp4');
    await http().post(`/api/v1/videos/${nodeId}/retranscode`).set(viewer.auth).expect(403);
    await http().post(`/api/v1/videos/${nodeId}/retranscode`).set(editor.auth).expect(204);
    const jobs = await videoQueue.getJobs(['waiting', 'prioritized', 'delayed', 'active']);
    expect(jobs.some((j) => j.data.nodeId === nodeId && j.data.versionId === versionId)).toBe(true);
    await http().post(`/api/v1/videos/${nodeId}/retranscode`).set(editor.auth).expect(409);
    const node = await ctx.prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
    expect(node.status).toBe('PROCESSING');
  });

  it('sửa tiêu đề và mô tả: EDITOR được, người xem 403, người ngoài 404, trùng tên 409', async () => {
    const { nodeId } = await seedVideo('Cũ.mp4');
    await seedVideo('đã có');
    const folder = await http()
      .post(`/api/v1/workspaces/${wsId}/folders`)
      .set(editor.auth)
      .send({ name: 'Thư mục video', section: 'VIDEOS' })
      .expect(201);
    const patch = (as: LoggedIn, id: string, body: object) =>
      http().patch(`/api/v1/videos/${id}`).set(as.auth).send(body);
    const info = { title: 'A', description: 'B' };

    const res = await patch(editor, nodeId, {
      title: '  Quy trình  nhập kho ',
      description: ' Các bước nhập kho. ',
    }).expect(200);
    expect(res.body).toMatchObject({
      name: 'Quy trình nhập kho',
      description: 'Các bước nhập kho.',
    });
    const detail = await http().get(`/api/v1/files/${nodeId}`).set(viewer.auth).expect(200);
    expect(detail.body.node.description).toBe('Các bước nhập kho.');

    await patch(viewer, nodeId, info).expect(403);
    await patch(outsider, nodeId, info).expect(404);
    await patch(editor, folder.body.id, info).expect(404);
    const dup = await patch(editor, nodeId, { title: 'Đã có', description: 'x' }).expect(409);
    expect(dup.body.error.details.suggestion).toBe('Đã có (1)');
    await patch(editor, nodeId, { title: 'A', description: '   ' }).expect(400);
    await patch(editor, nodeId, { title: 'A', description: 'x'.repeat(5001) }).expect(400);
    await patch(editor, nodeId, { title: 'A' }).expect(400);

    const log = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { targetId: nodeId, action: 'video.update_info' },
    });
    expect(log.metadata).toMatchObject({
      from: 'Cũ.mp4',
      to: 'Quy trình nhập kho',
      descriptionChanged: true,
    });
  });
});
