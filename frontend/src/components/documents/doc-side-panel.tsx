"use client";

import { PanelRight, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { focusRing } from "../ui/focus";
import { Tabs } from "../ui/misc";

export type DocPanelTab = "outline" | "comments";

const KEY = "luna:docPanel";
const DEFAULT = { open: true, tab: "outline" as DocPanelTab };

const listeners = new Set<() => void>();
let current: { open: boolean; tab: DocPanelTab } | null = null;

function read() {
  if (current) return current;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { open?: unknown; tab?: unknown } | null;
    current = {
      open: typeof raw?.open === "boolean" ? raw.open : DEFAULT.open,
      tab: raw?.tab === "comments" ? "comments" : "outline",
    };
  } catch {
    current = DEFAULT;
  }
  return current;
}

function write(next: Partial<{ open: boolean; tab: DocPanelTab }>) {
  current = { ...read(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
  }
  listeners.forEach((l) => l());
}

const setOpen = (v: boolean) => write({ open: v });
const setTab = (t: DocPanelTab) => write({ tab: t });

export function useDocPanel() {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => DEFAULT,
  );
  return {
    open: state.open,
    tab: state.tab,
    setOpen,
    setTab,
  };
}

export function DocPanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label="Mục lục và bình luận"
      title="Mục lục và bình luận"
      onClick={onToggle}
      className={cn("inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground aria-pressed:bg-foreground/5 aria-pressed:text-foreground", focusRing)}
    >
      <PanelRight className="size-4" aria-hidden />
    </button>
  );
}

export function DocPanelTabs({ tab, onTab, commentCount }: { tab: DocPanelTab; onTab: (t: DocPanelTab) => void; commentCount: number }) {
  return (
    <Tabs
      label="Mục lục và bình luận"
      value={tab}
      onChange={onTab}
      items={[
        { value: "outline", label: "Mục lục" },
        { value: "comments", label: "Bình luận", count: commentCount },
      ]}
    />
  );
}

export function DocSidePanel({
  tab,
  onTab,
  onClose,
  outline,
  comments,
  commentCount,
}: {
  tab: DocPanelTab;
  onTab: (t: DocPanelTab) => void;
  onClose: () => void;
  outline: React.ReactNode;
  comments: React.ReactNode;
  commentCount: number;
}) {
  return (
    <aside aria-label="Mục lục và bình luận" className="sticky top-11 flex h-[calc(100dvh-2.75rem)] w-72 shrink-0 flex-col self-start border-l border-border bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-1 pl-2">
        <div className="min-w-0 flex-1">
          <DocPanelTabs tab={tab} onTab={onTab} commentCount={commentCount} />
        </div>
        <button
          type="button"
          aria-label="Đóng cột mục lục và bình luận"
          onClick={onClose}
          className={cn("inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted hover:bg-foreground/5 hover:text-foreground", focusRing)}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div role="tabpanel" aria-label={tab === "outline" ? "Mục lục" : "Bình luận"} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {tab === "outline" ? outline : comments}
      </div>
    </aside>
  );
}
