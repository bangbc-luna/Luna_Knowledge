"use client";

import { Clock, Globe, Search, Settings, Star, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { WS_ROLE_LABEL } from "@/lib/format";
import { useActiveSection } from "@/lib/section";
import type { NodeSection } from "@/lib/types";
import { useShellWorkspace } from "@/lib/workspace";
import { NavLink } from "./nav";
import { WorkspaceSettingsDialog } from "./workspace-dialogs";

let lastSection: NodeSection = "DOCS";

const TABS: Array<{ section: NodeSection; label: string; path: string }> = [
  { section: "DOCS", label: "Tài liệu", path: "f" },
  { section: "VIDEOS", label: "Video", path: "v" },
];

export function TreeColumn() {
  const pathname = usePathname();
  const { me } = useAuth();
  const { ws } = useShellWorkspace();
  const [settings, setSettings] = useState(false);
  const active = useActiveSection();
  useEffect(() => {
    if (active) lastSection = active;
  }, [active]);
  const section = active ?? lastSection;
  const canManage = !!ws && (ws.role === "ADMIN" || !!me?.isSystemAdmin);
  const base = ws ? `/w/${ws.id}` : null;
  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold" title={ws?.name}>
            {ws?.name ?? "Luna Knowledge"}
          </p>
          {ws ? (
            <p className="truncate text-xs leading-tight text-muted">
              {ws.kind === "COMPANY" ? "Công ty" : "Workspace"} · {WS_ROLE_LABEL[ws.role]}
            </p>
          ) : null}
        </div>
        {canManage ? (
          <button
            type="button"
            title="Cài đặt workspace"
            aria-label="Cài đặt workspace"
            onClick={() => setSettings(true)}
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted outline-hidden hover:bg-item-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Settings className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {base ? (
        <div className="shrink-0 px-3 pt-3">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
            {TABS.map((t) => {
              const on = t.section === section;
              return (
                <Link
                  key={t.section}
                  href={`${base}/${t.path}`}
                  aria-current={on && active ? "page" : undefined}
                  className={cn(
                    "flex h-7 items-center justify-center rounded-lg text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                    on ? "bg-surface font-medium text-foreground" : "text-foreground/70 hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
        <div className="flex-1" />
        {base && ws?.role !== "VIEWER" ? <NavLink href={`${base}/trash`} icon={Trash2} label="Thùng rác" active={pathname === `${base}/trash`} /> : null}
      </div>
      <nav aria-label="Chung mọi workspace" className="flex shrink-0 flex-col gap-1 border-t border-border px-3 pt-2 pb-3">
        <p className="flex h-7 items-center gap-1.5 px-3 text-xs font-medium text-muted">
          <Globe className="size-3.5 shrink-0" aria-hidden />
          Chung mọi workspace
        </p>
        <NavLink href="/shared" icon={Users} label="Được chia sẻ" active={pathname === "/shared"} />
        <NavLink href="/favorites" icon={Star} label="Yêu thích" active={pathname === "/favorites"} />
        <NavLink href="/recent" icon={Clock} label="Gần đây" active={pathname === "/recent"} />
        <NavLink href="/search" icon={Search} label="Tìm kiếm" active={pathname === "/search"} />
      </nav>
      <WorkspaceSettingsDialog ws={ws ? { id: ws.id, name: ws.name, kind: ws.kind } : null} open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
