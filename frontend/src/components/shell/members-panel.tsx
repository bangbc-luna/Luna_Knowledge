"use client";

import { Eye, LogOut, ShieldCheck, UserMinus, UserRound, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { WS_ROLE_HINT, WS_ROLE_LABEL } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Member, WorkspaceKind, WorkspaceRole } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useCurrentWorkspace } from "@/lib/workspace";
import { Button } from "../ui/button";
import { ConfirmDialog, Sheet } from "../ui/dialog";
import { SearchInput } from "../ui/input";
import { RowMenu } from "../ui/menu";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast";
import { UserSuggestInput } from "../ui/user-suggest";
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

function InviteForm({ wsId, kind, members, onDone }: { wsId: string; kind: WorkspaceKind; members: Member[]; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roles: WorkspaceRole[] = kind === "COMPANY" ? ["VIEWER", "MEMBER", "ADMIN"] : ["MEMBER", "ADMIN"];
  const taken = useMemo(() => new Set(kind === "COMPANY" ? [] : members.map((m) => m.user.id)), [kind, members]);
  const submit = async () => {
    const value = email.trim().toLowerCase();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/workspaces/${wsId}/members`, { method: "POST", body: { email: value, role } });
      toast("success", kind === "COMPANY" ? `Đã đặt ${value} là ${WS_ROLE_LABEL[role]}` : `Đã mời ${value}`);
      setEmail("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "CONFLICT" ? "Người này đã ở trong workspace." : describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="border-b border-border px-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="invite-email" className="text-sm font-medium text-foreground">
        {kind === "COMPANY" ? "Cấp quyền đăng bài" : "Mời vào workspace"}
      </label>
      <UserSuggestInput
        id="invite-email"
        className="mt-1.5"
        placeholder="Tên hoặc email @lunatech.vn"
        value={email}
        invalid={!!error}
        taken={taken}
        onChange={(v) => (setEmail(v), setError(null))}
        onPick={(u) => (setEmail(u.email), setError(null))}
      />
      <div className="mt-2 flex gap-2">
        <Select value={role} ariaLabel="Vai trò" options={roles.map((r) => ({ value: r, label: WS_ROLE_LABEL[r], hint: WS_ROLE_HINT[r] }))} onChange={setRole} className="min-w-0 flex-1" />
        <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()} className="shrink-0">
          {kind === "COMPANY" ? "Lưu" : "Mời"}
        </Button>
      </div>
      {error ? <p className="mt-1.5 text-sm text-err-text">{error}</p> : null}
    </form>
  );
}

function MemberList({ members, meId, wsId, kind, canManage, onChanged }: { members: Member[]; meId: string | undefined; wsId: string; kind: WorkspaceKind; canManage: boolean; onChanged: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { reloadMe } = useAuth();
  const [q, setQ] = useState("");
  const [removing, setRemoving] = useState<Member | null>(null);
  const list = useMemo(() => {
    const f = fold(q.trim());
    return f ? members.filter((m) => fold(m.user.name).includes(f) || fold(m.user.email).includes(f)) : members;
  }, [members, q]);
  const roles: WorkspaceRole[] = kind === "COMPANY" ? ["ADMIN", "MEMBER", "VIEWER"] : ["ADMIN", "MEMBER"];
  const setRole = async (m: Member, role: WorkspaceRole) => {
    try {
      await api(`/workspaces/${wsId}/members/${m.user.id}`, { method: "PATCH", body: { role } });
      toast("success", `${m.user.name} giờ là ${WS_ROLE_LABEL[role]}`);
      onChanged();
      if (m.user.id === meId) await reloadMe();
    } catch (err) {
      toast("error", describeError(err));
    }
  };
  return (
    <>
      {members.length > 8 ? (
        <div className="px-4 pt-3 pb-2">
          <SearchInput label="Tìm thành viên" placeholder="Tìm theo tên hoặc email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      ) : null}
      {!list.length ? (
        <EmptyState text={q ? `Không có ai khớp «${q}».` : "Workspace chưa có thành viên nào."} />
      ) : (
        <ul className="px-2 pt-2 pb-3">
          {list.map((m) => {
            const isMe = m.user.id === meId;
            const actions = [
              roles.filter((r) => r !== m.role).map((r) => ({ icon: r === "ADMIN" ? ShieldCheck : r === "MEMBER" ? UserRound : Eye, label: `Đặt làm ${WS_ROLE_LABEL[r].toLowerCase()}`, onSelect: () => void setRole(m, r), hidden: !canManage })),
              [
                { icon: UserMinus, label: "Gỡ khỏi workspace", danger: true, onSelect: () => setRemoving(m), hidden: kind === "COMPANY" || !canManage || isMe },
                { icon: LogOut, label: "Rời workspace", danger: true, onSelect: () => setRemoving(m), hidden: kind === "COMPANY" || !isMe },
              ],
            ];
            return (
              <li key={m.user.id} className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2">
                <Avatar name={m.user.name} src={m.user.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{m.user.name}</span>
                    {isMe ? <span className="shrink-0 text-xs font-normal text-muted">Bạn</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {WS_ROLE_LABEL[m.role]} · {m.user.email}
                  </span>
                </span>
                <RowMenu label={`Thao tác với ${m.user.name}`} groups={actions} />
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-border px-4 py-3 text-xs text-pretty text-muted">
        {kind === "COMPANY"
          ? "Mọi tài khoản LunaTech đều xem được kho này. Quản trị cấp quyền đăng bài cho người khác."
          : canManage
            ? "Thành viên xem, sửa, tải lên và xoá được tài liệu; mọi thay đổi đều có log. Luôn phải còn ít nhất một quản trị."
            : "Quản trị workspace mời thêm người và đổi vai trò."}
      </p>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        icon={removing?.user.id === meId ? LogOut : UserMinus}
        title={removing?.user.id === meId ? "Rời workspace?" : "Gỡ khỏi workspace?"}
        confirmLabel={removing?.user.id === meId ? "Rời workspace" : "Gỡ"}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api(`/workspaces/${wsId}/members/${removing.user.id}`, { method: "DELETE" });
            if (removing.user.id === meId) {
              await reloadMe();
              setMembersOpen(false);
              router.push("/");
            } else {
              toast("success", `Đã gỡ ${removing.user.name}`);
              onChanged();
            }
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        {removing?.user.id === meId ? (
          "Bạn sẽ không xem được nội dung của workspace này nữa, trừ các mục được chia sẻ riêng."
        ) : (
          <>
            <span className="font-medium text-foreground">{removing?.user.name}</span> sẽ không xem được nội dung của workspace này nữa, trừ các mục được chia sẻ riêng.
          </>
        )}
      </ConfirmDialog>
    </>
  );
}

export function MembersPanel() {
  const { me } = useAuth();
  const open = useMembersOpen();
  const wide = useWide();
  const { ws, members } = useMembers();
  if (!ws || !open) return null;
  const canManage = ws.role === "ADMIN" || !!me?.isSystemAdmin;
  const count = members.data?.length;
  const body = members.error ? (
    <ErrorBanner error={members.error} what="thành viên" onRetry={() => void members.reload()} />
  ) : !members.data ? (
    <SkeletonRows rows={4} />
  ) : (
    <>
      {canManage ? <InviteForm wsId={ws.id} kind={ws.kind} members={members.data} onDone={() => void members.reload()} /> : null}
      <MemberList members={members.data} meId={me?.id} wsId={ws.id} kind={ws.kind} canManage={canManage} onChanged={() => void members.reload()} />
    </>
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
