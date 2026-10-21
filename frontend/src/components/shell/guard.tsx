"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "../ui/button";

export function Guard({ admin = false, children }: { admin?: boolean; children: React.ReactNode }) {
  const { status, me, lostReason, loginDev } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status !== "anon") return;
    const devAs = process.env.NODE_ENV === "development" ? new URLSearchParams(window.location.search).get("as") : null;
    if (devAs) {
      void loginDev(devAs).catch(() => router.replace("/login"));
      return;
    }
    router.replace(lostReason ? `/login?error=${lostReason}` : "/login");
  }, [status, lostReason, router, loginDev]);

  if (status !== "authed" || !me) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <LoaderCircle className="size-5 animate-spin text-muted motion-reduce:animate-none" aria-label="Đang tải" />
      </div>
    );
  }
  if (admin && !me.isSystemAdmin) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm font-medium text-foreground">Bạn không có quyền vào trang quản trị</p>
        <p className="max-w-[55ch] text-sm text-muted text-pretty">Trang này chỉ dành cho System Admin. Nhờ quản trị viên cấp quyền nếu bạn cần.</p>
        <Button onClick={() => router.replace("/")}>Về trang tài liệu</Button>
      </div>
    );
  }
  return <>{children}</>;
}
