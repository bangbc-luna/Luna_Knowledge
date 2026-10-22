"use client";

import { Building2, Check, ChevronsUpDown, Clapperboard, Clock, FileText, Plus, Settings, Star, Trash2, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { WS_ROLE_LABEL } from "@/lib/format";
import { useActiveSection } from "@/lib/section";
import { useCurrentWorkspace } from "@/lib/workspace";
import { MenuItem, MenuSeparator, PopoverPanel, usePopover } from "../ui/popover";
import { CreateWorkspaceDialog, WorkspaceSettingsDialog } from "./workspace-dialogs";
import { Logo, NavGroup, NavLink } from "./nav";

function WorkspaceSwitcher() {
  const { me } = useAuth();
  const { ws } = useCurrentWorkspace();
  const { open, setOpen, toggle, rootRef } = usePopover();
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const list = me?.workspaces ?? [];
  const company = list.filter((w) => w.kind === "COMPANY");
  const teams = list.filter((w) => w.kind !== "COMPANY");
  const canManage = !!ws && (ws.role === "ADMIN" || !!me?.isSystemAdmin);
  const item = (w: (typeof list)[number]) => (
    <Link
      key={w.id}
      href={`/w/${w.id}/f`}
      role="menuitem"
      onClick={() => setOpen(false)}
      className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-item-hover"
    >
      {w.kind === "COMPANY" ? <Building2 className="size-4 shrink-0 text-muted" aria-hidden /> : <UsersRound className="size-4 shrink-0 text-muted" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{w.name}</span>
      <span className="shrink-0 text-xs text-muted">{WS_ROLE_LABEL[w.role]}</span>
      {w.id === ws?.id ? <Check className="size-4 shrink-0" aria-hidden /> : <span className="size-4 shrink-0" />}
    </Link>
  );
  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
        className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl px-2 text-left outline-hidden hover:bg-item-hover aria-expanded:bg-item-hover"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs text-muted">{ws ? (ws.kind === "COMPANY" ? `Công ty · ${WS_ROLE_LABEL[ws.role]}` : `Workspace · ${WS_ROLE_LABEL[ws.role]}`) : "Luna Knowledge"}</span>
          <span className="truncate text-sm font-semibold">{ws?.name ?? "Chưa thuộc workspace nào"}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
      <PopoverPanel open={open} className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="max-h-96 overflow-y-auto px-1" role="menu">
          {company.length ? (
            <>
              <p className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase">Công ty</p>
              {company.map(item)}
            </>
          ) : null}
          <p className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-muted uppercase">Workspace của tôi</p>
          {teams.length ? teams.map(item) : <p className="px-3 py-2 text-sm text-muted">Chưa có workspace nhóm nào.</p>}
        </div>
        <MenuSeparator />
        <div className="px-1">
          <MenuItem
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <Plus className="size-4 shrink-0 text-muted" aria-hidden />
            Tạo workspace
          </MenuItem>
          {canManage ? (
            <MenuItem
              onClick={() => {
                setOpen(false);
                setSettings(true);
              }}
            >
              <Settings className="size-4 shrink-0 text-muted" aria-hidden />
              Cài đặt «{ws!.name}»
            </MenuItem>
          ) : null}
        </div>
      </PopoverPanel>
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
      <WorkspaceSettingsDialog ws={ws ? { id: ws.id, name: ws.name, kind: ws.kind } : null} open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

export function UserSidebar() {
  const pathname = usePathname();
  const { wsId, ws } = useCurrentWorkspace();
  const base = wsId && ws ? `/w/${wsId}` : null;
  const section = useActiveSection();
  const inWs = !!base && pathname.startsWith(`${base}/`);
  return (
    <>
      <Logo>
        <WorkspaceSwitcher />
      </Logo>
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3" aria-label="Điều hướng">
        {base ? (
          <NavGroup>
            <NavLink href={`${base}/f`} icon={FileText} label="Tài liệu" active={inWs && section === "DOCS"} />
            <NavLink href={`${base}/v`} icon={Clapperboard} label="Video" active={inWs && section === "VIDEOS"} />
          </NavGroup>
        ) : null}
        <NavGroup>
          <NavLink href="/shared" icon={Users} label="Được chia sẻ" active={pathname === "/shared"} />
          <NavLink href="/favorites" icon={Star} label="Yêu thích" active={pathname === "/favorites"} />
          <NavLink href="/recent" icon={Clock} label="Gần đây" active={pathname === "/recent"} />
          {base && ws?.role !== "VIEWER" ? <NavLink href={`${base}/trash`} icon={Trash2} label="Thùng rác" active={pathname === `${base}/trash`} /> : null}
        </NavGroup>
      </nav>
    </>
  );
}
