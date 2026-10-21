import { open, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { ruleForFileName } from '@luna/shared';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ws: { type: 'string' },
    parent: { type: 'string' },
    replace: { type: 'string' },
    email: { type: 'string', default: 'qa.owner@lunatech.vn' },
    api: { type: 'string', default: 'http://localhost:4000' },
  },
});
const path = positionals[0];
if (!path) {
  console.error('Usage: pnpm upload <file> [--ws id|slug] [--parent folderId] [--replace nodeId]');
  process.exit(1);
}
const base = `${values.api}/api/v1`;

async function call<T>(method: string, url: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok)
    throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json?.error ?? json)}`);
  return json as T;
}

const { accessToken: token } = await call<{ accessToken: string }>(
  'POST',
  '/dev/token',
  undefined,
  {
    email: values.email,
  },
);
const me = await call<{ workspaces: { id: string; slug: string; name: string; role: string }[] }>(
  'GET',
  '/me',
  token,
);
const ws = values.ws
  ? me.workspaces.find((w) => w.id === values.ws || w.slug === values.ws)
  : me.workspaces.find((w) => w.role !== 'VIEWER');
if (!ws) throw new Error(`Workspace not found for ${values.email}`);

const { size } = await stat(path);
const fileName = basename(path);
const kind = ruleForFileName(fileName)?.category === 'video' ? 'VIDEO' : 'FILE';
console.log(
  `↑ ${fileName} (${(size / 1024 / 1024).toFixed(2)} MB) → ${ws.name} as ${values.email}`,
);

interface Part {
  partNumber: number;
  url: string;
}
const upload = await call<{
  uploadId: string;
  nodeId: string;
  partSize: number;
  partCount: number;
  parts: Part[];
}>('POST', `/workspaces/${ws.id}/uploads`, token, {
  fileName,
  size,
  kind,
  parentId: values.parent,
  replaceNodeId: values.replace,
});

const fh = await open(path, 'r');
try {
  const urls = new Map(upload.parts.map((p) => [p.partNumber, p.url]));
  for (let n = 1; n <= upload.partCount; n++) {
    if (!urls.has(n)) {
      const more = await call<{ parts: Part[] }>(
        'GET',
        `/uploads/${upload.uploadId}/parts?from=${n}`,
        token,
      );
      for (const p of more.parts) urls.set(p.partNumber, p.url);
    }
    const start = (n - 1) * upload.partSize;
    const length = Math.min(upload.partSize, size - start);
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    const res = await fetch(urls.get(n)!, { method: 'PUT', body: buf });
    if (!res.ok) throw new Error(`PUT part ${n} → ${res.status} ${await res.text()}`);
    process.stdout.write(`\r  part ${n}/${upload.partCount}`);
  }
  process.stdout.write('\n');
} finally {
  await fh.close();
}

await call('POST', `/uploads/${upload.uploadId}/complete`, token, {});
for (let i = 0; i < (kind === 'VIDEO' ? 300 : 120); i++) {
  const file = await call<{
    node: { status: string };
    processingError: string | null;
    currentVersion: { versionNo: number; mime: string; previewKind: string; sha256: string } | null;
  }>('GET', `/files/${upload.nodeId}`, token);
  if (file.node.status !== 'PROCESSING') {
    console.log(`✓ ${file.node.status}  node=${upload.nodeId}`);
    if (file.currentVersion) {
      const v = file.currentVersion;
      console.log(
        `  v${v.versionNo} ${v.mime} preview=${v.previewKind} sha256=${v.sha256.slice(0, 16)}…`,
      );
    }
    if (file.processingError) console.log(`  note: ${file.processingError}`);
    process.exit(file.node.status === 'FAILED' ? 2 : 0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(
  `… vẫn đang xử lý (video dài thì transcode lâu): node=${upload.nodeId}, theo dõi GET /api/v1/nodes/${upload.nodeId}/events`,
);
