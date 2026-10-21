import type { NodeType, WorkspaceRole } from "./types";

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  OWNER: "Chủ sở hữu",
  ADMIN: "Quản trị",
  EDITOR: "Biên tập",
  VIEWER: "Chỉ xem",
};

export const ROLE_HINT: Record<WorkspaceRole, string> = {
  OWNER: "Toàn quyền, xoá vĩnh viễn, chuyển quyền sở hữu",
  ADMIN: "Quản lý thành viên, chia sẻ, tag",
  EDITOR: "Tạo, sửa; xoá mục do mình tạo",
  VIEWER: "Chỉ xem",
};

const RANK: Record<WorkspaceRole, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 };
export const roleAtLeast = (role: WorkspaceRole | null | undefined, min: WorkspaceRole) =>
  !!role && RANK[role] >= RANK[min];

export const TYPE_LABEL: Record<NodeType, string> = {
  FOLDER: "Thư mục",
  DOCUMENT: "Tài liệu",
  FILE: "Tệp",
  VIDEO: "Video",
};

const TZ = "Asia/Ho_Chi_Minh";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const time = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const date = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

export function formatWhen(iso: string, { withTime = false } = {}): string {
  const d = new Date(iso);
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const key = dayKey(d);
  if (key === today) return `Hôm nay, ${time(d)}`;
  if (key === yesterday) return `Hôm qua, ${time(d)}`;
  return withTime ? `${date(d)} ${time(d)}` : date(d);
}

export const formatNumber = (n: number) => n.toLocaleString("vi-VN");

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0]!.replace(/[._-]+/g, " ") : nameOrEmail;
  const words = base.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(-2).map((w) => w[0]) : [words[0]?.[0], words[0]?.[1]])
    .filter(Boolean)
    .join("")
    .toUpperCase();
}

export const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Đăng nhập",
  "auth.login_failed": "Đăng nhập thất bại",
  "auth.logout": "Đăng xuất",
  "auth.session_revoked": "Phiên bị thu hồi",
  "node.view": "Xem",
  "node.create": "Tạo",
  "node.rename": "Đổi tên",
  "node.move": "Di chuyển",
  "node.trash": "Xoá vào thùng rác",
  "node.restore": "Khôi phục",
  "node.delete_permanent": "Xoá vĩnh viễn",
  "trash.empty": "Dọn thùng rác",
  "upload.start": "Bắt đầu tải lên",
  "upload.abort": "Huỷ tải lên",
  "file.upload": "Tải lên",
  "file.download": "Tải về",
  "file.version_restore": "Khôi phục phiên bản",
  "file.regenerate": "Tạo lại bản xem trước",
  "video.play": "Xem video",
  "video.retranscode": "Transcode lại video",
  "video.original_access": "Tải file gốc video",
  "share.add": "Chia sẻ",
  "share.update": "Đổi quyền chia sẻ",
  "share.remove": "Thu hồi chia sẻ",
  "tag.create": "Tạo tag",
  "tag.update": "Sửa tag",
  "tag.delete": "Xoá tag",
  "user.update": "Cập nhật tài khoản",
  "user.grant_system_admin_cli": "Cấp quyền admin (CLI)",
  "workspace.create": "Tạo workspace",
  "workspace.update": "Sửa workspace",
  "workspace.delete": "Xoá workspace",
  "workspace.member_add": "Thêm thành viên",
  "workspace.member_update": "Đổi vai trò",
  "workspace.member_remove": "Xoá thành viên",
  "workspace.transfer_ownership": "Chuyển quyền sở hữu",
};

export const ACTION_GROUPS: Array<{ key: string; label: string; actions: string[] }> = [
  { key: "view", label: "Xem", actions: ["node.view"] },
  { key: "download", label: "Tải về", actions: ["file.download", "video.original_access"] },
  { key: "video", label: "Xem video", actions: ["video.play"] },
  { key: "upload", label: "Tải lên, phiên bản", actions: ["file.upload", "upload.start", "upload.abort", "file.version_restore", "file.regenerate"] },
  { key: "edit", label: "Tạo, sửa, di chuyển", actions: ["node.create", "node.rename", "node.move", "node.restore"] },
  { key: "delete", label: "Xoá", actions: ["node.trash", "node.delete_permanent", "trash.empty"] },
  { key: "share", label: "Chia sẻ", actions: ["share.add", "share.update", "share.remove"] },
  { key: "login", label: "Đăng nhập, đăng xuất", actions: ["auth.login", "auth.logout"] },
  { key: "failed", label: "Đăng nhập thất bại", actions: ["auth.login_failed", "auth.session_revoked"] },
  {
    key: "admin",
    label: "Quản trị",
    actions: [
      "user.update", "user.grant_system_admin_cli", "workspace.create", "workspace.update", "workspace.delete",
      "workspace.member_add", "workspace.member_update", "workspace.member_remove", "workspace.transfer_ownership",
      "tag.create", "tag.update", "tag.delete",
    ],
  },
];

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}
