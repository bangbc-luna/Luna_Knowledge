"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, onSessionExpired, refreshSession, setSession, type TokenResponse } from "./api";
import type { Me } from "./types";

type Status = "loading" | "anon" | "authed";

interface AuthValue {
  status: Status;
  me: Me | null;
  lostReason: string | null;
  reloadMe: () => Promise<void>;
  loginDev: (email: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [lostReason, setLostReason] = useState<string | null>(null);

  const reloadMe = useCallback(async () => {
    setMe(await api<Me>("/me"));
  }, []);

  const startSession = useCallback(
    async (token: TokenResponse) => {
      setSession(token);
      await reloadMe();
      setLostReason(null);
      setStatus("authed");
    },
    [reloadMe],
  );

  useEffect(() => {
    onSessionExpired((code) => {
      setSession(null);
      setMe(null);
      setLostReason(code);
      setStatus("anon");
    });
    refreshSession()
      .then((token) => (token ? startSession(token) : setStatus("anon")))
      .catch(() => setStatus("anon"));
  }, [startSession]);

  const loginDev = useCallback(
    async (email: string, name?: string) => {
      const token = await api<TokenResponse>("/dev/token", { method: "POST", body: { email, name } });
      await startSession(token);
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setSession(null);
    setMe(null);
    setStatus("anon");
  }, []);

  const refreshToken = useCallback(async () => {
    const token = await refreshSession();
    if (!token) {
      setStatus("anon");
      return false;
    }
    return true;
  }, []);

  const value = useMemo(
    () => ({ status, me, lostReason, reloadMe, loginDev, logout, refreshToken }),
    [status, me, lostReason, reloadMe, loginDev, logout, refreshToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (!code || err.code === code);
}
