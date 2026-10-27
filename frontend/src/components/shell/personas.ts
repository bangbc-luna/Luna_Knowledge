export const PERSONAS = [
  { email: "admin@lunatech.vn", name: "System Admin", note: "System Admin" },
  { email: "qa.creator@lunatech.vn", name: "QA Creator", note: "Quản trị workspace nhóm" },
  { email: "qa.member@lunatech.vn", name: "QA Member", note: "Thành viên workspace nhóm" },
  { email: "qa.shared.viewer@lunatech.vn", name: "QA Shared Viewer", note: "Share chỉ xem" },
  { email: "qa.shared.editor@lunatech.vn", name: "QA Shared Editor", note: "Share được chỉnh sửa" },
  { email: "qa.outsider@lunatech.vn", name: "QA Outsider", note: "Nhân viên, chỉ xem kho công ty" },
] as const;

export const IS_DEV = process.env.NODE_ENV === "development";
