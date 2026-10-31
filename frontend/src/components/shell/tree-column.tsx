"use client";

import { Clock, Globe, Search, Settings, Star, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { WS_ROLE_LABEL } from "@/lib/format";
import { useActiveSection } from "@/lib/section";
import type { NodeSection } from "@/lib/types";
import { useShellWorkspace } from "@/lib/workspace";
import { ContentTree } from "./content-tree";
import { NavLink } from "./nav";
import { TreeCreateMenu } from "./tree-create-menu";
import { WorkspaceSettingsDialog } from "./workspace-dialogs";

let lastSection: NodeSection = "DOCS";

const TABS: Array<{ section: NodeSection; label: string; path: string }> = [
  { section: "DOCS", label: "Tài liệu", path: "f" },
  { section: "VIDEOS", label: "Video", path: "v" },
];

export function TreeColumn() {
  const pathname = usePathname();
  const { me } = useAuth();
  const { ws, routeWsId, isMember } = useShellWorkspace();
  const params = useParams<{ nodeId?: string; folder?: string[] }>();
  const foreign = !!routeWsId && !isMember;
  const activeId = ws && routeWsId === ws.id ? (params.nodeId ?? params.folder?.[0] ?? null) : null;
  const [settings, setSettings] = useState(false);
  const active = useActiveSection();
  useEffect(() => {
    if (active) lastSection = active;
  }, [active]);
  const section = active ?? lastSection;
  const canManage = !!ws && !foreign && (ws.role === "ADMIN" || !!me?.isSystemAdmin);
  const tabsMuted = !active || foreign;
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
                    on && !tabsMuted ? "bg-surface font-medium text-foreground" : on ? "text-foreground hover:bg-surface/60" : "text-foreground/60 hover:bg-surface/60 hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
      {foreign ? (
        <div className="mx-3 mt-3 flex shrink-0 gap-2 rounded-xl bg-secondary px-3 py-2 text-xs text-foreground/80">
          <Users className="mt-px size-3.5 shrink-0 text-muted" aria-hidden />
          <p className="min-w-0">
            <span className="block font-medium text-foreground">Đang xem mục được chia sẻ</span>
            Cây bên dưới thuộc {ws?.name ?? "workspace của bạn"}.
          </p>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
        {ws ? (
          <>
            <div className="flex h-7 shrink-0 items-center gap-1 pr-1 pl-2">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted" title={foreign ? ws.name : undefined}>
                {foreign ? `Thư mục của ${ws.name}` : section === "VIDEOS" ? "Thư mục video" : "Thư mục tài liệu"}
              </p>
              {ws.role !== "VIEWER" ? <TreeCreateMenu wsId={ws.id} section={section} parentId={null} label={`Tạo mới ở gốc ${section === "VIDEOS" ? "Video" : "Tài liệu"}`} /> : null}
            </div>
            <ContentTree wsId={ws.id} section={section} activeId={activeId} />
          </>
        ) : me ? (
          <div className="px-2 py-2 text-sm text-pretty text-muted">
            <p className="font-medium text-foreground">Bạn chưa thuộc workspace nào</p>
            <p className="mt-1">Bấm + ở cột bên trái để tạo workspace, hoặc xem các mục người khác chia sẻ ở Được chia sẻ.</p>
          </div>
        ) : null}
      </div>
      {base && !foreign && ws?.role !== "VIEWER" ? (
        <div className="shrink-0 border-t border-border px-3 py-2">
          <NavLink href={`${base}/trash`} icon={Trash2} label="Thùng rác" active={pathname === `${base}/trash`} />
        </div>
      ) : null}
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
