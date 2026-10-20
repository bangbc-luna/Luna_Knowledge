"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Lớp nổi bám nút mở: bấm ngoài hoặc Esc thì đóng; gần đáy màn thì lật lên (overlay.md, "Gần mép thì lật").
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return { open, setOpen, toggle, rootRef };
}

export function PopoverPanel({
  open,
  align = "left",
  className,
  children,
}: {
  open: boolean;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setUp(rect.bottom > innerHeight - 8 && rect.top - rect.height - 48 > 0);
  }, [open]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cn(
        "animate-pop absolute z-40 rounded-2xl border border-border bg-surface-overlay py-1 shadow-popover",
        up ? "bottom-full mb-1" : "top-full mt-1",
        align === "right" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Mục trong menu/danh sách chọn: rộng hết hàng, cao 40px, bo 12px (overlay.md). */
export function MenuItem({
  children,
  onClick,
  danger,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
        danger ? "hover:bg-rose-500/10 hover:text-rose-700 focus-visible:bg-rose-500/10" : "hover:bg-item-hover focus-visible:bg-item-hover",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const MenuSeparator = () => <div className="my-1 border-t border-border" role="separator" />;
