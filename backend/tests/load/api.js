import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';

const API = `${__ENV.API ?? 'http://localhost:4000'}/api/v1`;
const USERS = Number(__ENV.USERS ?? 200);
const RUN = __ENV.RUN ?? `${Date.now()}`;
const TERMS = ['nghi phep', 'noi quy', 'so tay', 'bao cao', 'quy trinh', 'hop dong', 'an toan thong tin', 'bieu mau'];

export const options = {
  setupTimeout: '5m',
  scenarios: {
    office: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: USERS },
        { duration: __ENV.HOLD ?? '1m', target: USERS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:crud}': ['p(95)<200'],
    'http_req_duration{kind:search}': ['p(95)<300'],
    checks: ['rate>0.99'],
  },
};

const json = (token) => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });

function token(email, name) {
  const res = http.post(`${API}/dev/token`, JSON.stringify({ email, name }), { headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 200) throw new Error(`dev token ${email}: ${res.status}`);
  return res.json('accessToken');
}

export function setup() {
  const lead = token(`load.lead.${RUN}@lunatech.vn`, 'Load Lead');
  const emails = Array.from({ length: USERS }, (_, i) => `load.u${i}.${RUN}@lunatech.vn`);
  const ws = http.post(`${API}/workspaces`, JSON.stringify({ name: `Load ${RUN}`, slug: `load-${RUN}`, memberEmails: emails }), json(lead));
  if (ws.status !== 201) throw new Error(`create workspace: ${ws.status} ${ws.body}`);
  const wsId = ws.json('id');
  const root = http.post(`${API}/workspaces/${wsId}/folders`, JSON.stringify({ name: 'Báo cáo dự án' }), json(lead)).json('id');
  for (let i = 0; i < 20; i++) {
    http.post(`${API}/workspaces/${wsId}/folders`, JSON.stringify({ name: `Hợp đồng ${i}`, parentId: root }), json(lead));
  }
  const tokens = emails.map((e, i) => {
    sleep(0.55);
    return token(e, `Load ${i}`);
  });
  return { wsId, root, tokens };
}

export default function (data) {
  const vu = exec.vu.idInTest - 1;
  const auth = json(data.tokens[vu % data.tokens.length]);
  const crud = { ...auth, tags: { kind: 'crud' } };
  const n = `${vu}-${exec.vu.iterationInScenario}`;

  group('duyệt thư mục', () => {
    const list = http.get(`${API}/workspaces/${data.wsId}/nodes?parentId=${data.root}&limit=50`, crud);
    check(list, { 'list 200': (r) => r.status === 200 });
    const node = http.get(`${API}/nodes/${data.root}`, crud);
    check(node, { 'node 200': (r) => r.status === 200 });
    const crumbs = http.get(`${API}/nodes/${data.root}/breadcrumb`, crud);
    check(crumbs, { 'breadcrumb 200': (r) => r.status === 200 });
  });
  sleep(1);

  group('tạo, đổi tên, xoá', () => {
    const created = http.post(`${API}/workspaces/${data.wsId}/folders`, JSON.stringify({ name: `Nháp ${n}`, parentId: data.root }), crud);
    if (!check(created, { 'create 201': (r) => r.status === 201 })) return;
    const id = created.json('id');
    const renamed = http.patch(`${API}/nodes/${id}`, JSON.stringify({ name: `Nháp đã sửa ${n}` }), crud);
    check(renamed, { 'rename 200': (r) => r.status === 200 });
    const removed = http.del(`${API}/nodes/${id}`, null, crud);
    check(removed, { 'delete 204': (r) => r.status === 204 });
  });
  sleep(1);

  group('tìm kiếm', () => {
    const term = TERMS[(vu + exec.vu.iterationInScenario) % TERMS.length];
    const res = http.get(`${API}/search?q=${encodeURIComponent(term)}&limit=20`, { ...auth, tags: { kind: 'search' } });
    check(res, { 'search 200': (r) => r.status === 200 });
  });
  sleep(2);
}

export function teardown(data) {
  const lead = token(`load.lead.${RUN}@lunatech.vn`, 'Load Lead');
  http.del(`${API}/workspaces/${data.wsId}`, null, json(lead));
}
