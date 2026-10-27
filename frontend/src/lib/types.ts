export type WorkspaceRole = "ADMIN" | "MEMBER" | "VIEWER";
export type WorkspaceKind = "COMPANY" | "TEAM";
export type ContentRole = "VIEWER" | "EDITOR" | "OWNER";
export type NodeSection = "DOCS" | "VIDEOS";
export type ShareRole = "EDITOR" | "VIEWER";
export type NodeType = "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface Me extends UserSummary {
  isSystemAdmin: boolean;
  workspaces: Array<{ id: string; name: string; slug: string; icon: string | null; kind: WorkspaceKind; role: WorkspaceRole }>;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  kind: WorkspaceKind;
  createdAt: string;
  memberCount: number;
  myRole: WorkspaceRole | null;
}

export interface Member {
  user: UserSummary;
  role: WorkspaceRole;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface NodeItem {
  id: string;
  workspaceId: string;
  parentId: string | null;
  type: NodeType;
  section: NodeSection;
  name: string;
  description: string | null;
  status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
  createdBy: UserSummary;
  createdAt: string;
  updatedAt: string;
  myRole: ContentRole;
  isFavorite: boolean;
  tags: Tag[];
  childCount: number | null;
  size: number | null;
  mime: string | null;
}

export type PreviewKind = "pdf" | "image" | "text" | "none";

export interface FileVersion {
  id: string;
  versionNo: number;
  fileName: string;
  size: number;
  mime: string;
  sha256: string | null;
  previewKind: PreviewKind;
  hasThumbnail: boolean;
  uploadedBy: UserSummary;
  createdAt: string;
  isCurrent: boolean;
}

export interface FileDetail {
  node: NodeItem;
  currentVersion: FileVersion | null;
  versionCount: number;
  processingError: string | null;
  canDownload: boolean;
  duplicates: FileDuplicate[];
}

export interface FileDuplicate {
  id: string;
  name: string;
  type: "FILE" | "VIDEO";
  section: NodeSection;
  workspace: { id: string; name: string };
}

export interface FilePreview {
  kind: PreviewKind;
  mime: string | null;
  url: string | null;
  expiresAt: string | null;
}

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

export interface Share {
  id: string;
  user: UserSummary;
  role: ShareRole;
  grantedBy: UserSummary | null;
  createdAt: string;
}

export interface TrashItem {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  createdBy: UserSummary;
  deletedBy: UserSummary | null;
  deletedAt: string;
  itemCount: number;
}

export interface AdminUser extends UserSummary {
  isSystemAdmin: boolean;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditItem {
  id: string;
  createdAt: string;
  action: string;
  actor: UserSummary | null;
  target: { type: string; id: string; label: string | null } | null;
  workspace: { id: string; name: string } | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
}

export interface AdminStats {
  users: { total: number; active: number; disabled: number; systemAdmins: number; activeLast7Days: number };
  workspaces: { total: number };
  content: { folders: number; documents: number; files: number; videos: number; inTrash: number };
  activity: { last7Days: Array<{ date: string; count: number }>; loginsLast7Days: number; failedLoginsLast7Days: number };
}

export interface VideoRendition {
  name: string;
  width: number;
  height: number;
  bandwidth: number;
}

export interface VideoDetail {
  node: NodeItem;
  video: {
    durationSec: number;
    width: number;
    height: number;
    renditions: VideoRendition[];
    viewCount: number;
    transcodedAt: string;
  } | null;
  processingError: string | null;
  resumeAt: number | null;
}

export interface Playback {
  masterUrl: string;
  token: string;
  expiresAt: string;
  posterUrl: string | null;
  watermark: { name: string; email: string };
  resumeAt: number | null;
  durationSec: number;
}

export interface AdminVideo {
  id: string;
  name: string;
  status: NodeItem["status"];
  workspace: { id: string; name: string };
  size: number | null;
  durationSec: number | null;
  viewCount: number;
  createdBy: { id: string; name: string; email: string };
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  actor: UserSummary | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
