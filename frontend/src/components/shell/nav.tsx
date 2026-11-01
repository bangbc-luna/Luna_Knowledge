"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export function NavLink({ href, icon: Icon, label, active }: { href: string; icon: LucideIcon; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm outline-hidden transition-colors",
        active ? "bg-secondary font-medium text-foreground" : "text-foreground/70 hover:bg-item-hover hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}

export function NavGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 [&+&]:mt-3">
      {label ? <p className="flex h-10 items-center px-3 text-xs font-medium tracking-wide text-muted uppercase">{label}</p> : null}
      {children}
    </div>
  );
}

export function Logo({ subtitle, children }: { subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">L</span>
      {children ?? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Luna Knowledge</p>
          {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
        </div>
      )}
    </div>
  );
}
