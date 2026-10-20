"use client";

import { ArrowLeft, Boxes, LayoutDashboard, ScrollText, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, NavGroup, NavLink } from "./nav";

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <>
      <Logo subtitle="Quản trị hệ thống" />
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3" aria-label="Quản trị">
        <NavGroup>
          <NavLink href="/admin" icon={LayoutDashboard} label="Tổng quan" active={pathname === "/admin"} />
          <NavLink href="/admin/users" icon={Users} label="Người dùng" active={pathname.startsWith("/admin/users")} />
          <NavLink href="/admin/logs" icon={ScrollText} label="Nhật ký" active={pathname.startsWith("/admin/logs")} />
          <NavLink href="/admin/workspaces" icon={Boxes} label="Workspace" active={pathname.startsWith("/admin/workspaces")} />
        </NavGroup>
      </nav>
      <div className="border-t border-border px-3 py-3">
        <Link href="/" className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm text-foreground/70 hover:bg-item-hover hover:text-foreground">
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          Về trang tài liệu
        </Link>
      </div>
    </>
  );
}
