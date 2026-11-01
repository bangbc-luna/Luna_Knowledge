import type { ContentRole, NodeSection, NodeType, WorkspaceRole } from "./types";

export const SHARE_LABEL: Record<"VIEWER" | "EDITOR", string> = {
  VIEWER: "Chỉ xem",
  EDITOR: "Được chỉnh sửa",
};

export const SHARE_HINT: Record<"VIEWER" | "EDITOR", string> = {
  VIEWER: "Xem và bình luận",
  EDITOR: "Như người sở hữu: sửa, xoá, chia sẻ tiếp",
};

export const WS_ROLE_LABEL: Record<WorkspaceRole, string> = { ADMIN: "Quản trị", MEMBER: "Thành viên", VIEWER: "Chỉ xem" };
export const WS_ROLE_HINT: Record<WorkspaceRole, string> = {
  ADMIN: "Toàn quyền: mời, đổi vai trò, cài đặt workspace, xoá vĩnh viễn",
  MEMBER: "Xem, bình luận, sửa, tải lên và xoá tài liệu",
  VIEWER: "Chỉ xem và bình luận",
};
export const contentRoleOf = (role: WorkspaceRole | null | undefined): ContentRole | null =>
  role === "ADMIN" ? "OWNER" : role === "MEMBER" ? "EDITOR" : role === "VIEWER" ? "VIEWER" : null;

const RANK: Record<ContentRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };
export const roleAtLeast = (role: ContentRole | null | undefined, min: ContentRole) => !!role && RANK[role] >= RANK[min];

export const SECTION_LABEL: Record<NodeSection, string> = { DOCS: "Tài liệu", VIDEOS: "Video" };
export const sectionPath = (section: NodeSection) => (section === "VIDEOS" ? "v" : "f");

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

export function workspaceAbbr(name: string): string {
  const words = name
    .normalize("NFC")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (!words.length) return "?";
  const chars = (w: string) => Array.from(w);
  const upper = (s: string) => s.toLocaleUpperCase("vi");
  if (words.length >= 2) return upper(words.slice(0, 2).map((w) => chars(w)[0]).join(""));
  const only = chars(words[0]!);
  const caps = only.filter((c) => c !== c.toLocaleLowerCase("vi") && c === upper(c));
  if (caps.length >= 2) return caps.slice(0, 2).join("");
  return upper(only.slice(0, 2).join(""));
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
  "document.edit": "Sửa nội dung",
  "document.import": "Tạo từ file Word",
  "document.copy": "Tạo bản sao",
  "document.version_create": "Lưu phiên bản",
  "document.version_restore": "Khôi phục phiên bản",
  "document.export": "Xuất tài liệu",
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
  "video.update_info": "Sửa thông tin video",
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
  { key: "edit", label: "Tạo, sửa, di chuyển", actions: ["node.create", "node.rename", "video.update_info", "node.move", "node.restore", "document.edit", "document.import", "document.copy", "document.version_create", "document.version_restore"] },
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

export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
