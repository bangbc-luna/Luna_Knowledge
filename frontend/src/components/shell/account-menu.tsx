"use client";

import { ChevronsUpDown, LogIn, LogOut, RefreshCw, Shield, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { describeError, tokenSecondsLeft } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Avatar } from "../ui/misc";
import { MenuItem, MenuSeparator, PopoverPanel, usePopover } from "../ui/popover";
import { useToast } from "../ui/toast";
import { IS_DEV, PERSONAS } from "./personas";

export function AccountMenu() {
  const { me, loginDev, logout, refreshToken } = useAuth();
  const { open, setOpen, toggle, rootRef } = usePopover();
  const [switching, setSwitching] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const inAdmin = usePathname().startsWith("/admin");
  if (!me) return null;
  const minutes = Math.ceil(tokenSecondsLeft() / 60);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={me.name}
        onClick={toggle}
        className="flex h-10 max-w-72 cursor-pointer items-center gap-2.5 rounded-xl py-1 pr-2 pl-1 outline-hidden transition-colors hover:bg-foreground/5 aria-expanded:bg-foreground/5"
      >
        <Avatar name={me.name} src={me.avatarUrl} />
        <span className="hidden min-w-0 flex-col text-left xl:flex">
          <span className="truncate text-sm font-medium text-foreground">{me.name}</span>
          <span className="truncate text-xs text-muted">{me.isSystemAdmin ? "System Admin" : me.email}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
      <PopoverPanel open={open} align="right" className="w-80 max-w-[calc(100vw-2rem)]">
        <p className="truncate px-4 pt-2 pb-1 text-xs text-muted">{me.email}</p>
        {me.isSystemAdmin ? (
          <div className="px-1">
            <Link href={inAdmin ? "/" : "/admin"} onClick={() => setOpen(false)} className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-item-hover">
              {inAdmin ? <ArrowLeft className="size-4 text-muted" aria-hidden /> : <Shield className="size-4 text-muted" aria-hidden />}
              {inAdmin ? "Về trang tài liệu" : "Trang quản trị"}
            </Link>
          </div>
        ) : null}
        {IS_DEV ? (
          <>
            <MenuSeparator />
            <p className="px-4 pt-1 pb-1 text-xs font-medium text-muted">Đổi vai nhanh (dev)</p>
            <div className="px-1">
              {PERSONAS.map((p) => (
                <MenuItem
                  key={p.email}
                  disabled={!!switching}
                  className={p.email === me.email ? "bg-item-hover" : undefined}
                  onClick={async () => {
                    setSwitching(p.email);
                    try {
                      await loginDev(p.email, p.name);
                      setOpen(false);
                      router.push(p.email === "admin@lunatech.vn" ? "/admin" : "/");
                      toast("success", `Đã chuyển sang ${p.name}`);
                    } catch (err) {
                      toast("error", describeError(err));
                    } finally {
                      setSwitching(null);
                    }
                  }}
                >
                  <Avatar name={p.name} size="size-7" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="truncate text-xs text-muted">{p.email}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{switching === p.email ? "Đang vào…" : p.note}</span>
                </MenuItem>
              ))}
            </div>
            <div className="px-1">
              <a href="/api/v1/auth/google" className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-item-hover">
                <LogIn className="size-4 text-muted" aria-hidden />
                Đăng nhập Google thật
              </a>
            </div>
          </>
        ) : null}
        <MenuSeparator />
        <div className="px-1">
          <MenuItem
            onClick={async () => {
              if (await refreshToken()) toast("success", "Đã làm mới token");
            }}
          >
            <RefreshCw className="size-4 text-muted" aria-hidden />
            <span className="flex-1">Làm mới token</span>
            <span className="text-xs tabular-nums text-muted">còn {minutes} phút</span>
          </MenuItem>
        </div>
        <MenuSeparator />
        <div className="px-1">
          <MenuItem
            danger
            onClick={async () => {
              setOpen(false);
              await logout();
              router.replace("/login");
            }}
          >
            <LogOut className="size-4" aria-hidden />
            Đăng xuất
          </MenuItem>
        </div>
      </PopoverPanel>
    </div>
  );
}
