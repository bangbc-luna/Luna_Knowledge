"use client";

import { ArrowLeft, Bookmark, History } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { api, describeError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { DocDiff, DocVersion, DocVersionDetail } from "@/lib/documents";
import { formatNumber, formatWhen } from "@/lib/format";
import { latexSource } from "@/lib/latex";
import { useApi } from "@/lib/use-api";
import { Button } from "../ui/button";
import { ConfirmDialog, Dialog, Sheet } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { EmptyState, ErrorBanner, SkeletonRows, Tabs } from "../ui/misc";
import { useToast } from "../ui/toast";

const LatexPreview = dynamic(() => import("./latex-workspace").then((m) => m.LatexPreview), { ssr: false });

function safeHtml(html: string) {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      if (a.name.startsWith("on")) el.removeAttribute(a.name);
      if ((a.name === "href" || a.name === "src") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

const versionTitle = (v: DocVersion) => v.name ?? (v.createdBy ? `Sửa bởi ${v.createdBy.name}` : "Tự động lưu");

export function SaveVersionDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName("");
      setError(null);
    }
  }
  const submit = async () => {
    if (!name.trim()) return setError("Nhập tên phiên bản");
    setBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Lưu phiên bản"
      description="Đặt tên để dễ tìm lại, ví dụ «Bản gửi khách» hay «Trước khi sửa mục 3»."
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            Lưu phiên bản
          </Button>
        </>
      }
    >
      <Field label="Tên phiên bản" error={error}>
        {(id) => <Input id={id} autoFocus maxLength={120} value={name} invalid={!!error} onChange={(e) => (setName(e.target.value), setError(null))} />}
      </Field>
    </Dialog>
  );
}

function VersionDetail({ nodeId, version, canRestore, onBack, onRestored }: { nodeId: string; version: DocVersion; canRestore: boolean; onBack: () => void; onRestored: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<"content" | "diff">("diff");
  const [confirm, setConfirm] = useState(false);
  const detail = useApi(() => api<DocVersionDetail>(`/documents/${nodeId}/versions/${version.id}`), [nodeId, version.id], { enabled: tab === "content" });
  const diff = useApi(() => api<DocDiff>(`/documents/${nodeId}/versions/${version.id}/diff`, { query: { with: "current" } }), [nodeId, version.id], { enabled: tab === "diff" });
  const latex = detail.data ? latexSource(detail.data.contentJson) : null;
  const html = useMemo(() => (detail.data && latexSource(detail.data.contentJson) === null ? safeHtml(detail.data.html) : ""), [detail.data]);

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface px-6 pt-3 pb-3">
        <Button variant="ghost" icon={ArrowLeft} className="-ml-3 min-h-8 rounded-lg px-3" onClick={onBack}>
          Tất cả phiên bản
        </Button>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground" title={versionTitle(version)}>
              {versionTitle(version)}
            </p>
            <p className="mt-0.5 text-xs text-muted tabular-nums">
              Phiên bản {version.versionNo} · {version.createdBy?.name ?? "Hệ thống"} · {formatWhen(version.createdAt, { withTime: true })}
            </p>
          </div>
          {canRestore ? (
            <Button variant="primary" icon={History} className="shrink-0" onClick={() => setConfirm(true)}>
              Khôi phục bản này
            </Button>
          ) : null}
        </div>
        <div className="-mx-1 mt-3">
          <Tabs
            label="Xem phiên bản"
            value={tab}
            onChange={setTab}
            items={[
              { value: "diff", label: "So với hiện tại" },
              { value: "content", label: "Nội dung" },
            ]}
          />
        </div>
      </div>
      <div className="flex-1 px-6 py-5">
        {tab === "content" ? (
          detail.error ? (
            <ErrorBanner error={detail.error} what="phiên bản" onRetry={() => void detail.reload()} />
          ) : !detail.data ? (
            <SkeletonRows rows={4} />
          ) : (
            latex !== null ? (
              <LatexPreview source={latex} />
            ) : (
              <div className="luna-prose" dangerouslySetInnerHTML={{ __html: html }} />
            )
          )
        ) : diff.error ? (
          <ErrorBanner error={diff.error} what="so sánh" onRetry={() => void diff.reload()} />
        ) : !diff.data ? (
          <SkeletonRows rows={4} />
        ) : (
          <>
            <p className="text-sm text-muted tabular-nums">
              {diff.data.stats.added || diff.data.stats.removed ? (
                <>
                  Bản hiện tại{" "}
                  {[
                    diff.data.stats.added ? <span key="a" className="font-medium text-ok">thêm {formatNumber(diff.data.stats.added)} từ</span> : null,
                    diff.data.stats.removed ? <span key="r" className="font-medium text-err">bớt {formatNumber(diff.data.stats.removed)} từ</span> : null,
                  ]
                    .filter(Boolean)
                    .flatMap((el, i) => (i ? [", ", el] : [el]))}{" "}
                  so với bản này.
                </>
              ) : (
                "Nội dung giống hệt bản hiện tại."
              )}
            </p>
            <div className="mt-4 text-sm/7 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
              {diff.data.parts.map((p, i) =>
                p.type === "same" ? (
                  <span key={i}>{p.text}</span>
                ) : p.type === "added" ? (
                  <ins key={i} className="rounded-sm bg-ok-bg text-ok no-underline">
                    {p.text}
                  </ins>
                ) : (
                  <del key={i} className="rounded-sm bg-err-bg text-err">
                    {p.text}
                  </del>
                ),
              )}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        danger={false}
        icon={History}
        title="Khôi phục phiên bản này?"
        confirmLabel="Khôi phục"
        onConfirm={async () => {
          try {
            await api(`/documents/${nodeId}/versions/${version.id}/restore`, { method: "POST" });
            toast("success", `Đã khôi phục phiên bản ${version.versionNo}`);
            onRestored();
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        Nội dung tài liệu sẽ thay bằng <span className="font-medium text-foreground">{versionTitle(version)}</span>. Bản hiện tại vẫn còn trong lịch sử, người đang mở sẽ thấy thay đổi ngay.
      </ConfirmDialog>
    </div>
  );
}

export function DocVersionsSheet({ nodeId, name, open, onClose, canEdit, refreshKey }: { nodeId: string; name: string; open: boolean; onClose: () => void; canEdit: boolean; refreshKey: unknown }) {
  const toast = useToast();
  const versions = useApi(() => api<DocVersion[]>(`/documents/${nodeId}/versions`), [nodeId, refreshKey], { enabled: open });
  const [selected, setSelected] = useState<DocVersion | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (!open) setSelected(null);
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Lịch sử phiên bản"
        width="sm:w-[28rem] lg:w-[44rem]"
        subtitle={<span className="block truncate">{name}</span>}
        footer={
          canEdit && !selected ? (
            <Button variant="primary" icon={Bookmark} onClick={() => setSaving(true)}>
              Lưu phiên bản
            </Button>
          ) : undefined
        }
      >
        {selected ? (
          <VersionDetail
            nodeId={nodeId}
            version={selected}
            canRestore={canEdit}
            onBack={() => setSelected(null)}
            onRestored={() => {
              setSelected(null);
              void versions.reload();
            }}
          />
        ) : versions.loading && !versions.data ? (
          <SkeletonRows rows={4} />
        ) : versions.error ? (
          <ErrorBanner error={versions.error} what="lịch sử phiên bản" onRetry={() => void versions.reload()} />
        ) : !versions.data?.length ? (
          <EmptyState text="Chưa có phiên bản nào. Phiên bản được lưu tự động khi mọi người đóng tài liệu, hoặc bấm Lưu phiên bản để đặt tên." />
        ) : (
          <ul className="p-2">
            {versions.data.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => setSelected(v)} className="flex w-full cursor-pointer items-start gap-3 rounded-xl px-4 py-3 text-left outline-hidden hover:bg-item-hover focus-visible:bg-item-hover">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", v.isAuto ? "bg-foreground/20" : "bg-foreground")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", v.isAuto ? "text-foreground/70" : "font-medium text-foreground")}>{versionTitle(v)}</span>
                    <span className="mt-0.5 block text-xs text-muted tabular-nums">
                      {v.createdBy?.name ?? "Hệ thống"} · {formatWhen(v.createdAt, { withTime: true })}
                    </span>
                    {v.wordsAdded || v.wordsRemoved ? (
                      <span className="mt-0.5 block text-xs tabular-nums">
                        {v.wordsAdded ? <span className="text-ok">+{formatNumber(v.wordsAdded)} từ</span> : null}
                        {v.wordsAdded && v.wordsRemoved ? <span className="text-muted"> · </span> : null}
                        {v.wordsRemoved ? <span className="text-err">−{formatNumber(v.wordsRemoved)} từ</span> : null}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 pt-0.5 text-xs text-muted tabular-nums">#{v.versionNo}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
      <SaveVersionDialog
        open={saving}
        onClose={() => setSaving(false)}
        onSave={async (versionName) => {
          await api(`/documents/${nodeId}/versions`, { method: "POST", body: { name: versionName } });
          toast("success", `Đã lưu phiên bản «${versionName}»`);
          await versions.reload();
        }}
      />
    </>
  );
}
