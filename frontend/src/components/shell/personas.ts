export const PERSONAS = [
  { email: "admin@lunatech.vn", name: "System Admin", note: "System Admin" },
  { email: "qa.owner@lunatech.vn", name: "QA Owner", note: "Chủ sở hữu" },
  { email: "qa.wsadmin@lunatech.vn", name: "QA WS Admin", note: "Quản trị" },
  { email: "qa.editor@lunatech.vn", name: "QA Editor", note: "Biên tập" },
  { email: "qa.viewer@lunatech.vn", name: "QA Viewer", note: "Chỉ xem" },
  { email: "qa.outsider@lunatech.vn", name: "QA Outsider", note: "Ngoài workspace" },
] as const;

export const IS_DEV = process.env.NODE_ENV === "development";
