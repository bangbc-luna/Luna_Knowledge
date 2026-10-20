"use client";

import { Crown, LogOut, UserMinus, UserPlus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiError, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatWhen, ROLE_HINT, ROLE_LABEL, roleAtLeast } from "@/lib/format";
import type { Member, WorkspaceRole } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { Field, Input, SearchInput } from "../ui/input";
import { RowMenu } from "../ui/menu";
import { Avatar, Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast";

type Assignable = Exclude<WorkspaceRole, "OWNER">;
const ROLE_OPTIONS = (["ADMIN", "EDITOR", "VIEWER"] as const).map((r) => ({ value: r, label: ROLE_LABEL[r], hint: ROLE_HINT[r] }));

export function MembersPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { me, reloadMe } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const ws = me?.workspaces.find((w) => w.id === wsId);
  const myRole = me?.isSystemAdmin ? "OWNER" : (ws?.role ?? null);
  const canManage = roleAtLeast(myRole, "ADMIN");
  const { data, loading, error, reload } = useApi(() => api<Member[]>(`/workspaces/${wsId}/members`), [wsId]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Assignable>("EDITOR");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "remove" | "leave" | "transfer"; member: Member } | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("vi");
    return (data ?? []).filter((m) => !s || m.user.name.toLocaleLowerCase("vi").includes(s) || m.user.email.includes(s));
  }, [data, q]);

  const add = async () => {
    setBusy(true);
    setAddError(null);
    try {
      await api(`/workspaces/${wsId}/members`, { method: "POST", body: { email: email.trim(), role } });
      toast("success", `Đã thêm ${email.trim()}`);
      setAdding(false);
      setEmail("");
      await reload();
    } catch (err) {
      setAddError(err instanceof ApiError && err.code === "CONFLICT" ? "Người này đã là thành viên." : describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Thành viên{ws ? ` · ${ws.name}` : ""}</h1>
      </TopBar>
      <PageBody>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput label="Tìm thành viên" placeholder="Tìm theo tên hoặc email" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 sm:max-w-80" />
          {canManage ? (
            <Button icon={UserPlus} variant="primary" className="sm:ml-auto" onClick={() => setAdding(true)}>
              Thêm thành viên
            </Button>
          ) : null}
        </div>
        <div className="@container">
          <Card>
            {loading && !data ? (
              <SkeletonRows rows={5} />
            ) : error ? (
              <ErrorBanner error={error} what="danh sách thành viên" onRetry={reload} />
            ) : !list.length ? (
              <EmptyState text={q ? `Không có thành viên nào khớp «${q}».` : "Chưa có thành viên."} />
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead className="hidden sm:table-header-group">
                    <tr className="text-left text-xs font-medium text-muted">
                      <th className="h-10 px-4 font-medium sm:pl-5">Thành viên</th>
                      <th className="h-10 w-px px-4 font-medium">Vai trò</th>
                      <th className="hidden h-10 w-px px-4 font-medium whitespace-nowrap @3xl:table-cell">Ngày tham gia</th>
                      <th className="h-10 w-px px-2 whitespace-nowrap sm:pr-3">
                        <span className="sr-only">Thao tác</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((m) => {
                      const isMe = m.user.id === me?.id;
                      const locked = m.role === "OWNER" || isMe || !canManage;
                      return (
                        <tr key={m.user.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1 border-t border-border px-4 py-2.5 sm:table-row sm:px-0 sm:py-0">
                          <td className="min-w-0 sm:h-16 sm:w-full sm:max-w-0 sm:pr-4 sm:pl-5">
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar name={m.user.name} src={m.user.avatarUrl} />
                              <div className="min-w-0">
                                <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                                  <span className="truncate">{m.user.name}</span>
                                  {isMe ? <span className="shrink-0 text-xs font-normal text-muted">Bạn</span> : null}
                                </p>
                                <p className="truncate text-xs text-muted">{m.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="sm:px-2">
                            {locked ? (
                              <span className="inline-flex h-8 items-center px-2 text-sm whitespace-nowrap text-foreground/80">{ROLE_LABEL[m.role]}</span>
                            ) : (
                              <Select
                                size="inline"
                                value={m.role as Assignable}
                                options={ROLE_OPTIONS}
                                align="right"
                                ariaLabel={`Vai trò của ${m.user.name}`}
                                onChange={async (next) => {
                                  try {
                                    await api(`/workspaces/${wsId}/members/${m.user.id}`, { method: "PATCH", body: { role: next } });
                                    toast("success", `${m.user.name} giờ là ${ROLE_LABEL[next]}`);
                                    await reload();
                                  } catch (err) {
                                    toast("error", describeError(err));
                                  }
                                }}
                              />
                            )}
                          </td>
                          <td className="hidden px-4 text-sm whitespace-nowrap text-muted tabular-nums @3xl:table-cell">{formatWhen(m.createdAt)}</td>
                          <td className="whitespace-nowrap sm:w-px sm:px-2 sm:pr-3">
                            <div className="flex justify-end">
                              <RowMenu
                                groups={[
                                  [{ icon: Crown, label: "Chuyển quyền chủ sở hữu", onSelect: () => setConfirm({ kind: "transfer", member: m }), hidden: myRole !== "OWNER" || m.role === "OWNER" || isMe }],
                                  [
                                    { icon: LogOut, label: "Rời workspace", danger: true, onSelect: () => setConfirm({ kind: "leave", member: m }), hidden: !isMe || m.role === "OWNER" },
                                    { icon: UserMinus, label: "Xoá khỏi workspace", danger: true, onSelect: () => setConfirm({ kind: "remove", member: m }), hidden: isMe || !canManage || m.role === "OWNER" },
                                  ],
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="border-t border-border px-4 py-3 sm:px-5">
                  <p className="text-sm tabular-nums text-muted">{data?.length} thành viên</p>
                </div>
              </>
            )}
          </Card>
        </div>
      </PageBody>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Thêm thành viên"
        description="Người chưa từng đăng nhập vẫn thêm được; lần đầu đăng nhập Google họ sẽ thấy workspace này."
        onSubmit={add}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)} className="min-h-11 md:min-h-10">
              Huỷ
            </Button>
            <Button type="submit" variant="primary" loading={busy} className="min-h-11 md:min-h-10">
              Thêm
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Email" error={addError ?? undefined}>
            {(id) => <Input id={id} type="email" required autoFocus placeholder="ten@lunatech.vn" value={email} invalid={!!addError} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Vai trò">{(id) => <Select id={id} value={role} options={ROLE_OPTIONS} onChange={setRole} />}</Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        danger={confirm?.kind !== "transfer"}
        icon={confirm?.kind === "transfer" ? Crown : confirm?.kind === "leave" ? LogOut : UserMinus}
        title={confirm?.kind === "transfer" ? "Chuyển quyền chủ sở hữu?" : confirm?.kind === "leave" ? "Rời workspace?" : "Xoá khỏi workspace?"}
        confirmLabel={confirm?.kind === "transfer" ? "Chuyển quyền" : confirm?.kind === "leave" ? "Rời workspace" : "Xoá"}
        onConfirm={async () => {
          if (!confirm) return;
          const { kind, member } = confirm;
          try {
            if (kind === "transfer") {
              await api(`/workspaces/${wsId}/transfer-ownership`, { method: "POST", body: { userId: member.user.id } });
              toast("success", `${member.user.name} giờ là chủ sở hữu`);
              await Promise.all([reload(), reloadMe()]);
            } else {
              await api(`/workspaces/${wsId}/members/${member.user.id}`, { method: "DELETE" });
              if (kind === "leave") {
                await reloadMe();
                router.replace("/");
                toast("success", "Đã rời workspace");
              } else {
                toast("success", `Đã xoá ${member.user.name}`);
                await reload();
              }
            }
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        {confirm?.kind === "transfer" ? (
          <>
            <span className="font-medium text-foreground">{confirm.member.user.name}</span> sẽ thành chủ sở hữu; bạn trở thành Quản trị.
          </>
        ) : confirm?.kind === "leave" ? (
          "Bạn sẽ mất quyền xem nội dung workspace này, trừ các mục được chia sẻ riêng."
        ) : (
          <>
            <span className="font-medium text-foreground">{confirm?.member.user.name}</span> sẽ mất quyền xem workspace này.
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
