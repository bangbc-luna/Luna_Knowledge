"use client";

import { ChevronRight, LogIn } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { IS_DEV, PERSONAS } from "@/components/shell/personas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, Card } from "@/components/ui/misc";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const LOGIN_ERRORS: Record<string, string> = {
  DOMAIN_NOT_ALLOWED: "Chỉ tài khoản @lunatech.vn mới đăng nhập được.",
  EMAIL_NOT_VERIFIED: "Email Google chưa được xác minh.",
  ACCOUNT_DISABLED: "Tài khoản đã bị khoá. Liên hệ quản trị viên.",
  ACCESS_DENIED: "Bạn đã huỷ đăng nhập ở Google.",
  INVALID_STATE: "Phiên đăng nhập đã hết hạn, hãy thử lại.",
  LOGIN_FAILED: "Đăng nhập Google không thành công, hãy thử lại.",
  SESSION_EXPIRED: "Phiên làm việc đã hết hạn, hãy đăng nhập lại.",
};

function LoginInner() {
  const { status, me, loginDev } = useAuth();
  const router = useRouter();
  const error = useSearchParams().get("error");
  const [busy, setBusy] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (status === "authed" && me) router.replace(me.isSystemAdmin && !me.workspaces.length ? "/admin" : "/");
  }, [status, me, router]);

  const quick = async (mail: string, name?: string) => {
    setBusy(mail);
    setDevError(null);
    try {
      await loginDev(mail, name);
    } catch (err) {
      setDevError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground">L</span>
          <div>
            <h1 className="text-xl font-semibold">Luna Knowledge</h1>
            <p className="text-sm text-muted">Kho tài liệu và video nội bộ</p>
          </div>
        </div>
        <Card>
          <div className="flex flex-col gap-4 p-6">
            {error ? (
              <p role="alert" className="rounded-xl border border-err-border bg-err-bg px-4 py-3 text-sm text-err">
                {LOGIN_ERRORS[error] ?? `Không đăng nhập được (${error}).`}
              </p>
            ) : null}
            <a
              href="/api/v1/auth/google"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-button-hover md:min-h-10"
            >
              <LogIn className="size-4" aria-hidden />
              Đăng nhập bằng Google
            </a>
            <p className="text-center text-xs text-muted">Chỉ tài khoản @lunatech.vn</p>
          </div>
          {IS_DEV ? (
            <>
              <div className="border-t border-border px-6 pt-5 pb-2">
                <h2 className="text-sm font-semibold">Đăng nhập nhanh</h2>
                <p className="mt-0.5 text-xs text-muted">Không qua Google, chỉ có khi backend chạy NODE_ENV=development.</p>
              </div>
              {devError ? <p className="mx-6 mb-2 text-sm text-err-text">{devError}</p> : null}
              <ul className="px-3 pb-3">
                {PERSONAS.map((p) => (
                  <li key={p.email}>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => quick(p.email, p.name)}
                      className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-item-hover disabled:cursor-progress"
                    >
                      <Avatar name={p.name} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        <span className="truncate text-xs text-muted">{p.email}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{busy === p.email ? "Đang vào…" : p.note}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="flex flex-col gap-2 border-t border-border p-6 pt-4 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (email.trim()) void quick(email.trim());
                }}
              >
                <Input type="email" placeholder="email khác @lunatech.vn" aria-label="Email khác" value={email} onChange={(e) => setEmail(e.target.value)} className="sm:flex-1" />
                <Button type="submit" variant="secondary" loading={!!busy && busy === email.trim()} className="min-h-11 shrink-0 md:min-h-10">
                  Vào
                </Button>
              </form>
            </>
          ) : null}
        </Card>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
