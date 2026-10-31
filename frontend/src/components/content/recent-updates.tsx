"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError, describeError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatWhen } from "@/lib/format";
import { useBranchTick } from "@/lib/tree-sync";
import type { NodeItem, NodeSection, Page } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button } from "../ui/button";
import { ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";
import { NodeName } from "./node-name";
import { VideoGrid } from "./video-grid";

const wideScreen = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;

export function RecentUpdates({ wsId, section, className }: { wsId: string; section: NodeSection; className?: string }) {
  const toast = useToast();
  const [pageSize] = useState(() => (wideScreen() ? 10 : 5));
  const tick = useBranchTick(wsId, null);
  const first = useApi(
    () => api<Page<NodeItem>>(`/workspaces/${wsId}/recently-updated`, { query: { section, limit: pageSize } }),
    [wsId, section, tick, pageSize],
  );
  const resetKey = `${wsId}:${section}:${tick}`;
  const [extra, setExtra] = useState<{ key: string; items: NodeItem[]; cursor: string | null }>({ key: "", items: [], cursor: null });
  const [moreLoading, setMoreLoading] = useState(false);
  const [favState, setFavState] = useState<{ key: string; map: Record<string, boolean> }>({ key: "", map: {} });

  const fresh = extra.key === resetKey;
  const cursor = fresh ? extra.cursor : (first.data?.nextCursor ?? null);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...(first.data?.items ?? []), ...(fresh ? extra.items : [])].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
    const favorites = favState.key === resetKey ? favState.map : {};
    return merged.map((n) => (n.id in favorites ? { ...n, isFavorite: favorites[n.id]! } : n));
  }, [first.data, extra, fresh, favState, resetKey]);

  const pending = items.some((n) => n.status === "PROCESSING" || n.status === "UPLOADING");
  const reloadFirst = first.reload;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void reloadFirst(), 4000);
    return () => clearInterval(timer);
  }, [pending, reloadFirst]);

  const loadMore = async () => {
    if (!cursor || !first.data) return;
    setMoreLoading(true);
    try {
      const page = await api<Page<NodeItem>>(`/workspaces/${wsId}/recently-updated`, { query: { section, limit: pageSize, cursor } });
      setExtra((e) => ({ key: resetKey, items: [...(e.key === resetKey ? e.items : []), ...page.items], cursor: page.nextCursor }));
    } catch (err) {
      toast("error", describeError(err));
    } finally {
      setMoreLoading(false);
    }
  };

  if (first.error instanceof ApiError && first.error.status === 404) return null;
  if (!first.error && !first.loading && !items.length) return null;

  const title = section === "VIDEOS" ? "Video mới cập nhật" : "Mới cập nhật";
  const onFavorite = (id: string, fav: boolean) => setFavState((f) => ({ key: resetKey, map: { ...(f.key === resetKey ? f.map : {}), [id]: fav } }));

  return (
    <section aria-labelledby={`recent-${section}`} className={cn("min-w-0", className)}>
      <h2 id={`recent-${section}`} className="mb-2 px-1 text-sm font-semibold sm:px-3">
        {title}
      </h2>
      {first.error && !first.data ? (
        <ErrorBanner error={first.error} what={title.toLocaleLowerCase("vi")} onRetry={() => void first.reload()} />
      ) : first.loading && !first.data ? (
        <SkeletonRows rows={4} />
      ) : section === "VIDEOS" ? (
        <VideoGrid items={items} onFavorite={onFavorite} />
      ) : (
        <ul className="border-y border-border">
          {items.map((n) => (
            <li key={n.id} className="relative border-t border-border px-1 py-2 first:border-t-0 hover:bg-surface-hover sm:px-3">
              <NodeName node={n} stretched sub={`Sửa ${formatWhen(n.updatedAt)}`} />
            </li>
          ))}
        </ul>
      )}
      {first.error && first.data ? (
        <p role="status" className="mt-2 px-1 text-sm text-muted sm:px-3">
          Chưa làm mới được danh sách.{" "}
          <button type="button" onClick={() => void first.reload()} className="cursor-pointer rounded font-medium text-foreground underline-offset-2 outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-primary">
            Thử lại
          </button>
        </p>
      ) : null}
      {cursor && first.data ? (
        <div className="mt-2 flex justify-center">
          <Button loading={moreLoading} onClick={() => void loadMore()} className="w-full sm:w-auto">
            Xem thêm
          </Button>
        </div>
      ) : null}
    </section>
  );
}
