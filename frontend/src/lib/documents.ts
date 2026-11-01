import { ApiError, api, authHeaders, refreshSession } from "./api";
import type { ApiOk } from "./api-types";
import type { NodeItem } from "./types";

export type DocJSON = { type: string; attrs?: Record<string, unknown>; content?: DocJSON[]; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; text?: string };

type DocumentGen = ApiOk<"/api/v1/documents/{id}", "get">;
type DocVersionDetailGen = ApiOk<"/api/v1/documents/{id}/versions/{vid}", "get">;

export type DocumentDetail = Omit<DocumentGen, "contentJson"> & { contentJson: DocJSON };
export type DocumentFormat = DocumentDetail["format"];
export type CollabToken = ApiOk<"/api/v1/documents/{id}/collab-token", "get">;
export type DocAsset = ApiOk<"/api/v1/documents/{id}/assets", "get">[number];
export type DocVersion = ApiOk<"/api/v1/documents/{id}/versions", "get">[number];
export type DocVersionDetail = Omit<DocVersionDetailGen, "contentJson"> & { contentJson: DocJSON };
export type DocDiff = ApiOk<"/api/v1/documents/{id}/versions/{vid}/diff", "get">;
export type DocThread = ApiOk<"/api/v1/documents/{id}/threads", "get">[number] & { ignoredMentions?: string[] };
export type DocComment = DocThread["comments"][number];
type NotificationGen = ApiOk<"/api/v1/me/notifications", "get">["items"][number];

export type AppNotification = Omit<NotificationGen, "payload"> & {
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
};

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

export async function createDocument(wsId: string, parentId: string | null, name = UNTITLED, format: DocumentFormat = "RICH"): Promise<DocumentDetail> {
  try {
    return await api<DocumentDetail>(`/workspaces/${wsId}/documents`, { method: "POST", body: { name, parentId, format } });
  } catch (err) {
    const suggestion = err instanceof ApiError && err.status === 409 ? (err.details as { suggestion?: string } | undefined)?.suggestion : undefined;
    if (suggestion) return api<DocumentDetail>(`/workspaces/${wsId}/documents`, { method: "POST", body: { name: suggestion, parentId, format } });
    throw err;
  }
}

const CARET_COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f"];
export function userColor(id: string) {
  return CARET_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % CARET_COLORS.length]!;
}
