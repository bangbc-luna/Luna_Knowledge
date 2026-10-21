"use client";

import { Users, X } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Member } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useCurrentWorkspace } from "@/lib/workspace";
import { Sheet } from "../ui/dialog";
import { SearchInput } from "../ui/input";
import { Avatar, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";

const KEY = "luna:membersOpen";
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

const listeners = new Set<() => void>();
let current: boolean | null = null;

function readOpen() {
  if (current !== null) return current;
  try {
    current = localStorage.getItem(KEY) === "1";
  } catch {
    current = false;
  }
  return current;
}

export function setMembersOpen(v: boolean) {
  current = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
  }
  listeners.forEach((l) => l());
}

export function useMembersOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readOpen,
    () => false,
  );
}

function useWide() {
  return useSyncExternalStore(
    (l) => {
      const mq = matchMedia("(min-width: 80rem)");
      mq.addEventListener("change", l);
      return () => mq.removeEventListener("change", l);
    },
    () => matchMedia("(min-width: 80rem)").matches,
    () => true,
  );
}

function useMembers() {
  const { wsId, ws } = useCurrentWorkspace();
  return { wsId, ws, members: useApi(() => api<Member[]>(`/workspaces/${wsId}/members`), [wsId], { enabled: !!ws }) };
}

export function MembersToggle() {
  const { ws } = useCurrentWorkspace();
  const open = useMembersOpen();
  if (!ws) return null;
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label="Thành viên workspace"
      title="Thành viên workspace"
      onClick={() => setMembersOpen(!open)}
      className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium text-foreground/70 outline-hidden transition-colors hover:bg-foreground/5 hover:text-foreground aria-pressed:bg-foreground/5 aria-pressed:text-foreground"
    >
      <Users className="size-4" aria-hidden />
      <span className="hidden sm:inline">Thành viên</span>
    </button>
  );
}

function MemberList({ members, meId }: { members: Member[]; meId: string | undefined }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const f = fold(q.trim());
    return f ? members.filter((m) => fold(m.user.name).includes(f) || fold(m.user.email).includes(f)) : members;
  }, [members, q]);
  return (
    <>
      {members.length > 8 ? (
        <div className="px-4 pb-2">
          <SearchInput label="Tìm thành viên" placeholder="Tìm theo tên hoặc email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      ) : null}
      {!list.length ? (
        <EmptyState text={q ? `Không có ai khớp «${q}».` : "Workspace chưa có thành viên nào."} />
      ) : (
        <ul className="px-2 pb-3">
          {list.map((m) => (
            <li key={m.user.id} className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2">
              <Avatar name={m.user.name} src={m.user.avatarUrl} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                  <span className="truncate">{m.user.name}</span>
                  {m.user.id === meId ? <span className="shrink-0 text-xs font-normal text-muted">Bạn</span> : null}
                </span>
                <span className="block truncate text-xs text-muted">{m.user.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-border px-4 py-3 text-xs text-pretty text-muted">Quản trị hệ thống thêm hoặc gỡ thành viên.</p>
    </>
  );
}

export function MembersPanel() {
  const { me } = useAuth();
  const open = useMembersOpen();
  const wide = useWide();
  const { ws, members } = useMembers();
  if (!ws || !open) return null;
  const count = members.data?.length;
  const body = members.error ? (
    <ErrorBanner error={members.error} what="thành viên" onRetry={() => void members.reload()} />
  ) : !members.data ? (
    <SkeletonRows rows={4} />
  ) : (
    <MemberList members={members.data} meId={me?.id} />
  );
  if (!wide) {
    return (
      <Sheet open onClose={() => setMembersOpen(false)} title="Thành viên" subtitle={<span className="block truncate">{ws.name}{count !== undefined ? ` · ${count} người` : ""}</span>}>
        <div className="pt-3">{body}</div>
      </Sheet>
    );
  }
  return (
    <aside aria-label="Thành viên workspace" className={cn("sticky top-0 flex h-dvh w-72 shrink-0 flex-col border-l border-border bg-surface")}>
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          Thành viên{count !== undefined ? <span className="ml-1.5 font-normal text-muted tabular-nums">{count}</span> : null}
        </h2>
        <button
          type="button"
          aria-label="Đóng cột thành viên"
          onClick={() => setMembersOpen(false)}
          className="inline-flex size-10 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-3">{body}</div>
    </aside>
  );
}
