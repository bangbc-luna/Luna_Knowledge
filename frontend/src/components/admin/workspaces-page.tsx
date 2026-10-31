"use client";

import { Plus, ScrollText, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiError, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatWhen, slugify, WS_ROLE_LABEL } from "@/lib/format";
import type { Member, Workspace } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { Button, IconButton } from "../ui/button";
import { ConfirmDialog, Dialog, Sheet } from "../ui/dialog";
import { Field, Input, SearchInput } from "../ui/input";
import { RowMenu } from "../ui/menu";
import { Avatar, Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";


function MembersSheet({ ws, onClose, onChanged }: { ws: Workspace | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi(() => api<Member[]>(`/workspaces/${ws!.id}/members`), [ws?.id], { enabled: !!ws });
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const add = async () => {
    const value = email.trim().toLowerCase();
    if (!value || !ws) return;
    setAdding(true);
    setAddError(null);
    try {
      await api(`/workspaces/${ws.id}/members`, { method: "POST", body: { email: value } });
      setEmail("");
      toast("success", `Đã thêm ${value} vào «${ws.name}»`);
      await reload();
      onChanged();
    } catch (err) {
      setAddError(err instanceof ApiError && err.code === "CONFLICT" ? "Người này đã là thành viên." : describeError(err));
    } finally {
      setAdding(false);
    }
  };
  return (
    <>
      <Sheet open={!!ws} onClose={onClose} title={ws ? `Thành viên · ${ws.name}` : ""} subtitle={data ? `${data.length} thành viên` : undefined}>
        <form
          className="border-b border-border px-6 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label="Thêm thành viên" error={addError} hint="Email @lunatech.vn. Người chưa đăng nhập lần nào vẫn thêm được.">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} type="email" placeholder="ten@lunatech.vn" value={email} invalid={!!addError} onChange={(e) => (setEmail(e.target.value), setAddError(null))} />
                <Button type="submit" icon={UserPlus} variant="primary" loading={adding} disabled={!email.trim()} className="shrink-0">
                  Thêm
                </Button>
              </div>
            )}
          </Field>
        </form>
        {loading && !data ? (
          <div className="px-6 py-6">
            <SkeletonRows rows={4} />
          </div>
        ) : error ? (
          <ErrorBanner error={error} what="thành viên" onRetry={reload} />
        ) : !data?.length ? (
          <EmptyState text="Workspace chưa có thành viên nào." />
        ) : (
          <ul className="divide-y divide-border px-6 py-2">
            {data.map((m) => (
              <li key={m.user.id} className="flex min-h-14 items-center gap-3 py-2">
                <Avatar name={m.user.name} src={m.user.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.user.name}</p>
                  <p className="truncate text-xs text-muted">
                    {WS_ROLE_LABEL[m.role]} · {m.user.email}
                  </p>
                </div>
                <IconButton icon={UserMinus} label={`Gỡ ${m.user.name} khỏi workspace`} onClick={() => setRemoving(m)} />
              </li>
            ))}
          </ul>
        )}
      </Sheet>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        icon={UserMinus}
        title="Gỡ khỏi workspace?"
        confirmLabel="Gỡ thành viên"
        onConfirm={async () => {
          if (!removing || !ws) return;
          try {
            await api(`/workspaces/${ws.id}/members/${removing.user.id}`, { method: "DELETE" });
            toast("success", `Đã gỡ ${removing.user.name}`);
            await reload();
            onChanged();
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        <span className="font-medium text-foreground">{removing?.user.name}</span> sẽ không xem được nội dung của «{ws?.name}» nữa, trừ các mục được chia sẻ riêng.
      </ConfirmDialog>
    </>
  );
}

export function WorkspacesPage() {
  const toast = useToast();
  const router = useRouter();
  const { reloadMe } = useAuth();
  const { data, loading, error, reload } = useApi(() => api<Workspace[]>("/workspaces", { query: { scope: "all" } }), []);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", memberEmails: "", slugTouched: false });
  const [formError, setFormError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Workspace | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("vi");
    return (data ?? []).filter((w) => !s || w.name.toLocaleLowerCase("vi").includes(s) || w.slug.includes(s));
  }, [data, q]);

  const create = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await api("/workspaces", { method: "POST", body: { name: form.name.trim(), slug: form.slug, memberEmails: form.memberEmails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) } });
      toast("success", `Đã tạo workspace «${form.name.trim()}»`);
      setCreating(false);
      await Promise.all([reload(), reloadMe()]);
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") setFormError({ field: "slug", message: "Đường dẫn này đã có workspace khác dùng." });
      else if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
        const first = (err.details as Array<{ path: string; message: string }> | undefined)?.[0];
        setFormError({ field: first?.path?.startsWith("memberEmails") ? "memberEmails" : (first?.path ?? "memberEmails"), message: first ? first.message : err.message });
      } else setFormError({ message: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Workspace</h1>
      </TopBar>
      <PageBody>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput label="Tìm workspace" placeholder="Tìm theo tên" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 sm:max-w-80" />
          <Button
            icon={Plus}
            variant="primary"
            className="sm:ml-auto"
            onClick={() => {
              setForm({ name: "", slug: "", memberEmails: "", slugTouched: false });
              setFormError(null);
              setCreating(true);
            }}
          >
            Tạo workspace
          </Button>
        </div>
        <div className="@container">
          <Card>
            {loading && !data ? (
              <SkeletonRows rows={5} />
            ) : error ? (
              <ErrorBanner error={error} what="danh sách workspace" onRetry={reload} />
            ) : !list.length ? (
              <EmptyState text={q ? `Không có workspace nào khớp «${q}».` : "Chưa có workspace nào."} />
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead className="hidden sm:table-header-group">
                    <tr className="text-left text-xs font-medium text-muted">
                      <th className="h-10 pr-4 pl-3 font-medium">Workspace</th>
                      <th className="h-10 w-px px-4 text-right font-medium whitespace-nowrap">Thành viên</th>
                      <th className="hidden h-10 w-px px-4 font-medium whitespace-nowrap @2xl:table-cell">Ngày tạo</th>
                      <th className="h-10 w-px px-2 whitespace-nowrap sm:pr-3">
                        <span className="sr-only">Thao tác</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((w) => (
                      <tr key={w.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 border-t border-border px-4 py-2.5 sm:table-row sm:px-0 sm:py-0">
                        <td className="min-w-0 sm:h-11 sm:w-full sm:max-w-0 sm:pr-4 sm:pl-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-xs font-semibold text-foreground/70" aria-hidden>
                              {w.icon || w.name.slice(0, 1).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium" title={w.name}>
                                {w.name}
                              </p>
                              <p className="truncate text-xs text-muted">
                                /{w.slug}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-1 text-right text-sm whitespace-nowrap text-foreground/80 tabular-nums sm:px-4">{w.memberCount}</td>
                        <td className="hidden px-4 text-sm whitespace-nowrap text-muted tabular-nums @2xl:table-cell">{formatWhen(w.createdAt)}</td>
                        <td className="whitespace-nowrap sm:w-px sm:px-2 sm:pr-3">
                          <div className="flex justify-end">
                            <RowMenu
                              groups={[
                                [
                                  { icon: Users, label: "Quản lý thành viên", onSelect: () => setViewing(w) },
                                  { icon: ScrollText, label: "Xem nhật ký workspace", onSelect: () => router.push(`/admin/logs?workspaceId=${w.id}`) },
                                ],
                                [{ icon: Trash2, label: "Xoá workspace", danger: true, onSelect: () => setDeleting(w) }],
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-border px-3 py-2">
                  <p className="text-sm tabular-nums text-muted">{list.length} workspace</p>
                </div>
              </>
            )}
          </Card>
        </div>
      </PageBody>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Tạo workspace"
        description="Thành viên chưa từng đăng nhập vẫn thêm được; họ thấy workspace ở lần đăng nhập Google đầu tiên."
        onSubmit={create}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)} size="touch">
              Huỷ
            </Button>
            <Button type="submit" variant="primary" loading={busy} size="touch">
              Tạo workspace
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Tên" error={formError?.field === "name" ? formError.message : undefined}>
            {(id) => (
              <Input
                id={id}
                required
                autoFocus
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slugTouched ? form.slug : slugify(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Đường dẫn" hint="Chữ thường, số và dấu gạch, ví dụ marketing" error={formError?.field === "slug" ? formError.message : undefined}>
            {(id) => <Input id={id} required value={form.slug} invalid={formError?.field === "slug"} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value), slugTouched: true })} />}
          </Field>
          <Field label="Thành viên ban đầu" hint="Không bắt buộc. Nhiều email cách nhau bằng dấu phẩy hoặc xuống dòng." error={formError?.field === "memberEmails" ? formError.message : undefined}>
            {(id) => (
              <textarea
                id={id}
                rows={3}
                placeholder="an@lunatech.vn, binh@lunatech.vn"
                value={form.memberEmails}
                aria-invalid={formError?.field === "memberEmails" || undefined}
                onChange={(e) => setForm({ ...form, memberEmails: e.target.value })}
                className="w-full resize-y rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-base text-foreground outline-hidden placeholder:text-muted focus:border-focus focus:ring-2 focus:ring-focus aria-invalid:border-err-line md:text-sm"
              />
            )}
          </Field>
          {formError && !formError.field ? <p className="text-sm text-err-text">{formError.message}</p> : null}
        </div>
      </Dialog>

      <MembersSheet ws={viewing} onClose={() => setViewing(null)} onChanged={() => void Promise.all([reload(), reloadMe()])} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Xoá workspace?"
        confirmLabel="Xoá workspace"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/workspaces/${deleting.id}`, { method: "DELETE" });
            toast("success", `Đã xoá workspace «${deleting.name}»`);
            await Promise.all([reload(), reloadMe()]);
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        <span className="font-medium text-foreground">{deleting?.name}</span> sẽ bị xoá; {deleting?.memberCount} thành viên không truy cập được nội dung bên trong nữa.
      </ConfirmDialog>
    </>
  );
}
