import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const API = `${process.env.API ?? 'http://localhost:4000'}/api/v1`;
const CLIENTS = Number(process.env.CLIENTS ?? 20);
const SECONDS = Number(process.env.SECONDS ?? 60);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 500);
const RUN = `${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const devToken = async (email: string) => (await call<{ accessToken: string }>('POST', '/dev/token', undefined, { email })).accessToken;

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

const lead = await devToken(`load.collab.lead.${RUN}@lunatech.vn`);
const emails = Array.from({ length: CLIENTS }, (_, i) => `load.collab.u${i}.${RUN}@lunatech.vn`);
const ws = await call<{ id: string }>('POST', '/workspaces', lead, { name: `Collab load ${RUN}`, slug: `collab-load-${RUN}`, memberEmails: emails });
const doc = await call<{ node: { id: string } }>('POST', `/workspaces/${ws.id}/documents`, lead, { name: 'Tài liệu tải cao' });
const tokens: string[] = [];
for (const e of emails) {
  tokens.push(await devToken(e));
  await sleep(550);
}

const latencies: number[] = [];
let sent = 0;
const clients = await Promise.all(
  tokens.map(async (tok, idx) => {
    const ydoc = new Y.Doc();
    const first = await call<{ url: string; documentName: string }>('GET', `/documents/${doc.node.id}/collab-token`, tok);
    const provider = new HocuspocusProvider({
      url: first.url,
      name: first.documentName,
      document: ydoc,
      token: async () => (await call<{ token: string }>('GET', `/documents/${doc.node.id}/collab-token`, tok)).token,
    });
    await new Promise<void>((resolve, reject) => {
      provider.on('synced', () => resolve());
      provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)));
    });
    const probe = ydoc.getMap<number>('loadprobe');
    probe.observe((event) => {
      if (event.transaction.local) return;
      const now = Date.now();
      for (const key of event.keysChanged) {
        const ts = probe.get(key);
        if (typeof ts === 'number') latencies.push(now - ts);
      }
    });
    return { idx, ydoc, provider, probe };
  }),
);

console.log(`${CLIENTS} clients connected to ${doc.node.id}; typing for ${SECONDS}s every ${INTERVAL_MS}ms each`);
const end = Date.now() + SECONDS * 1000;
await Promise.all(
  clients.map(async (c) => {
    await sleep(Math.random() * INTERVAL_MS);
    let n = 0;
    while (Date.now() < end) {
      c.ydoc.transact(() => {
        const para = new Y.XmlElement('paragraph');
        para.insert(0, [new Y.XmlText(`Người ${c.idx} gõ dòng ${n++}`)]);
        c.ydoc.getXmlFragment('default').push([para]);
        c.probe.set(`${c.idx}`, Date.now());
      });
      sent++;
      await sleep(INTERVAL_MS);
    }
  }),
);
await sleep(2000);

const texts = new Set(clients.map((c) => c.ydoc.getXmlFragment('default').length));
latencies.sort((a, b) => a - b);
const result = {
  clients: CLIENTS,
  edits: sent,
  deliveries: latencies.length,
  expectedDeliveries: sent * (CLIENTS - 1),
  converged: texts.size === 1,
  paragraphs: [...texts][0],
  p50: percentile(latencies, 50),
  p95: percentile(latencies, 95),
  p99: percentile(latencies, 99),
  max: latencies.at(-1) ?? 0,
};
console.log(JSON.stringify(result, null, 2));
for (const c of clients) c.provider.destroy();
await call('DELETE', `/workspaces/${ws.id}`, lead).catch(() => undefined);
process.exit(result.converged && result.p95 < 200 ? 0 : 1);
