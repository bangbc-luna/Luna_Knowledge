import type { ApiOk } from "./api-types";

export type NodeItem = ApiOk<"/api/v1/nodes/{id}", "get">;
export type UserSummary = ApiOk<"/api/v1/users", "get">[number];
export type Me = ApiOk<"/api/v1/me", "get">;
export type Workspace = ApiOk<"/api/v1/workspaces/{wsId}", "get">;
export type Member = ApiOk<"/api/v1/workspaces/{wsId}/members", "get">[number];
export type Tag = NodeItem["tags"][number];

export type WorkspaceRole = Member["role"];
export type WorkspaceKind = Workspace["kind"];
export type ContentRole = NodeItem["myRole"];
export type NodeSection = NodeItem["section"];
export type NodeType = NodeItem["type"];
export type ShareRole = Share["role"];

export type MeWorkspace = Me["workspaces"][number];

export type FileDetail = ApiOk<"/api/v1/files/{id}", "get">;
export type FileDuplicate = FileDetail["duplicates"][number];
export type FileVersion = ApiOk<"/api/v1/files/{id}/versions", "get">[number];
export type FilePreview = ApiOk<"/api/v1/files/{id}/preview", "get">;
export type PreviewKind = FileVersion["previewKind"];

export interface NodeEvent {
  nodeId: string;
  status: NodeItem["status"];
  versionId?: string;
  error?: string;
  progress?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type Share = ApiOk<"/api/v1/nodes/{id}/shares/{shareId}", "patch">;
export type TrashItem = ApiOk<"/api/v1/workspaces/{wsId}/trash", "get">[number];
export type AdminUser = ApiOk<"/api/v1/admin/users/{id}", "patch">;
export type AuditItem = Omit<ApiOk<"/api/v1/admin/audit-logs", "get">["items"][number], "metadata"> & {
  metadata: Record<string, unknown> | null;
};
export type AdminStats = ApiOk<"/api/v1/admin/stats", "get">;
export type AdminVideo = ApiOk<"/api/v1/admin/videos", "get">[number];

export type VideoDetail = ApiOk<"/api/v1/videos/{id}", "get">;
export type VideoRendition = NonNullable<VideoDetail["video"]>["renditions"][number];
export type Playback = ApiOk<"/api/v1/videos/{id}/playback", "post">;

export type ActivityItem = ApiOk<"/api/v1/nodes/{id}/activity", "get">["items"][number];
