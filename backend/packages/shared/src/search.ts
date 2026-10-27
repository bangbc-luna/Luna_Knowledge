import { Meilisearch } from 'meilisearch';

export const SEARCH_INDEX = 'nodes';
export const SEARCH_INDEX_BUILD = 'nodes_rebuild';
export const SEARCH_CONTENT_MAX = 100_000;

export const SEARCH_JOBS = {
  INDEX_NODE: 'index-node',
  INDEX_TREE: 'index-tree',
  DROP_WORKSPACE: 'drop-workspace',
  REINDEX_ALL: 'reindex-all',
} as const;

export interface SearchDoc {
  id: string;
  workspaceId: string;
  section: 'DOCS' | 'VIDEOS';
  type: 'FOLDER' | 'DOCUMENT' | 'FILE' | 'VIDEO';
  name: string;
  nameAscii: string;
  contentAscii: string;
  tagIds: string[];
  tagsAscii: string;
  createdById: string;
  updatedAt: number;
  acl: string[];
}

export const searchSettings = {
  searchableAttributes: ['nameAscii', 'tagsAscii', 'contentAscii'],
  filterableAttributes: [
    'workspaceId',
    'section',
    'type',
    'tagIds',
    'createdById',
    'updatedAt',
    'acl',
  ],
  sortableAttributes: ['updatedAt'],
  displayedAttributes: [
    'id',
    'workspaceId',
    'type',
    'name',
    'nameAscii',
    'tagsAscii',
    'contentAscii',
  ],
};

export const aclForWorkspace = (workspaceId: string) => `ws:${workspaceId}`;
export const aclForUser = (userId: string) => `user:${userId}`;

export function foldVietnamese(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (code < 128) {
      out += ch;
      continue;
    }
    if (ch === 'đ') {
      out += 'd';
      continue;
    }
    if (ch === 'Đ') {
      out += 'D';
      continue;
    }
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += base.length === 1 && base.charCodeAt(0) < 128 ? base : ' ';
  }
  return out;
}

export function createSearchClient(url: string, apiKey: string) {
  return new Meilisearch({ host: url, apiKey });
}

export interface QueryDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

interface Row {
  id: string;
  workspace_id: string;
  section: SearchDoc['section'];
  type: SearchDoc['type'];
  name: string;
  created_by: string;
  updated_at: Date;
  content: string | null;
  tag_ids: string[] | null;
  tag_names: string[] | null;
  share_users: string[] | null;
}

export async function loadSearchDocs(db: QueryDb, ids: string[]): Promise<SearchDoc[]> {
  if (!ids.length) return [];
  const rows = await db.$queryRaw<Row[]>`
    SELECT n.id, n.workspace_id, n.section::text AS section, n.type::text AS type, n.name,
           n.created_by, n.updated_at,
           concat_ws(E'\n', n.description, COALESCE(d.content_text, f.extracted_text)) AS content,
           (SELECT array_agg(t.id) FROM node_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.node_id = n.id) AS tag_ids,
           (SELECT array_agg(t.name) FROM node_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.node_id = n.id) AS tag_names,
           (SELECT array_agg(DISTINCT s.user_id) FROM node_shares s JOIN nodes a ON a.id = s.node_id
             WHERE a.path @> n.path) AS share_users
      FROM nodes n
      JOIN workspaces w ON w.id = n.workspace_id AND w.deleted_at IS NULL
      LEFT JOIN documents d ON d.node_id = n.id
      LEFT JOIN files f ON f.node_id = n.id
     WHERE n.id = ANY(${ids}::uuid[]) AND n.deleted_at IS NULL AND n.status <> 'UPLOADING'`;
  return rows.map((r) => {
    const name = r.name.normalize('NFC');
    const content = (r.content ?? '').normalize('NFC').slice(0, SEARCH_CONTENT_MAX);
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      section: r.section,
      type: r.type,
      name,
      nameAscii: foldVietnamese(name),
      contentAscii: foldVietnamese(content),
      tagIds: r.tag_ids ?? [],
      tagsAscii: foldVietnamese((r.tag_names ?? []).join(' ')),
      createdById: r.created_by,
      updatedAt: Math.floor(r.updated_at.getTime() / 1000),
      acl: [aclForWorkspace(r.workspace_id), ...(r.share_users ?? []).map(aclForUser)],
    };
  });
}
