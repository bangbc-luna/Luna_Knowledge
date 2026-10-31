import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE ?? 'https://knowledge.lunatech.test';
const API = `${BASE}/api/v1`;
const VIDEO_ID = __ENV.VIDEO_ID;
const TRANSCODE_ID = __ENV.TRANSCODE_ID;
const VIEWERS_LAN = Number(__ENV.VIEWERS_LAN ?? 100);
const VIEWERS_TUNNEL = Number(__ENV.VIEWERS_TUNNEL ?? 50);
const EDITORS = Number(__ENV.EDITORS ?? 30);
const SEGMENTS = Number(__ENV.SEGMENTS ?? 50);
const HOLD = __ENV.HOLD ?? '6m';

const seed = JSON.parse(open('/load/.seed.json'));
if (!seed.lead || !seed.wsId) throw new Error('seed has no lead token or wsId');
if (!Array.isArray(seed.viewers) || seed.viewers.length < VIEWERS_LAN + VIEWERS_TUNNEL) {
  throw new Error(
    `seed has ${seed.viewers ? seed.viewers.length : 0} viewers, need VIEWERS_LAN + VIEWERS_TUNNEL = ${VIEWERS_LAN + VIEWERS_TUNNEL}`,
  );
}
if (!Array.isArray(seed.editors) || seed.editors.length < EDITORS) {
  throw new Error(`seed has ${seed.editors ? seed.editors.length : 0} editors, need EDITORS = ${EDITORS}`);
}
const badStatus = new Counter('bad_status');
const TERMS = ['nghi phep', 'noi quy', 'so tay', 'bao cao', 'quy trinh', 'hop dong'];

export const options = {
  insecureSkipTLSVerify: true,
  setupTimeout: '2m',
  scenarios: {
    viewers_lan: {
      executor: 'per-vu-iterations',
      exec: 'viewer',
      vus: VIEWERS_LAN,
      iterations: 1,
      maxDuration: `${durationMinutes(HOLD) + 2}m`,
      env: { VIA: 'lan' },
    },
    viewers_tunnel: {
      executor: 'per-vu-iterations',
      exec: 'viewer',
      vus: VIEWERS_TUNNEL,
      iterations: 1,
      maxDuration: `${durationMinutes(HOLD) + 2}m`,
      env: { VIA: 'tunnel' },
    },
    editors: {
      executor: 'constant-vus',
      exec: 'editor',
      vus: EDITORS,
      duration: HOLD,
    },
  },
  thresholds: {
    bad_status: ['count==0'],
    'http_req_duration{kind:api}': ['p(95)<300'],
    'http_req_duration{kind:segment}': ['p(95)<300'],
    checks: ['rate>0.99'],
  },
};

function durationMinutes(text) {
  const m = /^(\d+)(s|m|h)$/.exec(text);
  if (!m) throw new Error(`HOLD must look like 30s, 6m or 1h, got "${text}"`);
  const n = Number(m[1]);
  if (m[2] === 'h') return n * 60;
  if (m[2] === 'm') return n;
  return Math.ceil(n / 60);
}

function track(res) {
  if (res.status === 429 || res.status >= 500) badStatus.add(1);
  return res;
}

function auth(token, extra) {
  return { headers: { Authorization: `Bearer ${token}`, ...extra } };
}

function get(url, params) {
  return track(http.get(url, params));
}

function post(url, body, params) {
  return track(http.post(url, body, params));
}

export function setup() {
  const res = post(`${API}/videos/${TRANSCODE_ID}/retranscode`, null, auth(seed.lead));
  check(res, { 'retranscode 204': (r) => r.status === 204 });
  let docId;
  const list = get(`${API}/workspaces/${seed.wsId}/nodes?type=DOCUMENT&limit=1`, auth(seed.lead));
  const items = list.status === 200 ? list.json('items') : [];
  if (items.length > 0) {
    docId = items[0].id;
  } else {
    const created = post(
      `${API}/workspaces/${seed.wsId}/documents`,
      JSON.stringify({ name: 'Load peak document' }),
      auth(seed.lead, { 'Content-Type': 'application/json' }),
    );
    docId = created.json('node.id');
  }
  return { docId };
}

export function viewer() {
  const tunnel = __ENV.VIA === 'tunnel';
  const vu = exec.scenario.iterationInTest;
  const token = seed.viewers[(tunnel ? VIEWERS_LAN : 0) + vu];
  const ip = `198.51.100.${(vu % 250) + 1}`;
  const edge = tunnel ? { 'Cf-Connecting-IP': ip, 'X-Forwarded-For': ip } : {};
  const api = { tags: { kind: 'api' }, headers: { Authorization: `Bearer ${token}`, ...edge } };
  const anon = { tags: { kind: 'api' }, headers: edge };

  const pb = post(`${API}/videos/${VIDEO_ID}/playback`, null, api);
  const ok = check(pb, { 'playback 200': (r) => r.status === 200 });
  if (!ok) return;
  const body = pb.json();
  check(body, {
    'maxHeight matches path': (b) => (tunnel ? b.maxHeight === 720 : b.maxHeight === null),
  });
  const s = body.token;
  const rendition = tunnel ? '720p' : '1080p';

  const master = get(`${API}/videos/${VIDEO_ID}/hls/master.m3u8?s=${s}`, anon);
  check(master, { 'master 200': (r) => r.status === 200 });
  const media = get(`${API}/videos/${VIDEO_ID}/hls/${rendition}/index.m3u8?s=${s}`, anon);
  check(media, { 'media 200': (r) => r.status === 200 });
  const key = get(`${API}/videos/${VIDEO_ID}/key?s=${s}`, { ...anon, responseType: 'binary' });
  check(key, { 'key 16 byte': (r) => r.status === 200 && r.body.byteLength === 16 });
  if (media.status !== 200) return;

  const segs = media.body
    .split('\n')
    .filter((l) => l.startsWith('/api/') && l.includes('.ts?s='))
    .slice(0, SEGMENTS);
  for (let i = 0; i < segs.length; i++) {
    const r = get(`${BASE}${segs[i]}`, { tags: { kind: 'segment' }, headers: edge, responseType: 'none' });
    check(r, { 'segment 200': (x) => x.status === 200 });
    if (i < segs.length - 1) sleep(6);
  }
}

export function editor(data) {
  const token = seed.editors[(exec.vu.idInTest - 1) % seed.editors.length];
  const params = { ...auth(token), tags: { kind: 'api' } };
  const list = get(`${API}/workspaces/${seed.wsId}/nodes`, params);
  check(list, { 'list 200': (r) => r.status === 200 });
  const doc = get(`${API}/documents/${data.docId}`, params);
  check(doc, { 'document 200': (r) => r.status === 200 });
  const collab = get(`${API}/documents/${data.docId}/collab-token`, params);
  check(collab, { 'collab token 200': (r) => r.status === 200 });
  const term = TERMS[Math.floor(Math.random() * TERMS.length)];
  const found = get(`${API}/search?q=${encodeURIComponent(term)}&workspaceId=${seed.wsId}`, params);
  check(found, { 'search 200': (r) => r.status === 200 });
  sleep(5);
}
