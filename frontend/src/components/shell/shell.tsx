"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AccountMenu } from "./account-menu";

const ShellContext = createContext<{ openMenu: () => void } | null>(null);

export function AppFrame({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <ShellContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-surface lg:flex">{sidebar}</aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      {menuOpen
        ? createPortal(
            <div className="fixed inset-0 z-50 lg:hidden">
              <div className="animate-fade absolute inset-0 bg-black/15" onClick={() => setMenuOpen(false)} aria-hidden />
              <aside aria-label="Menu" className="animate-sheet-left absolute inset-y-0 left-0 flex w-72 max-w-[calc(100vw-56px)] flex-col bg-surface shadow-modal">
                <button type="button" className="sr-only" onClick={() => setMenuOpen(false)}>
                  Đóng menu
                </button>
                {sidebar}
              </aside>
            </div>,
            document.body,
          )
        : null}
    </ShellContext.Provider>
  );
}

export function TopBar({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  const shell = useContext(ShellContext);
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <button
        type="button"
        aria-label="Mở menu"
        onClick={shell?.openMenu}
        className="-ml-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground lg:hidden"
      >
        <Menu className="size-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      {actions}
      <AccountMenu />
    </header>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">{children}</div>;
}
