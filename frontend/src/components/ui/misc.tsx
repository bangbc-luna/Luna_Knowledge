"use client";

import { ChevronRight, CircleAlert, Ellipsis, RotateCw } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { describeError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { Button } from "./button";
import { focusRing } from "./focus";
import { PopoverPanel, usePopover } from "./popover";

const AVATAR_TONES = ["bg-zinc-200 text-zinc-700", "bg-stone-200 text-stone-700", "bg-neutral-200 text-neutral-700", "bg-slate-200 text-slate-700"];

export function Avatar({ name, src, size = "size-8" }: { name: string; src?: string | null; size?: string }) {
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" referrerPolicy="no-referrer" className={cn(size, "shrink-0 rounded-full object-cover")} />;
  }
  return (
    <span className={cn(size, tone, "inline-flex shrink-0 items-center justify-center rounded-full text-xs font-semibold")} aria-hidden>
      {initials(name)}
    </span>
  );
}

export type BadgeTone = "neutral" | "primary" | "ok" | "warn" | "err";
const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-neutral-bg text-neutral",
  primary: "bg-primary-light text-primary",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  err: "bg-err-bg text-err",
};

export function Badge({ tone = "neutral", small, children, className }: { tone?: BadgeTone; small?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap", small ? "h-5" : "h-6", BADGE[tone], className)}>
      {children}
    </span>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-3 border-t border-border px-3 first:border-t-0">
          <span className="size-8 shrink-0 animate-pulse rounded-lg bg-foreground/6" />
          <span className="h-3 animate-pulse rounded-full bg-foreground/6" style={{ width: `${[52, 38, 60, 30, 46][i % 5]}%` }} />
          <span className="ml-auto hidden h-3 w-24 animate-pulse rounded-full bg-foreground/6 sm:block" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ text, action }: { text: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-sm text-muted text-pretty">{text}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ error, what, onRetry }: { error: unknown; what: string; onRetry?: () => void }) {
  return (
    <div className="m-4 flex flex-col gap-3 rounded-xl border border-err-border bg-err-bg p-4 sm:m-5 sm:flex-row sm:items-center">
      <CircleAlert className="size-5 shrink-0 text-err" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-err">Không tải được {what}</p>
        <p className="mt-0.5 text-sm text-err [overflow-wrap:anywhere]">{describeError(error)}</p>
      </div>
      {onRetry ? (
        <Button icon={RotateCw} onClick={onRetry} className="shrink-0">
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-border bg-surface", className)}>{children}</section>;
}

function CrumbLink({ item, first, last }: { item: { label: string; href: string }; first: boolean; last: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.label}
      className={cn("inline-flex h-8 min-w-0 items-center truncate rounded-md px-1 hover:text-foreground", focusRing, first ? "-ml-1 max-w-32 shrink-0" : last ? "min-w-12 shrink" : "max-w-48 min-w-12 shrink-[3]")}
    >
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function CrumbOverflow({ items }: { items: Array<{ label: string; href: string }> }) {
  const { open, setOpen, toggle, rootRef } = usePopover();
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Thư mục cha khác"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
        className={cn("inline-flex h-8 cursor-pointer items-center rounded-md px-1 hover:text-foreground aria-expanded:text-foreground", focusRing)}
      >
        <Ellipsis className="size-4" aria-hidden />
      </button>
      <PopoverPanel open={open} className="w-64 max-w-[calc(100vw-24px)]">
        <div role="menu" className="px-1">
          {items.map((c, i) => (
            <Link
              key={c.href + i}
              role="menuitem"
              href={c.href}
              onClick={() => setOpen(false)}
              className="flex min-h-10 w-full items-center rounded-xl px-3 py-2 text-sm text-foreground outline-hidden hover:bg-item-hover focus-visible:bg-item-hover"
            >
              <span className="truncate">{c.label}</span>
            </Link>
          ))}
        </div>
      </PopoverPanel>
    </div>
  );
}

export function Breadcrumb({ items, tail = 2 }: { items: Array<{ label: string; href: string }>; tail?: number }) {
  if (!items.length) return null;
  const collapsed = items.length > tail + 1;
  const hidden = collapsed ? items.slice(1, -tail) : [];
  const shown = collapsed ? [items[0], ...items.slice(-tail)] : items;
  return (
    <nav aria-label="Đường dẫn" className="flex h-8 min-w-0 items-center gap-1 text-sm text-muted">
      {shown.map((c, i) => (
        <Fragment key={c.href + i}>
          {i ? <ChevronRight className="size-3.5 shrink-0" aria-hidden /> : null}
          {collapsed && i === 1 ? (
            <>
              <CrumbOverflow items={hidden} />
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            </>
          ) : null}
          <CrumbLink item={c} first={i === 0 && shown.length > 1} last={i === shown.length - 1} />
        </Fragment>
      ))}
    </nav>
  );
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string; count?: number }>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="scrollbar-clean flex gap-1 overflow-x-auto px-1 py-0.5">
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-3 text-sm font-medium transition-colors",
            focusRing,
            t.value === value ? "bg-secondary text-foreground" : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="text-xs font-normal tabular-nums text-foreground/70">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function TopBarTitle({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-1">{children}</div>;
}
