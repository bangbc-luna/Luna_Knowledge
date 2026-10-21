"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export function useAnchored() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return { open, setOpen, toggle, anchorRef, panelRef };
}

export function AnchoredPanel({
  open,
  anchorRef,
  panelRef,
  align = "left",
  offset = 4,
  className,
  children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  align?: "left" | "right";
  offset?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !panelRef.current) {
      setPos(null);
      return;
    }
    const a = anchorRef.current.getBoundingClientRect();
    const p = panelRef.current.getBoundingClientRect();
    let left = align === "right" ? a.right - p.width : a.left;
    left = Math.max(8, Math.min(left, innerWidth - p.width - 8));
    let top = a.bottom + offset;
    if (top + p.height > innerHeight - 8 && a.top - p.height - offset > 8) top = a.top - p.height - offset;
    setPos({ top, left });
  }, [open, align, offset, anchorRef, panelRef]);
  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      className={cn("animate-pop fixed z-50 rounded-2xl border border-border bg-surface-overlay py-1 shadow-popover", className)}
    >
      {children}
    </div>,
    document.body,
  );
}
