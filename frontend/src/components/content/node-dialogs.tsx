"use client";

import { ChevronRight, Folder, House, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SECTION_LABEL, WS_ROLE_LABEL } from "@/lib/format";
import type { NodeItem, NodeSection, Page, Tag } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { EmptyState, SkeletonRows } from "../ui/misc";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast";
import { CreateWorkspaceDialog } from "../shell/workspace-dialogs";

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

type Crumb = { id: string | null; name: string };

function FolderBrowser({
  workspaceId,
  section,
  trail,
  onTrail,
  excludeId,
  enabled,
}: {
  workspaceId: string;
  section: NodeSection;
  trail: Crumb[];
  onTrail: (trail: Crumb[]) => void;
  excludeId?: string;
  enabled: boolean;
}) {
  const current = trail[trail.length - 1]!;
  const { data, loading, error } = useApi(
    () => api<Page<NodeItem>>(`/workspaces/${workspaceId}/nodes`, { query: { parentId: current.id ?? undefined, section: current.id ? undefined : section, type: "FOLDER", limit: 200 } }),
    [workspaceId, current.id, section, enabled],
    { enabled },
  );
  const folders = (data?.items ?? []).filter((f) => f.id !== excludeId);
  return (
    <>
      <nav aria-label="Vị trí đang chọn" className="mb-3 flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted">
        {trail.map((t, i) => (
          <span key={t.id ?? "root"} className="flex min-w-0 items-center gap-1">
            {i ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : null}
            <button
              type="button"
              onClick={() => onTrail(trail.slice(0, i + 1))}
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
        ) : error ? (
          <p className="p-4 text-sm text-err-text">{describeError(error)}</p>
        ) : folders.length ? (
          <ul className="max-h-64 overflow-y-auto py-1">
            {folders.map((f) => (
              <li key={f.id} className="px-1">
                <button
                  type="button"
                  onClick={() => onTrail([...trail, { id: f.id, name: f.name }])}
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
        )}
      </div>
    </>
  );
}

export function MoveDialog({
  open,
  onClose,
  node,
  workspaceId,
  canUseRoot,
  section,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  node: NodeItem | null;
  workspaceId: string;
  canUseRoot: boolean;
  section: NodeSection;
  onMoved: () => void;
}) {
  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: SECTION_LABEL[section] }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setTrail([{ id: null, name: SECTION_LABEL[section] }]);
      setError(null);
    }
  }
  if (!node) return null;
  const current = trail[trail.length - 1]!;
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
      <FolderBrowser workspaceId={workspaceId} section={section} trail={trail} onTrail={setTrail} excludeId={node.id} enabled={open} />
      {sameParent ? <p className="mt-2 text-xs text-muted">Mục đang nằm ở đây rồi.</p> : null}
      {blockedRoot ? <p className="mt-2 text-xs text-muted">Bạn không có quyền đặt mục ở gốc workspace.</p> : null}
      {error ? <p className="mt-2 text-sm text-err-text">{error}</p> : null}
    </Dialog>
  );
}

export interface CopySource {
  id: string;
  name: string;
  workspaceId: string;
  parentId: string | null;
  parentName?: string | null;
}

export function CopyDialog({ open, onClose, source }: { open: boolean; onClose: () => void; source: CopySource | null }) {
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const targets = (me?.workspaces ?? []).filter((w) => w.role === "ADMIN" || w.role === "MEMBER");
  const rootCrumb: Crumb = { id: null, name: SECTION_LABEL.DOCS };
  const initialTrail = (wsId: string | null): Crumb[] =>
    source && wsId === source.workspaceId && source.parentId ? [rootCrumb, { id: source.parentId, name: source.parentName ?? "Thư mục hiện tại" }] : [rootCrumb];
  const pickDefault = () => (source && targets.some((w) => w.id === source.workspaceId) ? source.workspaceId : (targets.find((w) => w.kind === "TEAM") ?? targets[0])?.id ?? null);

  const [wsId, setWsId] = useState<string | null>(null);
  const [trail, setTrail] = useState<Crumb[]>([rootCrumb]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open && source) {
      const first = pickDefault();
      setWsId(first);
      setTrail(initialTrail(first));
      setName(`${source.name} (bản sao)`);
      setError(null);
      setSuggestion(null);
      setCreating(false);
    }
  }
  if (!source) return null;

  const chooseWorkspace = (id: string) => {
    setWsId(id);
    setTrail(initialTrail(id));
  };
  const current = trail[trail.length - 1]!;
  const submit = async () => {
    if (!wsId) return;
    if (!name.trim()) return setError("Nhập tên");
    setBusy(true);
    setError(null);
    setSuggestion(null);
    try {
      const copy = await api<{ node: NodeItem }>(`/documents/${source.id}/copy`, {
        method: "POST",
        body: { workspaceId: wsId, parentId: current.id, name: name.trim() },
      });
      toast("success", "Đã tạo bản sao");
      onClose();
      router.push(`/w/${copy.node.workspaceId}/doc/${copy.node.id}`);
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

  if (creating) {
    return (
      <CreateWorkspaceDialog
        open={open}
        onClose={() => setCreating(false)}
        onCreated={(ws) => {
          setCreating(false);
          chooseWorkspace(ws.id);
        }}
      />
    );
  }

  const noTarget = !targets.length;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Tạo bản sao «${source.name}»`}
      description="Không chép lịch sử phiên bản, bình luận, chia sẻ, tag."
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="min-h-11 md:min-h-10">
            Huỷ
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={noTarget} className="min-h-11 md:min-h-10">
            Tạo bản sao
          </Button>
        </>
      }
    >
      {noTarget ? (
        <div className="rounded-xl border border-border-strong">
          <EmptyState
            text="Bạn chưa có workspace nào được thêm tài liệu. Tạo một workspace nhóm để lưu bản sao."
            action={
              <Button icon={Plus} variant="secondary" onClick={() => setCreating(true)}>
                Tạo workspace
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
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
          <Field label="Workspace">
            {(id) => (
              <Select
                id={id}
                value={wsId ?? ""}
                onChange={chooseWorkspace}
                options={targets.map((w) => ({ value: w.id, label: w.name, hint: WS_ROLE_LABEL[w.role] }))}
                className="w-full"
              />
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">Thư mục</p>
            {wsId ? <FolderBrowser workspaceId={wsId} section="DOCS" trail={trail} onTrail={setTrail} enabled={open} /> : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}

const TAG_COLORS = ["#e5534b", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#4f46e5", "#9333ea", "#db2777", "#6b7280"];

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
  const { data: tags, loading, setData: setTags } = useApi(() => api<Tag[]>(`/workspaces/${workspaceId}/tags`), [workspaceId, open], { enabled: open });
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const createTag = async () => {
    const name = newName.trim();
    if (!name) return;
    const existing = tags?.find((t) => t.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"));
    if (existing) {
      setSelected((prev) => new Set(prev).add(existing.id));
      setNewName("");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const color = TAG_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length]!;
      const tag = await api<Tag>(`/workspaces/${workspaceId}/tags`, { method: "POST", body: { name, color } });
      setTags((list) => [...(list ?? []), tag].sort((a, b) => a.name.localeCompare(b.name, "vi")));
      setSelected((prev) => new Set(prev).add(tag.id));
      setNewName("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  };
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
        <EmptyState text="Workspace chưa có tag nào. Gõ tên bên dưới để tạo tag đầu tiên." />
      )}
      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <Input
          aria-label="Tên tag mới"
          placeholder="Tạo tag mới, ví dụ Hợp đồng"
          maxLength={40}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void createTag();
            }
          }}
        />
        <Button icon={Plus} loading={creating} disabled={!newName.trim()} className="shrink-0" onClick={() => void createTag()}>
          Tạo
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-err-text">{error}</p> : null}
    </Dialog>
  );
}
