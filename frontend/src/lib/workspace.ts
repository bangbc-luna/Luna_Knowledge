"use client";

import { useParams } from "next/navigation";
import { useAuth } from "./auth";

const LAST_WS = "luna:lastWorkspace";

export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(LAST_WS, id);
  } catch {
    /* trình duyệt chặn lưu: bỏ qua, chỉ là tiện ích */
  }
}

export function lastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_WS);
  } catch {
    return null;
  }
}

/** Workspace đang xem (theo URL) và vai trò của tôi trong đó; null nếu tôi không phải thành viên. */
export function useCurrentWorkspace() {
  const { me } = useAuth();
  const params = useParams<{ wsId?: string }>();
  const wsId = params.wsId ?? null;
  const fallback = me?.workspaces.find((w) => w.id === lastWorkspace()) ?? me?.workspaces[0] ?? null;
  const ws = (wsId ? me?.workspaces.find((w) => w.id === wsId) : fallback) ?? null;
  return { wsId: wsId ?? ws?.id ?? null, ws, role: ws?.role ?? null };
}
