import { ApiError, api, authHeaders, refreshSession } from "./api";
import type { NodeItem, UserSummary } from "./types";

export type DocJSON = { type: string; attrs?: Record<string, unknown>; content?: DocJSON[]; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; text?: string };

export interface DocumentDetail {
  node: NodeItem;
  contentJson: DocJSON;
  wordCount: number;
  lastEditedAt: string | null;
  lastEditedBy: UserSummary | null;
  versionCount: number;
  readOnly: boolean;
}

export interface CollabToken {
  token: string;
  documentName: string;
  url: string;
  readOnly: boolean;
  expiresAt: string;
  user: { id: string; name: string };
}

export interface DocAsset {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  url: string;
  isImage: boolean;
}

export interface DocVersion {
  id: string;
  versionNo: number;
  name: string | null;
  isAuto: boolean;
  wordCount: number;
  wordsAdded: number;
  wordsRemoved: number;
  createdAt: string;
  createdBy: UserSummary | null;
  restoredFrom: { id: string; versionNo: number } | null;
}

export interface DocVersionDetail extends DocVersion {
  contentJson: DocJSON;
  html: string;
}

export interface DocDiff {
  from: { id: string; versionNo: number };
  to: { id: string; versionNo: number | null };
  stats: { added: number; removed: number };
  parts: Array<{ type: "added" | "removed" | "same"; text: string }>;
}

export interface DocComment {
  id: string;
  body: string;
  author: UserSummary;
  mentions: UserSummary[];
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface DocThread {
  id: string;
  quotedText: string;
  status: "OPEN" | "RESOLVED";
  createdBy: UserSummary;
  createdAt: string;
  resolvedBy: UserSummary | null;
  resolvedAt: string | null;
  canResolve: boolean;
  comments: DocComment[];
  ignoredMentions?: string[];
}

export interface AppNotification {
  id: string;
  type: "comment.mention" | "comment.new" | "share.added" | "video.ready" | "video.failed" | string;
  payload: {
    nodeId?: string;
    nodeName?: string;
    nodeType?: NodeItem["type"];
    workspaceId?: string;
    threadId?: string;
    byName?: string;
    snippet?: string;
    role?: string;
    error?: string;
  };
  readAt: string | null;
  createdAt: string;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const UNTITLED = "Tài liệu không tên";
export const docHref = (wsId: string, nodeId: string) => `/w/${wsId}/doc/${nodeId}`;

export async function uploadAsset(nodeId: string, file: File): Promise<DocAsset> {
  const form = new FormData();
  form.append("file", file);
  const send = () => fetch(`/api/v1/documents/${nodeId}/assets`, { method: "POST", credentials: "same-origin", headers: authHeaders(), body: form });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? `HTTP_${res.status}`, assetError(res.status, body?.error?.message ?? res.statusText));
  }
  return (await res.json()) as DocAsset;
}

function assetError(status: number, fallback: string) {
  if (status === 413) return "Ảnh lớn hơn 20 MB";
  if (status === 415) return "Chỉ chèn được ảnh PNG, JPG, GIF, WebP";
  return fallback;
}

export async function createDocument(wsId: string, parentId: string | null, name = UNTITLED): Promise<DocumentDetail> {
  try {
    return await api<DocumentDetail>(`/workspaces/${wsId}/documents`, { method: "POST", body: { name, parentId } });
  } catch (err) {
    const suggestion = err instanceof ApiError && err.status === 409 ? (err.details as { suggestion?: string } | undefined)?.suggestion : undefined;
    if (suggestion) return api<DocumentDetail>(`/workspaces/${wsId}/documents`, { method: "POST", body: { name: suggestion, parentId } });
    throw err;
  }
}

const CARET_COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f"];
export function userColor(id: string) {
  return CARET_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % CARET_COLORS.length]!;
}
