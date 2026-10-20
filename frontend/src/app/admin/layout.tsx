"use client";

import { AdminSidebar } from "@/components/shell/admin-sidebar";
import { Guard } from "@/components/shell/guard";
import { AppFrame } from "@/components/shell/shell";

/** Khu quản trị: chỉ System Admin (Guard admin), sidebar riêng. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Guard admin>
      <AppFrame sidebar={<AdminSidebar />}>{children}</AppFrame>
    </Guard>
  );
}
