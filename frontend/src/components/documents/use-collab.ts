"use client";

import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { ApiError, api } from "@/lib/api";
import { type CollabToken, userColor } from "@/lib/documents";

export type CollabStatus = "connecting" | "online" | "offline" | "denied";

const LOST_ACCESS = new Set(["Forbidden", "Session ended"]);
const FINAL = new Set([401, 403, 404]);
const BACKOFF = [1000, 2000, 5000, 10000];

export interface Peer {
  clientId: number;
  id: string;
  name: string;
  color: string;
}

export interface CollabSession {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  user: { id: string; name: string; color: string };
  readOnly: boolean;
}

export function useCollab(nodeId: string) {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [unsynced, setUnsynced] = useState(0);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    let provider: HocuspocusProvider | null = null;
    const ydoc = new Y.Doc();

    const fetchToken = async () => {
      try {
        return await api<CollabToken>(`/documents/${nodeId}/collab-token`);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          setStatus("denied");
          provider?.disconnect();
        }
        throw err;
      }
    };

    let retry: ReturnType<typeof setTimeout> | undefined;
    const recheck = (attempt = 0) => {
      clearTimeout(retry);
      provider?.disconnect();
      fetchToken()
        .then(() => {
          if (!cancelled) void provider?.connect();
        })
        .catch((err) => {
          if (cancelled || (err instanceof ApiError && FINAL.has(err.status))) return;
          const delay = (BACKOFF[attempt] ?? BACKOFF[BACKOFF.length - 1]!) * (0.75 + Math.random() * 0.5);
          retry = setTimeout(() => recheck(attempt + 1), delay);
        });
    };

    void (async () => {
      let first: CollabToken | null;
      try {
        first = await fetchToken();
      } catch (err) {
        if (!cancelled) setError(err);
        return;
      }
      if (cancelled) return;
      let initial: CollabToken | null = first;
      const user = { id: first.user.id, name: first.user.name, color: userColor(first.user.id) };
      provider = new HocuspocusProvider({
        url: first.url,
        name: first.documentName,
        document: ydoc,
        token: async () => {
          const t = initial ?? (await fetchToken());
          initial = null;
          return t.token;
        },
        onStatus: ({ status: s }) => {
          if (s === WebSocketStatus.Connected) setStatus("online");
          else setStatus((prev) => (prev === "denied" ? prev : s === WebSocketStatus.Connecting ? "connecting" : "offline"));
        },
        onSynced: ({ state }) => setSynced(state),
        onUnsyncedChanges: ({ number }) => setUnsynced(number),
        onAuthenticationFailed: () => void fetchToken().catch(() => undefined),
        onClose: ({ event }) => {
          if (event.code === 4403 || event.code === 4401 || LOST_ACCESS.has(event.reason)) recheck();
        },
        onAwarenessUpdate: ({ states }) => {
          const seen = new Set<string>();
          const list: Peer[] = [];
          for (const s of states as Array<{ clientId: number; user?: { id?: string; name?: string; color?: string } }>) {
            const u = s.user;
            if (!u?.id || u.id === user.id || seen.has(u.id)) continue;
            seen.add(u.id);
            list.push({ clientId: s.clientId, id: u.id, name: u.name ?? "Ẩn danh", color: u.color ?? userColor(u.id) });
          }
          setPeers(list);
        },
      });
      setSession({ ydoc, provider, user, readOnly: first.readOnly });
    })();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      provider?.destroy();
      ydoc.destroy();
    };
  }, [nodeId]);

  return { session, status, synced, unsynced, peers, error };
}
