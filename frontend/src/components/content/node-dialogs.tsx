"use client";

import { ChevronRight, Folder, House } from "lucide-react";
import { useState } from "react";
import { api, ApiError, describeError } from "@/lib/api";
import type { NodeItem, Page, Tag } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { EmptyState, SkeletonRows } from "../ui/misc";

export function NameDialog({
  open,
  onClose,
  title,
  submitLabel,
  initial = "",
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  initial?: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(initial);
      setError(null);
      setSuggestion(null);
    }
  }
  const submit = async () => {
    if (!name.trim()) return setError("Nhập tên");
    setBusy(true);
    setError(null);
    setSuggestion(null);
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        setError("Thư mục này đã có mục cùng tên.");
        setSuggestion((err.details as { suggestion?: string } | undefined)?.suggestion ?? null);
      } else {
        setError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="min-h-11 md:min-h-10">
            Huỷ
          </Button>
          <Button type="submit" variant="primary" loading={busy} className="min-h-11 md:min-h-10">
            {submitLabel}
          </Button>
        </>
      }
    >
      <Field
        label="Tên"
        error={
          error ? (
            <>
              {error}{" "}
              {suggestion ? (
                <button type="button" className="cursor-pointer font-medium underline underline-offset-4" onClick={() => setName(suggestion)}>
                  Dùng «{suggestion}»
                </button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {(id) => <Input id={id} autoFocus value={name} invalid={!!error} maxLength={255} onChange={(e) => setName(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

export function MoveDialog({
  open,
  onClose,
  node,
  workspaceId,
  canUseRoot,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  node: NodeItem | null;
  workspaceId: string;
  canUseRoot: boolean;
  onMoved: () => void;
}) {
  const [trail, setTrail] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: "Gốc workspace" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setTrail([{ id: null, name: "Gốc workspace" }]);
      setError(null);
    }
  }
  const current = trail[trail.length - 1]!;
  const { data, loading, error: loadError } = useApi(
    () => api<Page<NodeItem>>(`/workspaces/${workspaceId}/nodes`, { query: { parentId: current.id ?? undefined, type: "FOLDER", limit: 200 } }),
    [workspaceId, current.id, open],
    { enabled: open && !!node },
  );
  if (!node) return null;
  const sameParent = current.id === node.parentId;
  const blockedRoot = current.id === null && !canUseRoot;
  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/nodes/${node.id}/move`, { method: "POST", body: { targetParentId: current.id } });
      onMoved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "CONFLICT" ? "Thư mục đích đã có mục cùng tên. Đổi tên trước khi chuyển." : describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Di chuyển «${node.name}»`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="min-h-11 md:min-h-10">
            Huỷ
          </Button>
          <Button variant="primary" loading={busy} disabled={sameParent || blockedRoot} onClick={move} className="min-h-11 md:min-h-10">
            Chuyển vào đây
          </Button>
        </>
      }
    >
      <nav aria-label="Vị trí đang chọn" className="mb-3 flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted">
        {trail.map((t, i) => (
          <span key={t.id ?? "root"} className="flex min-w-0 items-center gap-1">
            {i ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : null}
            <button
              type="button"
              onClick={() => setTrail(trail.slice(0, i + 1))}
              className={cn("inline-flex h-8 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 hover:text-foreground", i === trail.length - 1 && "font-medium text-foreground")}
            >
              {i === 0 ? <House className="size-3.5 shrink-0" aria-hidden /> : null}
              <span className="truncate">{t.name}</span>
            </button>
          </span>
        ))}
      </nav>
      <div className="rounded-xl border border-border-strong">
        {loading ? (
          <SkeletonRows rows={3} />
        ) : loadError ? (
          <p className="p-4 text-sm text-err-text">{describeError(loadError)}</p>
        ) : (
          (() => {
            const folders = (data?.items ?? []).filter((f) => f.id !== node.id);
            return folders.length ? (
              <ul className="max-h-64 overflow-y-auto py-1">
                {folders.map((f) => (
                  <li key={f.id} className="px-1">
                    <button
                      type="button"
                      onClick={() => setTrail([...trail, { id: f.id, name: f.name }])}
                      className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-item-hover"
                    >
                      <Folder className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text="Không có thư mục con." />
            );
          })()
        )}
      </div>
      {sameParent ? <p className="mt-2 text-xs text-muted">Mục đang nằm ở đây rồi.</p> : null}
      {blockedRoot ? <p className="mt-2 text-xs text-muted">Bạn không có quyền đặt mục ở gốc workspace.</p> : null}
      {error ? <p className="mt-2 text-sm text-err-text">{error}</p> : null}
    </Dialog>
  );
}

export function TagsDialog({
  open,
  onClose,
  node,
  workspaceId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  node: NodeItem | null;
  workspaceId: string;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastNode, setLastNode] = useState<string | null>(null);
  if (open && node && node.id !== lastNode) {
    setLastNode(node.id);
    setSelected(new Set(node.tags.map((t) => t.id)));
    setError(null);
  }
  if (!open && lastNode) setLastNode(null);
  const { data: tags, loading } = useApi(() => api<Tag[]>(`/workspaces/${workspaceId}/tags`), [workspaceId, open], { enabled: open });
  if (!node) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Gắn tag cho «${node.name}»`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="min-h-11 md:min-h-10">
            Huỷ
          </Button>
          <Button
            variant="primary"
            loading={busy}
            className="min-h-11 md:min-h-10"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(`/nodes/${node.id}/tags`, { method: "PUT", body: { tagIds: [...selected] } });
                onSaved();
                onClose();
              } catch (err) {
                setError(describeError(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Lưu
          </Button>
        </>
      }
    >
      {loading ? (
        <SkeletonRows rows={3} />
      ) : tags?.length ? (
        <ul className="flex flex-col gap-1">
          {tags.map((t) => {
            const on = selected.has(t.id);
            return (
              <li key={t.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-item-hover">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = new Set(selected);
                      if (on) next.delete(t.id);
                      else next.add(t.id);
                      setSelected(next);
                    }}
                    className="size-4 cursor-pointer accent-[var(--primary)]"
                  />
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState text="Workspace chưa có tag nào. Quản trị workspace tạo tag ở mục Tag." />
      )}
      {error ? <p className="mt-2 text-sm text-err-text">{error}</p> : null}
    </Dialog>
  );
}
