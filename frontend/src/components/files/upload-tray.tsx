"use client";

import { ChevronDown, CircleAlert, CircleCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/files";
import type { FileDuplicate, NodeItem } from "@/lib/types";
import { type UploadItem, useUploads } from "@/lib/uploads";
import { IconButton } from "../ui/button";
import { FileTypeIcon } from "./file-type-icon";

export function MiddleTruncate({ name, className }: { name: string; className?: string }) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const base = dot > 0 ? name.slice(0, dot) : name;
  const keep = Math.min(8, Math.max(0, base.length - 8));
  const head = base.slice(0, base.length - keep);
  const tail = base.slice(base.length - keep) + ext;
  return (
    <p className={cn("flex min-w-0 flex-1 text-sm font-medium text-foreground", className)} title={name.length > 40 ? name : undefined}>
      <span className="overflow-hidden text-ellipsis whitespace-pre">{head}</span>
      <span className="shrink-0 whitespace-pre">{tail}</span>
    </p>
  );
}

const DUPLICATE_POLL_MS = 3000;
const DUPLICATE_POLL_MAX = 40;

function useDuplicates(nodeId: string | undefined, enabled: boolean) {
  const [duplicates, setDuplicates] = useState<FileDuplicate[]>([]);
  useEffect(() => {
    if (!enabled || !nodeId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      try {
        const d = await api<{ status: NodeItem["status"]; duplicates: FileDuplicate[] }>(`/files/${nodeId}/duplicates`);
        if (stopped) return;
        if (d.status === "READY" || d.status === "FAILED") {
          setDuplicates(d.duplicates);
          return;
        }
      } catch {
        return;
      }
      if (attempt < DUPLICATE_POLL_MAX) timer = setTimeout(() => void check(attempt + 1), DUPLICATE_POLL_MS);
    };
    timer = setTimeout(() => void check(1), DUPLICATE_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [nodeId, enabled]);
  return duplicates;
}

function UploadRow({ item }: { item: UploadItem }) {
  const { retry, cancel } = useUploads();
  const duplicates = useDuplicates(item.nodeId, item.status === "done");
  const firstDup = duplicates[0];
  const pct = Math.round(item.progress * 100);
  return (
    <li className="flex items-center gap-3 py-3">
      <FileTypeIcon name={item.name} mime={item.file.type} className="size-5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          {item.title ? <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.title}</p> : <MiddleTruncate name={item.name} />}
          {item.status === "uploading" ? <p className="shrink-0 text-sm text-muted tabular-nums">{pct}%</p> : null}
        </div>
        <div className="mt-1 flex min-h-5 items-center">
          {item.status === "uploading" ? (
            <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Đang tải ${item.name}`} className="h-1 w-full rounded-full bg-foreground/5">
              <div className="h-1 rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
          ) : item.status === "queued" ? (
            <p className="text-xs text-muted tabular-nums">Đang chờ · {formatBytes(item.file.size)}</p>
          ) : item.status === "done" ? (
            <p className="flex items-center gap-1 text-xs text-muted tabular-nums">
              <CircleCheck className="size-3.5 shrink-0 text-ok" aria-hidden />
              {item.replaceNodeId ? "Đã tải phiên bản mới" : "Đã tải xong"} · {formatBytes(item.file.size)}
            </p>
          ) : (
            <p className="text-xs text-pretty text-err-text">
              {item.error}
              {item.suggestion ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => retry(item.id, item.suggestion)}
                    className="relative cursor-pointer text-left font-medium text-foreground underline-offset-2 [overflow-wrap:anywhere] before:absolute before:-inset-x-1.5 before:-inset-y-2 hover:underline"
                  >
                    Đổi thành «{item.suggestion}»
                  </button>
                </>
              ) : item.retryable ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => retry(item.id)}
                    className="relative cursor-pointer font-medium whitespace-nowrap text-foreground underline-offset-2 before:absolute before:-inset-x-1.5 before:-inset-y-2 hover:underline"
                  >
                    Thử lại
                  </button>
                </>
              ) : null}
            </p>
          )}
        </div>
        {item.status === "done" && firstDup ? (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-pretty text-foreground">
            <CircleAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Trùng nội dung với{" "}
              <Link href={`/w/${firstDup.workspace.id}/file/${firstDup.id}`} className="font-medium underline underline-offset-2 hover:text-primary">
                «{firstDup.name}»
              </Link>
              {duplicates.length > 1 ? ` và ${duplicates.length - 1} mục khác` : ""}
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex w-8 shrink-0 justify-end">
        {item.status !== "done" ? (
          <IconButton icon={X} label={item.status === "uploading" ? `Huỷ tải ${item.name}` : `Bỏ tệp ${item.name}`} onClick={() => cancel(item.id)} />
        ) : null}
      </div>
    </li>
  );
}

export function UploadTray() {
  const { items: all, clearFinished } = useUploads();
  const items = all.filter((i) => i.status !== "draft");
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const count = items.length;
  const lastCount = useRef(count);
  useEffect(() => {
    if (count > lastCount.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    lastCount.current = count;
  }, [count]);
  if (!items.length) return null;

  const active = items.filter((i) => i.status === "uploading" || i.status === "queued").length;
  const failed = items.filter((i) => i.status === "error").length;
  const done = items.filter((i) => i.status === "done").length;
  const title = active
    ? `Đang tải lên ${done}/${items.length - failed} tệp`
    : failed
      ? `${failed} tệp chưa tải lên được`
      : `Đã tải lên ${done} tệp`;

  return (
    <section
      aria-label="Tải lên"
      className="animate-pop fixed inset-x-4 bottom-4 z-40 flex max-h-[min(28rem,calc(100dvh-6rem))] flex-col rounded-2xl border border-border bg-surface-overlay shadow-popover sm:left-auto sm:w-[24rem]"
    >
      <div className="flex items-center gap-1 py-2 pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tabular-nums" aria-live="polite">
          {title}
        </h2>
        <IconButton icon={ChevronDown} label={collapsed ? "Mở rộng" : "Thu gọn"} onClick={() => setCollapsed((c) => !c)} className={cn("transition-transform", collapsed && "rotate-180")} />
        {!active ? <IconButton icon={X} label="Đóng khay tải lên" onClick={clearFinished} /> : null}
      </div>
      {!collapsed ? (
        <ul ref={listRef} className="min-h-0 divide-y divide-border overflow-y-auto border-t border-border px-4">
          {items.map((item) => (
            <UploadRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
