import { HocuspocusProvider } from '@hocuspocus/provider';
import { readFile } from 'node:fs/promises';
import * as Y from 'yjs';

const API = `${process.env.API ?? 'http://localhost:4000'}/api/v1`;
const CLIENTS = Number(process.env.CLIENTS ?? 20);
const SECONDS = Number(process.env.SECONDS ?? 60);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 500);
const DOCS = Math.max(1, Number(process.env.DOCS ?? 1));
const SEED_FILE = process.env.SEED_FILE;
const P95_MAX_MS = process.env.P95_MAX_MS ? Number(process.env.P95_MAX_MS) : undefined;
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

let lead: string;
let tokens: string[];
let wsId: string;
let ownsWorkspace = false;
if (SEED_FILE) {
  const seed = JSON.parse(await readFile(SEED_FILE, 'utf8')) as {
    wsId: string;
    lead: string;
    editors: string[];
  };
  lead = seed.lead;
  wsId = seed.wsId;
  tokens = Array.from({ length: CLIENTS }, (_, i) => seed.editors[i % seed.editors.length]!);
} else {
  lead = await devToken(`load.collab.lead.${RUN}@lunatech.vn`);
  const emails = Array.from({ length: CLIENTS }, (_, i) => `load.collab.u${i}.${RUN}@lunatech.vn`);
  const ws = await call<{ id: string }>('POST', '/workspaces', lead, { name: `Collab load ${RUN}`, slug: `collab-load-${RUN}`, memberEmails: emails });
  wsId = ws.id;
  ownsWorkspace = true;
  tokens = [];
  for (const e of emails) {
    tokens.push(await devToken(e));
    await sleep(550);
  }
}
const docs: string[] = [];
for (let d = 0; d < DOCS; d++) {
  const created = await call<{ node: { id: string } }>('POST', `/workspaces/${wsId}/documents`, lead, { name: `Tài liệu tải cao ${RUN} ${d}` });
  docs.push(created.node.id);
}

const latencies: number[] = [];
let sent = 0;
const clients = await Promise.all(
  tokens.map(async (tok, idx) => {
    const docId = docs[idx % DOCS]!;
    const ydoc = new Y.Doc();
    const first = await call<{ url: string; documentName: string }>('GET', `/documents/${docId}/collab-token`, tok);
    const provider = new HocuspocusProvider({
      url: first.url,
      name: first.documentName,
      document: ydoc,
      token: async () => (await call<{ token: string }>('GET', `/documents/${docId}/collab-token`, tok)).token,
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

console.log(`${CLIENTS} clients connected to ${DOCS} document(s); typing for ${SECONDS}s every ${INTERVAL_MS}ms each`);
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

const perDoc = new Map<number, Set<number>>();
for (const c of clients) {
  const set = perDoc.get(c.idx % DOCS) ?? new Set<number>();
  set.add(c.ydoc.getXmlFragment('default').length);
  perDoc.set(c.idx % DOCS, set);
}
const texts = new Set([...perDoc.values()].flatMap((set) => [...set]));
const converged = [...perDoc.values()].every((set) => set.size === 1);
latencies.sort((a, b) => a - b);
const result = {
  clients: CLIENTS,
  edits: sent,
  deliveries: latencies.length,
  expectedDeliveries: DOCS === 1 ? sent * (CLIENTS - 1) : undefined,
  converged,
  paragraphs: DOCS === 1 ? [...texts][0] : undefined,
  p50: percentile(latencies, 50),
  p95: percentile(latencies, 95),
  p99: percentile(latencies, 99),
  max: latencies.at(-1) ?? 0,
};
console.log(JSON.stringify(result, null, 2));
for (const c of clients) c.provider.destroy();
if (ownsWorkspace) await call('DELETE', `/workspaces/${wsId}`, lead).catch(() => undefined);
process.exit(result.converged && result.p95 < (P95_MAX_MS ?? 200) ? 0 : 1);
