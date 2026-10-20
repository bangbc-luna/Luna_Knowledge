"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { roleAtLeast } from "@/lib/format";
import type { Tag } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { RowMenu } from "../ui/menu";
import { Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";

const COLORS = ["#e5534b", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#4f46e5", "#9333ea", "#db2777", "#6b7280"];

export function TagsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { me } = useAuth();
  const toast = useToast();
  const ws = me?.workspaces.find((w) => w.id === wsId);
  const canCreate = roleAtLeast(ws?.role, "EDITOR");
  const canManage = roleAtLeast(ws?.role, "ADMIN");
  const { data, loading, error, reload } = useApi(() => api<Tag[]>(`/workspaces/${wsId}/tags`), [wsId]);
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (tag: Tag | "new") => {
    setEditing(tag);
    setName(tag === "new" ? "" : tag.name);
    setColor(tag === "new" ? COLORS[0]! : tag.color);
    setFormError(null);
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setFormError(null);
    try {
      if (editing === "new") await api(`/workspaces/${wsId}/tags`, { method: "POST", body: { name: name.trim(), color } });
      else await api(`/tags/${editing.id}`, { method: "PATCH", body: { name: name.trim(), color } });
      toast("success", editing === "new" ? `Đã tạo tag «${name.trim()}»` : "Đã lưu tag");
      setEditing(null);
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError && err.code === "CONFLICT" ? "Workspace đã có tag cùng tên." : describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Tag{ws ? ` · ${ws.name}` : ""}</h1>
      </TopBar>
      <PageBody>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm text-muted">Tag dùng chung cho mọi mục trong workspace. Biên tập tạo tag; Quản trị sửa và xoá.</p>
          {canCreate ? (
            <Button icon={Plus} variant="primary" className="shrink-0" onClick={() => open("new")}>
              Tạo tag
            </Button>
          ) : null}
        </div>
        <div className="max-w-3xl">
          <Card>
            {loading && !data ? (
              <SkeletonRows rows={3} />
            ) : error ? (
              <ErrorBanner error={error} what="danh sách tag" onRetry={reload} />
            ) : !data?.length ? (
              <EmptyState text="Workspace chưa có tag nào." />
            ) : (
              <ul>
                {data.map((t, i) => (
                  <li key={t.id} className={cn("flex min-h-14 items-center gap-3 px-4 py-2 sm:px-5", i && "border-t border-border")}>
                    <span className="size-3 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                    <RowMenu
                      groups={[
                        [{ icon: Pencil, label: "Sửa", onSelect: () => open(t), hidden: !canManage }],
                        [{ icon: Trash2, label: "Xoá tag", danger: true, onSelect: () => setDeleting(t), hidden: !canManage }],
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Tạo tag" : "Sửa tag"}
        onSubmit={save}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} className="min-h-11 md:min-h-10">
              Huỷ
            </Button>
            <Button type="submit" variant="primary" loading={busy} className="min-h-11 md:min-h-10">
              {editing === "new" ? "Tạo tag" : "Lưu"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Tên" error={formError ?? undefined}>
            {(id) => <Input id={id} required autoFocus maxLength={50} value={name} invalid={!!formError} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Màu</legend>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                  className={cn("size-8 cursor-pointer rounded-full ring-offset-2 ring-offset-surface outline-hidden", c === color && "ring-2 ring-foreground")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Xoá tag?"
        confirmLabel="Xoá tag"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/tags/${deleting.id}`, { method: "DELETE" });
            toast("success", `Đã xoá tag «${deleting.name}»`);
            await reload();
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        Tag <span className="font-medium text-foreground">{deleting?.name}</span> sẽ bị gỡ khỏi mọi mục đang gắn.
      </ConfirmDialog>
    </>
  );
}
