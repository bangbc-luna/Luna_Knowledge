"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./auth";
import type { MeWorkspace } from "./types";

const LAST_WS = "luna:lastWorkspace";

export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(LAST_WS, id);
  } catch {
  }
}

export function lastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_WS);
  } catch {
    return null;
  }
}

function fallbackWorkspace(list: MeWorkspace[]): MeWorkspace | null {
  const remembered = lastWorkspace();
  return (remembered ? list.find((w) => w.id === remembered) : undefined) ?? list.find((w) => w.kind === "COMPANY") ?? list[0] ?? null;
}

export function useCurrentWorkspace() {
  const { me } = useAuth();
  const params = useParams<{ wsId?: string }>();
  const wsId = params.wsId ?? null;
  const list = me?.workspaces ?? [];
  const ws = (wsId ? list.find((w) => w.id === wsId) : fallbackWorkspace(list)) ?? null;
  return { wsId: wsId ?? ws?.id ?? null, ws, role: ws?.role ?? null };
}

export function useShellWorkspace(): { ws: MeWorkspace | null; routeWsId: string | null; isMember: boolean } {
  const { me } = useAuth();
  const params = useParams<{ wsId?: string }>();
  const routeWsId = params.wsId ?? null;
  const list = me?.workspaces ?? [];
  const member = routeWsId ? (list.find((w) => w.id === routeWsId) ?? null) : null;
  const isMember = !!member;
  const ws = member ?? fallbackWorkspace(list);
  const wsId = ws?.id ?? null;
  useEffect(() => {
    if (isMember && wsId) rememberWorkspace(wsId);
  }, [isMember, wsId]);
  return { ws, routeWsId, isMember };
}
