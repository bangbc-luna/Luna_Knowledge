import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API ?? 'http://localhost:4000';
const VIDEO = __ENV.VIDEO_ID;
const RENDITION = __ENV.RENDITION ?? '1080p';
const SEGMENTS = Number(__ENV.SEGMENTS ?? 20);

export const options = {
  scenarios: {
    viewers: { executor: 'per-vu-iterations', vus: Number(__ENV.VUS ?? 50), iterations: 1, maxDuration: '5m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:api}': ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const res = http.post(`${API}/api/v1/dev/token`, JSON.stringify({ email: __ENV.EMAIL ?? 'qa.owner@lunatech.vn' }), {
    headers: { 'Content-Type': 'application/json' },
  });
  return { token: res.json('accessToken') };
}

export default function ({ token }) {
  const api = { tags: { kind: 'api' } };
  const pb = http.post(`${API}/api/v1/videos/${VIDEO}/playback`, null, { headers: { Authorization: `Bearer ${token}` }, ...api });
  check(pb, { 'playback 200': (r) => r.status === 200 });
  const s = pb.json('token');
  const master = http.get(`${API}/api/v1/videos/${VIDEO}/hls/master.m3u8?s=${s}`, api);
  check(master, { 'master 200': (r) => r.status === 200 });
  const media = http.get(`${API}/api/v1/videos/${VIDEO}/hls/${RENDITION}/index.m3u8?s=${s}`, api);
  check(media, { 'media 200': (r) => r.status === 200 });
  const key = http.get(`${API}/api/v1/videos/${VIDEO}/key?s=${s}`, { ...api, responseType: 'binary' });
  check(key, { 'key 16 byte': (r) => r.status === 200 && r.body.byteLength === 16 });
  const segs = media.body.split('\n').filter((l) => l.includes('.ts?s=')).slice(0, SEGMENTS);
  for (const seg of segs) {
    const r = http.get(`${API}${seg}`, { tags: { kind: 'segment' }, responseType: 'none' });
    check(r, { 'segment 200': (x) => x.status === 200 });
    sleep(1);
  }
}
