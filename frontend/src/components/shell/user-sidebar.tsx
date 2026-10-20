"use client";

import { Check, ChevronsUpDown, Clock, Folder, Star, Tag, Trash2, UserRoundCog, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL, roleAtLeast } from "@/lib/format";
import { useCurrentWorkspace } from "@/lib/workspace";
import { PopoverPanel, usePopover } from "../ui/popover";
import { Logo, NavGroup, NavLink } from "./nav";

function WorkspaceSwitcher() {
  const { me } = useAuth();
  const { ws } = useCurrentWorkspace();
  const { open, setOpen, toggle, rootRef } = usePopover();
  const list = me?.workspaces ?? [];
  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
        disabled={!list.length}
        className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl px-2 text-left outline-hidden hover:bg-item-hover disabled:cursor-default disabled:hover:bg-transparent aria-expanded:bg-item-hover"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{ws?.name ?? "Luna Knowledge"}</span>
          <span className="truncate text-xs text-muted">{ws ? `Workspace · ${ROLE_LABEL[ws.role]}` : "Chưa thuộc workspace nào"}</span>
        </span>
        {list.length ? <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden /> : null}
      </button>
      <PopoverPanel open={open} className="w-full min-w-56">
        <div className="max-h-80 overflow-y-auto px-1" role="menu">
          {list.map((w) => (
            <Link
              key={w.id}
              href={`/w/${w.id}/f`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-item-hover"
            >
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="shrink-0 text-xs text-muted">{ROLE_LABEL[w.role]}</span>
              {w.id === ws?.id ? <Check className="size-4 shrink-0" aria-hidden /> : <span className="size-4 shrink-0" />}
            </Link>
          ))}
        </div>
      </PopoverPanel>
    </div>
  );
}

export function UserSidebar() {
  const pathname = usePathname();
  const { wsId, role } = useCurrentWorkspace();
  const base = wsId ? `/w/${wsId}` : null;
  return (
    <>
      <Logo>
        <WorkspaceSwitcher />
      </Logo>
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3" aria-label="Điều hướng">
        <NavGroup>
          {base ? <NavLink href={`${base}/f`} icon={Folder} label="Thư mục" active={pathname.startsWith(`${base}/f`)} /> : null}
          <NavLink href="/shared" icon={Users} label="Được chia sẻ" active={pathname === "/shared"} />
          <NavLink href="/favorites" icon={Star} label="Yêu thích" active={pathname === "/favorites"} />
          <NavLink href="/recent" icon={Clock} label="Gần đây" active={pathname === "/recent"} />
        </NavGroup>
        {base && role ? (
          <NavGroup label="Workspace">
            <NavLink href={`${base}/members`} icon={UserRoundCog} label="Thành viên" active={pathname === `${base}/members`} />
            <NavLink href={`${base}/tags`} icon={Tag} label="Tag" active={pathname === `${base}/tags`} />
            {roleAtLeast(role, "EDITOR") ? <NavLink href={`${base}/trash`} icon={Trash2} label="Thùng rác" active={pathname === `${base}/trash`} /> : null}
          </NavGroup>
        ) : null}
      </nav>
    </>
  );
}
