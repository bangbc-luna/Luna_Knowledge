"use client";

import { Trash2, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Button } from "./button";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

/** Modal có nội dung: max-w-md, bấm ngoài / Esc đóng, nút ở chân phải (overlay.md). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer: React.ReactNode;
  onSubmit?: () => void;
}) {
  const titleId = useId();
  useEscape(open, onClose);
  if (!open) return null;
  const Body = onSubmit ? "form" : "div";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="animate-fade absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <Body
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={
          onSubmit
            ? (event: React.FormEvent) => {
                event.preventDefault();
                onSubmit();
              }
            : undefined
        }
        className="animate-dialog relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-2xl border border-border bg-surface shadow-modal"
      >
        <div className="flex items-start gap-3 px-6 pt-5 pb-1">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-balance">
              {title}
            </h2>
            {description ? <div className="mt-1 text-sm text-muted text-pretty">{description}</div> : null}
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="-mr-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {children ? <div className="min-h-0 overflow-y-auto px-6 py-4">{children}</div> : <div className="h-3" />}
        <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>
      </Body>
    </div>,
    document.body,
  );
}

/** Hộp xác nhận: icon cùng hàng tiêu đề, tên đối tượng in đậm trong câu hậu quả (overlay.md). */
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  danger = true,
  icon: Icon = Trash2,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  danger?: boolean;
  icon?: LucideIcon;
}) {
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  useEscape(open && !busy, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="animate-fade absolute inset-0 bg-black/30" onClick={() => !busy && onClose()} aria-hidden />
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="animate-dialog relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-modal">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", danger ? "bg-rose-500/10" : "bg-foreground/5")}>
            <Icon className={cn("size-5", danger ? "text-rose-700" : "text-foreground/70")} aria-hidden />
          </div>
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="col-span-2 mt-2 min-w-0 text-sm/6 text-muted sm:col-span-1 sm:col-start-2 sm:mt-0.5">{children}</div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy} className="min-h-11 md:min-h-10">
            Huỷ
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            className="min-h-11 md:min-h-10"
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Panel trượt từ phải, w-full sm:w-[28rem], lớp phủ mờ /15 để vẫn thấy danh sách phía sau. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="animate-fade absolute inset-0 bg-black/15" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-sheet-right absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-surface shadow-modal sm:w-[28rem]"
      >
        <div className="flex items-start gap-3 border-b border-border px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-lg font-semibold">
              {title}
            </h2>
            {subtitle ? <div className="text-sm text-muted">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="-mr-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
