"use client";

import { ArrowRight, LoaderCircle, Search } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { type SearchHit, searchNodes } from "@/lib/search";
import { useAuth } from "@/lib/auth";
import { nodeHref, NodeIcon } from "../content/node-name";
import { Highlight, plain } from "./highlight";

export function hitHref(h: SearchHit) {
  return nodeHref(h.node);
}

export function hitMeta(h: SearchHit) {
  return [h.workspace.name, ...h.path].join(" / ");
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function SearchTrigger() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        if (document.querySelector(".luna-editor:focus-within")) return;
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Tìm kiếm"
        className="hidden h-10 w-64 shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border border-border-strong bg-surface px-3 text-left text-sm text-muted outline-hidden transition-colors hover:border-foreground/20 focus-visible:border-focus lg:flex xl:w-80"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Tìm tài liệu, tệp, video…</span>
        <kbd className="shrink-0 rounded-md border border-border-strong px-1.5 py-0.5 font-sans text-xs text-muted">Ctrl K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Tìm kiếm"
        className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-foreground/70 outline-hidden hover:bg-foreground/5 hover:text-foreground lg:hidden"
      >
        <Search className="size-5" aria-hidden />
      </button>
      {open ? <SearchPalette onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { me } = useAuth();
  const { wsId } = useParams<{ wsId?: string }>();
  const ws = me?.workspaces.find((w) => w.id === wsId) ?? null;
  const [scoped, setScoped] = useState(!!ws);
  const scopeId = scoped && ws ? ws.id : undefined;
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const id = ++seq.current;
    if (!term) return;
    const t = setTimeout(() => {
      setLoading(true);
      searchNodes({ q: term, limit: 8, workspaceId: scopeId })
        .then((r) => {
          if (id !== seq.current) return;
          setHits(r.items);
          setTotal(r.total);
          setFailed(false);
          setActive(0);
        })
        .catch(() => id === seq.current && setFailed(true))
        .finally(() => id === seq.current && setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, scopeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const term = q.trim();
  const shown = term ? (hits ?? []) : [];
  const options = term ? shown.length + 1 : 0;
  const allHref = `/search?q=${encodeURIComponent(term)}${scopeId ? `&ws=${scopeId}` : ""}`;

  const go = (i: number) => {
    const href = i < shown.length ? hitHref(shown[i]!) : allHref;
    onClose();
    router.push(href);
  };

  const move = (d: number) => {
    if (!options) return;
    const next = (active + d + options) % options;
    setActive(next);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="animate-fade absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Tìm kiếm" className="animate-dialog fixed inset-x-4 top-4 mx-auto w-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-surface-overlay shadow-modal sm:top-[15vh]">
        <div className="flex h-14 items-center gap-3 border-b border-border px-5">
          {loading ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted motion-reduce:animate-none" aria-hidden /> : <Search className="size-4 shrink-0 text-muted" aria-hidden />}
          <input
            autoFocus
            role="combobox"
            aria-expanded={options > 0}
            aria-controls="search-palette-list"
            aria-activedescendant={options ? `search-opt-${active}` : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Enter" && options) {
                e.preventDefault();
                go(active);
              }
            }}
            placeholder="Tìm tài liệu, tệp, video… (gõ không dấu cũng được)"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-hidden placeholder:text-muted md:text-sm"
          />
          {ws ? (
            <button
              type="button"
              onClick={() => setScoped((v) => !v)}
              title={scoped ? "Bấm để tìm ở mọi nơi" : `Bấm để chỉ tìm trong ${ws.name}`}
              className={cn(
                "inline-flex h-8 max-w-40 shrink-0 cursor-pointer items-center rounded-full px-3 text-xs font-medium outline-hidden transition-colors",
                scoped ? "bg-primary-light text-primary hover:bg-primary/10" : "bg-foreground/5 text-foreground/70 hover:bg-foreground/10",
              )}
            >
              <span className="truncate">{scoped ? `Trong ${ws.name}` : "Mọi nơi"}</span>
            </button>
          ) : null}
        </div>
        {!term ? (
          <p className="px-5 py-8 text-center text-sm text-pretty text-muted">{scopeId && ws ? `Gõ tên hoặc vài chữ trong nội dung. Đang tìm trong «${ws.name}»; bấm chip bên phải để tìm ở mọi nơi.` : "Gõ tên hoặc vài chữ trong nội dung. Tìm trong mọi workspace bạn thuộc và các mục được chia sẻ cho bạn."}</p>
        ) : failed && !hits ? (
          <p className="py-10 text-center text-sm text-muted">Không tìm được lúc này. Thử lại sau ít phút.</p>
        ) : hits === null ? (
          <div aria-busy="true" aria-label="Đang tìm" className="space-y-2 p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-foreground/5" />
            ))}
          </div>
        ) : (
          <div
            id="search-palette-list"
            ref={listRef}
            role="listbox"
            className="max-h-[min(26rem,60vh)] overflow-y-auto p-2 pr-1 [scrollbar-gutter:stable] [&::-webkit-scrollbar-track]:mt-2 [&::-webkit-scrollbar-track]:mb-4"
          >
            {!shown.length ? <p className="py-8 text-center text-sm text-muted">Không có kết quả nào khớp. Thử từ khoá ngắn hơn.</p> : null}
            {shown.map((h, i) => (
              <button
                key={h.node.id}
                id={`search-opt-${i}`}
                data-index={i}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(i)}
                className={cn("flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left outline-hidden", i === active && "bg-item-hover")}
              >
                <NodeIcon node={h.node} />
                <span className="min-w-0 flex-1">
                  <Highlight parts={h.name} className="block truncate text-sm font-medium text-foreground" />
                  <span className="block truncate text-xs text-muted" title={hitMeta(h)}>
                    {h.snippet ? plain(h.snippet) : hitMeta(h)}
                  </span>
                </span>
              </button>
            ))}
            <button
              id={`search-opt-${shown.length}`}
              data-index={shown.length}
              type="button"
              role="option"
              aria-selected={active === shown.length}
              onMouseMove={() => setActive(shown.length)}
              onClick={() => go(shown.length)}
              className={cn("mt-1 flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm text-foreground outline-hidden", active === shown.length && "bg-item-hover")}
            >
              <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                Xem tất cả kết quả{total > shown.length ? <span className="text-muted tabular-nums"> · {total}</span> : null}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
