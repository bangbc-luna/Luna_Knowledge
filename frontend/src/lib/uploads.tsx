"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import { ALLOWED_EXTENSIONS, MAX_FILE_MB, MAX_VIDEO_MB, VIDEO_EXTENSIONS, extensionOf, formatBytes } from "./files";

export type UploadStatus = "draft" | "queued" | "uploading" | "done" | "error";

export interface UploadTarget {
  wsId: string;
  parentId: string | null;
  replaceNodeId?: string;
}

export interface UploadItem extends UploadTarget {
  id: string;
  file: File;
  name: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  suggestion?: string;
  retryable?: boolean;
  uploadId?: string;
  nodeId?: string;
  title?: string;
  description?: string;
}

export interface VideoInfo {
  title: string;
  description: string;
}

interface Ctx {
  items: UploadItem[];
  add: (files: FileList | File[], target: UploadTarget) => void;
  confirmDraft: (id: string, info: VideoInfo) => void;
  retry: (id: string, rename?: string) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
  doneTick: (wsId: string, parentId: string | null) => number;
}

const UploadContext = createContext<Ctx | null>(null);

const MAX_PARALLEL_FILES = 2;
const MAX_PARALLEL_PARTS = 3;
const PART_RETRIES = 3;

class NetworkError extends Error {}
class Cancelled extends Error {}

interface Session {
  uploadId: string;
  nodeId: string;
  partSize: number;
  partCount: number;
  parts?: Array<{ partNumber: number; url: string }>;
}

function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void, track: Set<XMLHttpRequest>) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    track.add(xhr);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      track.delete(xhr);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new NetworkError(`PUT ${xhr.status}`));
    };
    xhr.onerror = () => {
      track.delete(xhr);
      reject(new NetworkError("network"));
    };
    xhr.onabort = () => {
      track.delete(xhr);
      reject(new Cancelled());
    };
    xhr.send(blob);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function precheck(file: File): string | null {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) return ext ? `Không nhận tệp .${ext}` : "Không nhận tệp không có đuôi";
  if (file.size === 0) return "Tệp rỗng";
  const maxMb = VIDEO_EXTENSIONS.includes(ext) ? MAX_VIDEO_MB : MAX_FILE_MB;
  if (file.size > maxMb * 1024 * 1024) return `Quá ${formatBytes(maxMb * 1024 * 1024)} (tệp nặng ${formatBytes(file.size)})`;
  return null;
}

function describeUploadError(err: unknown, item: UploadItem): Partial<UploadItem> {
  if (err instanceof ApiError) {
    const details = err.details as { suggestion?: string } | undefined;
    if (err.status === 409 && details?.suggestion) {
      return { error: item.title ? "Thư mục đã có mục trùng tiêu đề" : "Thư mục đã có mục cùng tên", suggestion: details.suggestion, retryable: false };
    }
    if (err.status === 409 && item.replaceNodeId) return { error: "Tệp này đang được tải lên hoặc xử lý", retryable: true };
    if (err.status === 415) return { error: `Không nhận tệp .${extensionOf(item.name)}`, retryable: false };
    if (err.status === 413) return { error: `Quá giới hạn (tệp nặng ${formatBytes(item.file.size)})`, retryable: false };
    if (err.status === 403) return { error: "Bạn không có quyền tải lên ở đây", retryable: false };
    if (err.status === 404) return { error: "Thư mục không còn tồn tại", retryable: false };
    if (err.status >= 500) return { error: "Máy chủ đang lỗi", retryable: true };
    return { error: err.message, retryable: true };
  }
  return { error: "Mất kết nối mạng", retryable: true };
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [ticks, setTicks] = useState<Record<string, number>>({});
  const itemsRef = useRef(items);
  const started = useRef(new Set<string>());
  const xhrs = useRef(new Map<string, Set<XMLHttpRequest>>());
  const cancelled = useRef(new Set<string>());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const run = useCallback(
    async (item: UploadItem) => {
      const track = new Set<XMLHttpRequest>();
      xhrs.current.set(item.id, track);
      const check = () => {
        if (cancelled.current.has(item.id)) throw new Cancelled();
      };
      try {
        const kind = VIDEO_EXTENSIONS.includes(extensionOf(item.name)) ? "VIDEO" : "FILE";
        let session: Session | null = null;
        let uploaded = new Map<number, number>();

        if (item.uploadId) {
          try {
            const st = await api<Session & { status: string; uploadedParts: Array<{ partNumber: number; size: number }> }>(`/uploads/${item.uploadId}`);
            if (st.status === "COMPLETED") {
              patch(item.id, { status: "done", progress: 1 });
              return;
            }
            if (st.status === "PENDING" && new Date((st as unknown as { expiresAt: string }).expiresAt) > new Date()) {
              session = st;
              uploaded = new Map(st.uploadedParts.map((p) => [p.partNumber, p.size]));
            }
          } catch (err) {
            if (!(err instanceof ApiError)) throw err;
          }
        }
        check();
        if (!session) {
          session = await api<Session>(`/workspaces/${item.wsId}/uploads`, {
            method: "POST",
            body: {
              fileName: item.name,
              size: item.file.size,
              mime: item.file.type || undefined,
              kind,
              parentId: item.replaceNodeId ? undefined : item.parentId,
              replaceNodeId: item.replaceNodeId,
              title: item.title,
              description: item.description,
            },
          });
          patch(item.id, { uploadId: session.uploadId, nodeId: session.nodeId });
        }
        const s = session;
        const urls = new Map((s.parts ?? []).map((p) => [p.partNumber, p.url]));
        const inflight = new Map<number, number>();
        const done = () => [...uploaded.values()].reduce((a, b) => a + b, 0);
        const report = () => {
          const loaded = done() + [...inflight.values()].reduce((a, b) => a + b, 0);
          patch(item.id, { progress: Math.min(0.99, loaded / item.file.size) });
        };
        report();

        const todo: number[] = [];
        for (let n = 1; n <= s.partCount; n++) if (!uploaded.has(n)) todo.push(n);

        const urlFor = async (n: number) => {
          if (!urls.has(n)) {
            const more = await api<{ parts: Array<{ partNumber: number; url: string }> }>(`/uploads/${s.uploadId}/parts`, { query: { from: n } });
            for (const p of more.parts) urls.set(p.partNumber, p.url);
          }
          return urls.get(n)!;
        };

        const worker = async () => {
          for (;;) {
            const n = todo.shift();
            if (n === undefined) return;
            const start = (n - 1) * s.partSize;
            const blob = item.file.slice(start, Math.min(start + s.partSize, item.file.size));
            for (let attempt = 0; ; attempt++) {
              check();
              try {
                await putPart(await urlFor(n), blob, (loaded) => {
                  inflight.set(n, loaded);
                  report();
                }, track);
                inflight.delete(n);
                uploaded.set(n, blob.size);
                report();
                break;
              } catch (err) {
                inflight.delete(n);
                if (err instanceof Cancelled || attempt >= PART_RETRIES - 1) throw err;
                urls.delete(n);
                await sleep(1000 * 2 ** attempt);
              }
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_PARTS, todo.length) }, worker));
        check();
        await api(`/uploads/${s.uploadId}/complete`, { method: "POST", body: {} });
        patch(item.id, { status: "done", progress: 1, error: undefined });
        const key = `${item.wsId}:${item.parentId ?? ""}`;
        setTicks((t) => ({ ...t, [key]: (t[key] ?? 0) + 1 }));
      } catch (err) {
        if (err instanceof Cancelled) return;
        patch(item.id, { status: "error", ...describeUploadError(err, item) });
      } finally {
        xhrs.current.delete(item.id);
        started.current.delete(item.id);
      }
    },
    [patch],
  );

  useEffect(() => {
    const active = items.filter((i) => i.status === "uploading").length;
    const next = items.filter((i) => i.status === "queued" && !started.current.has(i.id)).slice(0, Math.max(0, MAX_PARALLEL_FILES - active));
    for (const it of next) {
      started.current.add(it.id);
      patch(it.id, { status: "uploading", error: undefined, suggestion: undefined });
      void run(it);
    }
  }, [items, patch, run]);

  const busy = items.some((i) => i.status === "uploading" || i.status === "queued" || i.status === "draft");
  useEffect(() => {
    if (!busy) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [busy]);

  const add = useCallback((files: FileList | File[], target: UploadTarget) => {
    const list = Array.from(files).map((file): UploadItem => {
      const rejected = precheck(file);
      const newVideo = !target.replaceNodeId && VIDEO_EXTENSIONS.includes(extensionOf(file.name));
      return {
        ...target,
        id: crypto.randomUUID(),
        file,
        name: file.name.normalize("NFC"),
        status: rejected ? "error" : newVideo ? "draft" : "queued",
        progress: 0,
        error: rejected ?? undefined,
        retryable: false,
      };
    });
    setItems((cur) => [...cur, ...list]);
  }, []);

  const confirmDraft = useCallback((id: string, info: VideoInfo) => {
    setItems((list) => list.map((it) => (it.id === id && it.status === "draft" ? { ...it, ...info, status: "queued" } : it)));
  }, []);

  const retry = useCallback((id: string, rename?: string) => {
    setItems((list) =>
      list.map((it) =>
        it.id === id
          ? {
              ...it,
              status: "queued",
              error: undefined,
              suggestion: undefined,
              ...(rename ? { ...(it.title ? { title: rename } : { name: rename }), uploadId: undefined, nodeId: undefined } : {}),
            }
          : it,
      ),
    );
  }, []);

  const cancel = useCallback((id: string) => {
    const it = itemsRef.current.find((i) => i.id === id);
    cancelled.current.add(id);
    for (const x of xhrs.current.get(id) ?? []) x.abort();
    setItems((list) => list.filter((i) => i.id !== id));
    if (it?.uploadId && it.status !== "done") void api(`/uploads/${it.uploadId}`, { method: "DELETE" }).catch(() => undefined);
  }, []);

  const clearFinished = useCallback(() => {
    setItems((list) => list.filter((i) => i.status === "uploading" || i.status === "queued" || i.status === "draft"));
  }, []);

  const doneTick = useCallback((wsId: string, parentId: string | null) => ticks[`${wsId}:${parentId ?? ""}`] ?? 0, [ticks]);

  const value = useMemo(
    () => ({ items, add, confirmDraft, retry, cancel, clearFinished, doneTick }),
    [items, add, confirmDraft, retry, cancel, clearFinished, doneTick],
  );
  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUploads() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploads must be used inside UploadProvider");
  return ctx;
}
