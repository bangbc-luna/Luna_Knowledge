"use client";

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/cn";

interface Toast {
  id: number;
  tone: "success" | "error";
  message: string;
}

const ToastContext = createContext<((tone: Toast["tone"], message: string) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, tone, message }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="animate-pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-border bg-surface-overlay p-4 shadow-popover"
          >
            {t.tone === "error" ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-err-text" aria-hidden />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            )}
            <p className={cn("min-w-0 flex-1 text-sm text-pretty", t.tone === "error" ? "text-err" : "text-foreground")}>{t.message}</p>
            <button
              type="button"
              aria-label="Đóng"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              className="-m-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside ToastProvider");
  return push;
}
