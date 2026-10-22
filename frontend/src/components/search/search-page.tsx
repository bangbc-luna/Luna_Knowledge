"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatNumber, formatWhen } from "@/lib/format";
import { type SearchHit, searchNodes } from "@/lib/search";
import type { Member, NodeType, Tag } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { NodeIcon, nodeMeta } from "../content/node-name";
import { NoWorkspaceNotice } from "../shell/no-workspace";
import { PageBody, TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { SearchInput } from "../ui/input";
import { Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast";
import { Highlight } from "./highlight";
import { hitHref, hitMeta } from "./search-palette";

const TYPES: Array<{ value: "" | NodeType; label: string }> = [
  { value: "", label: "Tất cả" },
  { value: "DOCUMENT", label: "Tài liệu soạn thảo" },
  { value: "FILE", label: "Tệp" },
  { value: "VIDEO", label: "Video" },
  { value: "FOLDER", label: "Thư mục" },
];

const TIMES = [
  { value: "any", label: "Bất kỳ lúc nào" },
  { value: "7", label: "7 ngày qua" },
  { value: "30", label: "30 ngày qua" },
  { value: "365", label: "12 tháng qua" },
] as const;
type Time = (typeof TIMES)[number]["value"];

const PAGE = 20;

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-hidden transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-foreground/5 text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Row({ hit }: { hit: SearchHit }) {
  const n = hit.node;
  return (
    <li className="relative flex gap-3 px-4 py-3 hover:bg-surface-hover sm:px-5">
      <NodeIcon node={n} />
      <div className="min-w-0 flex-1">
        <Link href={hitHref(hit)} className="block min-w-0 truncate text-sm font-medium text-foreground after:absolute after:inset-0 after:content-[''] hover:underline" title={n.name}>
          <Highlight parts={hit.name} />
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted" title={hitMeta(hit)}>
          {hitMeta(hit)} · {nodeMeta(n)} · Sửa {formatWhen(n.updatedAt).toLowerCase()}
        </p>
        {hit.snippet ? <Highlight parts={hit.snippet} className="mt-1.5 line-clamp-2 block max-w-[75ch] text-sm text-pretty text-foreground/80 [overflow-wrap:anywhere]" /> : null}
        {hit.matchedIn === "tags" && n.tags.length ? (
          <p className="mt-1 text-xs text-muted">
            Khớp tag: <span className="text-foreground/80">{n.tags.map((t) => t.name).join(", ")}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function SearchPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { me } = useAuth();
  const toast = useToast();
  const q = params.get("q")?.trim() ?? "";
  const ws = params.get("ws") ?? "";
  const type = (params.get("type") ?? "") as "" | NodeType;
  const time = (params.get("time") ?? "any") as Time;
  const tag = params.get("tag") ?? "";
  const by = params.get("by") ?? "";
  const [draft, setDraft] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setDraft(q);
  }

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if ("ws" in patch) {
      next.delete("tag");
      next.delete("by");
    }
    router.replace(`${pathname}?${next.toString()}`);
  };

  const workspaces = me?.workspaces ?? [];
  const wsName = workspaces.find((w) => w.id === ws)?.name;
  const tags = useApi(() => api<Tag[]>(`/workspaces/${ws}/tags`), [ws], { enabled: !!ws && !!wsName });
  const members = useApi(() => api<Member[]>(`/workspaces/${ws}/members`), [ws], { enabled: !!ws && !!wsName });

  const filters = () => ({
    q,
    workspaceId: ws || undefined,
    type: type || undefined,
    tagIds: tag ? [tag] : undefined,
    createdBy: by || undefined,
    from: time === "any" ? undefined : new Date(Date.now() - Number(time) * 86_400_000).toISOString(),
    limit: PAGE,
  });
  const first = useApi(() => searchNodes(filters()), [q, ws, type, time, tag, by], { enabled: !!q });
  const [more, setMore] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = JSON.stringify([q, ws, type, time, tag, by]);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setMore([]);
    setCursor(undefined);
  }
  const next = cursor === undefined ? first.data?.nextCursor : cursor;
  const items = [...(first.data?.items ?? []), ...more];
  const filtered = !!(type || time !== "any" || tag || by);

  useEffect(() => {
    document.title = q ? `«${q}» · Tìm kiếm` : "Tìm kiếm";
  }, [q]);

  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const loadMore = async () => {
    if (!next) return;
    const startedFor = key;
    setLoadingMore(true);
    try {
      const page = await searchNodes({ ...filters(), cursor: next });
      if (keyRef.current !== startedFor) return;
      setMore((list) => {
        const seen = new Set([...(first.data?.items ?? []), ...list].map((h) => h.node.id));
        return [...list, ...page.items.filter((h) => !seen.has(h.node.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      if (keyRef.current === startedFor) toast("error", describeError(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Tìm kiếm</h1>
      </TopBar>
      <PageBody>
        <NoWorkspaceNotice />
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: draft.trim() });
          }}
          className="flex gap-2"
        >
          <SearchInput label="Từ khoá" placeholder="Tìm tài liệu, tệp, video… (gõ không dấu cũng được)" value={draft} onChange={(e) => setDraft(e.target.value)} className="flex-1 sm:max-w-xl" autoFocus={!q} />
          <Button type="submit" variant="primary" className="shrink-0">
            Tìm
          </Button>
        </form>

        <div className="flex flex-col gap-3">
          <div className="scrollbar-clean -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Loại">
            {TYPES.map((t) => (
              <Chip key={t.value || "all"} active={type === t.value} onClick={() => set({ type: t.value })}>
                {t.label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {wsName ? (
              <span className="inline-flex h-10 items-center gap-1 self-start rounded-full bg-primary-light pr-1 pl-3.5 text-sm font-medium text-primary">
                Chỉ trong «{wsName}»
                <button type="button" aria-label="Tìm trong mọi workspace" onClick={() => set({ ws: "" })} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-primary/10">
                  <X className="size-4" aria-hidden />
                </button>
              </span>
            ) : workspaces.length > 1 ? (
              <Select prefix="Workspace:" value="" ariaLabel="Workspace" options={[{ value: "", label: "Tất cả" }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} onChange={(v) => set({ ws: v })} className="sm:w-fit" />
            ) : null}
            <Select prefix="Thời gian:" value={time} ariaLabel="Thời gian sửa" options={[...TIMES]} onChange={(v) => set({ time: v === "any" ? "" : v })} className="sm:w-fit" />
            {wsName && tags.data?.length ? (
              <Select prefix="Tag:" value={tag} ariaLabel="Tag" options={[{ value: "", label: "Bất kỳ" }, ...tags.data.map((t) => ({ value: t.id, label: t.name }))]} onChange={(v) => set({ tag: v })} className="sm:w-fit" />
            ) : null}
            {wsName && members.data?.length ? (
              <Select prefix="Người tạo:" value={by} ariaLabel="Người tạo" options={[{ value: "", label: "Bất kỳ ai" }, ...members.data.map((m) => ({ value: m.user.id, label: m.user.name }))]} onChange={(v) => set({ by: v })} className="sm:w-fit" />
            ) : null}
            {filtered ? (
              <Button variant="ghost" className="self-start" onClick={() => set({ type: "", time: "", tag: "", by: "" })}>
                Xoá bộ lọc
              </Button>
            ) : null}
          </div>
        </div>

        <Card>
          {!q ? (
            <EmptyState text="Nhập từ khoá để tìm trong tên, nội dung tài liệu, chữ trong file PDF, Word, Excel và tên tag." />
          ) : first.loading && !first.data ? (
            <SkeletonRows rows={5} />
          ) : first.error ? (
            <ErrorBanner error={first.error} what="kết quả tìm kiếm" onRetry={() => void first.reload()} />
          ) : !items.length ? (
            <EmptyState
              text={filtered || ws ? "Không có kết quả nào khớp với bộ lọc này." : "Không có kết quả nào khớp. Thử từ khoá ngắn hơn hoặc từ khác."}
              action={filtered || ws ? <Button onClick={() => set({ type: "", time: "", tag: "", by: "", ws: "" })}>Xoá bộ lọc, tìm ở mọi nơi</Button> : undefined}
            />
          ) : (
            <>
              <div className="border-b border-border px-4 py-3 sm:px-5">
                <p className="text-sm text-muted tabular-nums">
                  {formatNumber(first.data?.total ?? items.length)} kết quả
                </p>
              </div>
              <ul className="divide-y divide-border">
                {items.map((h) => (
                  <Row key={h.node.id} hit={h} />
                ))}
              </ul>
              {next ? (
                <div className="border-t border-border px-4 py-3 sm:px-5">
                  <Button variant="ghost" loading={loadingMore} onClick={() => void loadMore()}>
                    Xem thêm kết quả
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </PageBody>
    </>
  );
}
