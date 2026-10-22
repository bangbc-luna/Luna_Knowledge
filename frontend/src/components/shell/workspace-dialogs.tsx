"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { slugify } from "@/lib/format";
import type { Workspace } from "@/lib/types";
import { Button } from "../ui/button";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { useToast } from "../ui/toast";

const TEXTAREA =
  "w-full resize-y rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-base text-foreground outline-hidden placeholder:text-muted focus:border-focus focus:ring-2 focus:ring-focus aria-invalid:border-err-line md:text-sm";

type FieldError = { field?: string; message: string } | null;

function apiFieldError(err: unknown, fallbackField?: string): FieldError {
  if (err instanceof ApiError && err.code === "CONFLICT") return { field: "slug", message: "Đường dẫn này đã có workspace khác dùng." };
  if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
    const first = (err.details as Array<{ path: string; message: string }> | undefined)?.[0];
    const path = first?.path ?? fallbackField;
    return { field: path?.startsWith("memberEmails") ? "memberEmails" : path, message: first?.message ?? err.message };
  }
  return { message: describeError(err) };
}

export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { reloadMe } = useAuth();
  const [form, setForm] = useState({ name: "", slug: "", description: "", members: "", slugTouched: false });
  const [error, setError] = useState<FieldError>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm({ name: "", slug: "", description: "", members: "", slugTouched: false });
      setError(null);
    }
  }
  const submit = async () => {
    if (!form.name.trim()) return setError({ field: "name", message: "Chưa nhập tên workspace" });
    setBusy(true);
    setError(null);
    try {
      const ws = await api<Workspace>("/workspaces", {
        method: "POST",
        body: {
          name: form.name.trim(),
          slug: form.slug || slugify(form.name),
          description: form.description.trim() || undefined,
          memberEmails: form.members.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean),
        },
      });
      await reloadMe();
      toast("success", `Đã tạo workspace «${ws.name}». Bạn là quản trị.`);
      onClose();
      router.push(`/w/${ws.id}/f`);
    } catch (err) {
      setError(apiFieldError(err, "memberEmails"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo workspace"
      description="Dành cho một nhóm hoặc một dự án. Bạn là quản trị và mời được người khác vào sau."
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="min-h-11 md:min-h-10">
            Huỷ
          </Button>
          <Button type="submit" variant="primary" loading={busy} className="min-h-11 md:min-h-10">
            Tạo workspace
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Tên" error={error?.field === "name" ? error.message : undefined}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              maxLength={100}
              placeholder="Ví dụ: Dự án Website 2026"
              value={form.name}
              invalid={error?.field === "name"}
              onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slugTouched ? form.slug : slugify(e.target.value) })}
            />
          )}
        </Field>
        <Field label="Đường dẫn" hint="Chữ thường, số và dấu gạch" error={error?.field === "slug" ? error.message : undefined}>
          {(id) => <Input id={id} value={form.slug} invalid={error?.field === "slug"} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value), slugTouched: true })} />}
        </Field>
        <Field label="Mô tả" hint="Không bắt buộc">
          {(id) => <textarea id={id} rows={2} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={TEXTAREA} />}
        </Field>
        <Field label="Mời thành viên" hint="Không bắt buộc. Nhiều email cách nhau bằng dấu phẩy hoặc xuống dòng." error={error?.field === "memberEmails" ? error.message : undefined}>
          {(id) => (
            <textarea
              id={id}
              rows={2}
              placeholder="an@lunatech.vn, binh@lunatech.vn"
              value={form.members}
              aria-invalid={error?.field === "memberEmails" || undefined}
              onChange={(e) => setForm({ ...form, members: e.target.value })}
              className={TEXTAREA}
            />
          )}
        </Field>
        {error && !error.field ? <p className="text-sm text-err-text">{error.message}</p> : null}
      </div>
    </Dialog>
  );
}

export function WorkspaceSettingsDialog({ ws, open, onClose }: { ws: { id: string; name: string; kind: Workspace["kind"] } | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { reloadMe } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<FieldError>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open && ws) {
      setName(ws.name);
      setDescription("");
      setLoadedFor(null);
      setError(null);
    }
  }
  const wsId = ws?.id;
  useEffect(() => {
    if (!open || !wsId) return;
    let alive = true;
    api<Workspace>(`/workspaces/${wsId}`)
      .then((w) => {
        if (!alive) return;
        setDescription(w.description ?? "");
        setLoadedFor(wsId);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, wsId]);
  if (!ws) return null;
  const save = async () => {
    if (!name.trim()) return setError({ field: "name", message: "Chưa nhập tên workspace" });
    setBusy(true);
    try {
      const loaded = loadedFor === ws.id;
      await api(`/workspaces/${ws.id}`, {
        method: "PATCH",
        body: { name: name.trim(), ...(loaded ? { description: description.trim() || null } : {}) },
      });
      await reloadMe();
      toast("success", "Đã lưu cài đặt workspace");
      onClose();
    } catch (err) {
      setError(apiFieldError(err, "name"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Cài đặt workspace"
        onSubmit={() => void save()}
        footer={
          <>
            {ws.kind === "TEAM" ? (
              <Button variant="danger" icon={Trash2} className="sm:mr-auto min-h-11 md:min-h-10" onClick={() => setConfirm(true)}>
                Xoá workspace
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose} className="min-h-11 md:min-h-10">
              Huỷ
            </Button>
            <Button type="submit" variant="primary" loading={busy} className="min-h-11 md:min-h-10">
              Lưu
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Tên" error={error?.field === "name" ? error.message : undefined}>
            {(id) => <Input id={id} maxLength={100} value={name} invalid={error?.field === "name"} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Mô tả">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                maxLength={500}
                value={description}
                disabled={loadedFor !== ws.id}
                placeholder={loadedFor !== ws.id ? "Đang tải…" : undefined}
                onChange={(e) => setDescription(e.target.value)}
                className={`${TEXTAREA} disabled:opacity-60`}
              />
            )}
          </Field>
          {ws.kind === "COMPANY" ? <p className="text-sm text-pretty text-muted">Đây là kho chung toàn công ty: mọi tài khoản LunaTech đều xem được và không xoá được workspace này.</p> : null}
          {error && !error.field ? <p className="text-sm text-err-text">{error.message}</p> : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Xoá workspace?"
        confirmLabel="Xoá workspace"
        onConfirm={async () => {
          try {
            await api(`/workspaces/${ws.id}`, { method: "DELETE" });
            await reloadMe();
            toast("success", `Đã xoá workspace «${ws.name}»`);
            onClose();
            router.push("/");
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        <span className="font-medium text-foreground">{ws.name}</span> cùng mọi tài liệu, video bên trong sẽ không ai truy cập được nữa.
      </ConfirmDialog>
    </>
  );
}
