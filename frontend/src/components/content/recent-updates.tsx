"use client";

import { useMemo, useState } from "react";
import { api, ApiError, describeError } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { useBranchTick } from "@/lib/tree-sync";
import type { NodeItem, NodeSection, Page } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button } from "../ui/button";
import { ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";
import { NodeName } from "./node-name";
import { VideoGrid } from "./video-grid";

const PAGE_SIZE = 10;

export function RecentUpdates({ wsId, section }: { wsId: string; section: NodeSection }) {
  const toast = useToast();
  const tick = useBranchTick(wsId, null);
  const first = useApi(
    () => api<Page<NodeItem>>(`/workspaces/${wsId}/recently-updated`, { query: { section, limit: PAGE_SIZE } }),
    [wsId, section, tick],
  );
  const [extra, setExtra] = useState<{ base: Page<NodeItem> | null; items: NodeItem[]; cursor: string | null }>({ base: null, items: [], cursor: null });
  const [moreLoading, setMoreLoading] = useState(false);
  const [favState, setFavState] = useState<{ base: Page<NodeItem> | null; map: Record<string, boolean> }>({ base: null, map: {} });

  const fresh = extra.base === first.data;
  const cursor = fresh && extra.items.length ? extra.cursor : (first.data?.nextCursor ?? null);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...(first.data?.items ?? []), ...(fresh ? extra.items : [])].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
    const favorites = favState.base === first.data ? favState.map : {};
    return merged.map((n) => (n.id in favorites ? { ...n, isFavorite: favorites[n.id]! } : n));
  }, [first.data, extra, fresh, favState]);

  const loadMore = async () => {
    if (!cursor || !first.data) return;
    setMoreLoading(true);
    try {
      const page = await api<Page<NodeItem>>(`/workspaces/${wsId}/recently-updated`, { query: { section, limit: PAGE_SIZE, cursor } });
      setExtra((e) => ({ base: first.data, items: [...(e.base === first.data ? e.items : []), ...page.items], cursor: page.nextCursor }));
    } catch (err) {
      toast("error", describeError(err));
    } finally {
      setMoreLoading(false);
    }
  };

  if (first.error instanceof ApiError && first.error.status === 404) return null;
  if (!first.error && !first.loading && !items.length) return null;

  const title = section === "VIDEOS" ? "Video mới cập nhật" : "Mới cập nhật";
  const onFavorite = (id: string, fav: boolean) => setFavState((f) => ({ base: first.data, map: { ...(f.base === first.data ? f.map : {}), [id]: fav } }));

  return (
    <section aria-labelledby={`recent-${section}`} className="min-w-0">
      <h2 id={`recent-${section}`} className="mb-2 px-1 text-sm font-semibold sm:px-3">
        {title}
      </h2>
      {first.error ? (
        <ErrorBanner error={first.error} what={title.toLocaleLowerCase("vi")} onRetry={() => void first.reload()} />
      ) : first.loading && !first.data ? (
        <SkeletonRows rows={4} />
      ) : section === "VIDEOS" ? (
        <VideoGrid items={items} onFavorite={onFavorite} />
      ) : (
        <ul className="border-y border-border">
          {items.map((n) => (
            <li key={n.id} className="relative border-t border-border px-1 py-2 first:border-t-0 hover:bg-surface-hover sm:px-3">
              <NodeName node={n} stretched sub={`Sửa ${formatWhen(n.updatedAt)} · ${n.createdBy.name}`} />
            </li>
          ))}
        </ul>
      )}
      {cursor && !first.error ? (
        <div className="mt-2 flex justify-center">
          <Button loading={moreLoading} onClick={() => void loadMore()} className="w-full sm:w-auto">
            Xem thêm
          </Button>
        </div>
      ) : null}
    </section>
  );
}
