"use client";

import { Bell, BellDot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { type AppNotification, docHref } from "@/lib/documents";
import { formatWhen } from "@/lib/format";
import { subscribeSse } from "@/lib/sse";
import type { Page } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Avatar, Tabs } from "../ui/misc";
import { PopoverPanel, usePopover } from "../ui/popover";

type Filter = "all" | "unread";
type NotificationPage = Page<AppNotification> & { unreadCount: number };

function describe(n: AppNotification): { actor: string | null; text: React.ReactNode; snippet?: string } {
  const p = n.payload;
  const name = <span className="font-medium text-foreground">{p.nodeName ?? "một mục"}</span>;
  const by = p.byName ?? null;
  switch (n.type) {
    case "comment.mention":
      return { actor: by, text: <><span className="font-medium text-foreground">{by}</span> đã nhắc đến bạn trong {name}</>, snippet: p.snippet };
    case "comment.new":
      return { actor: by, text: <><span className="font-medium text-foreground">{by}</span> đã bình luận trong {name}</>, snippet: p.snippet };
    case "share.added":
      return { actor: by, text: <><span className="font-medium text-foreground">{by}</span> đã chia sẻ {name} với bạn{p.role === "EDITOR" ? " (được chỉnh sửa)" : " (chỉ xem)"}</> };
    case "video.ready":
      return { actor: null, text: <>Video {name} đã xử lý xong, xem được rồi</> };
    case "video.failed":
      return { actor: null, text: <>Video {name} xử lý không thành công</>, snippet: p.error };
    default:
      return { actor: by, text: name };
  }
}

function hrefOf(n: AppNotification): string | null {
  const p = n.payload;
  if (!p.nodeId || !p.workspaceId) return null;
  if (n.type.startsWith("comment.")) return `${docHref(p.workspaceId, p.nodeId)}${p.threadId ? `?thread=${p.threadId}` : ""}`;
  if (n.type.startsWith("video.")) return `/w/${p.workspaceId}/file/${p.nodeId}`;
  if (p.nodeType === "FOLDER") return `/w/${p.workspaceId}/f/${p.nodeId}`;
  if (p.nodeType === "DOCUMENT") return docHref(p.workspaceId, p.nodeId);
  return `/w/${p.workspaceId}/file/${p.nodeId}`;
}

export function NotificationBell() {
  const { me } = useAuth();
  const router = useRouter();
  const { open, setOpen, toggle, rootRef } = usePopover();
  const [filter, setFilter] = useState<Filter>("all");
  const feed = useApi(() => api<NotificationPage>("/me/notifications", { query: { limit: 30 } }), [me?.id], { enabled: !!me });
  const { setData, reload } = feed;
  const items = feed.data?.items ?? null;
  const unread = feed.data?.unreadCount ?? 0;
  const error = !!feed.error;

  useEffect(() => {
    if (!me) return;
    return subscribeSse<AppNotification>("/me/notifications/stream", (_type, n) => {
      if (!n?.id) return;
      setData((page) => {
        const base = page ?? { items: [], nextCursor: null, unreadCount: 0 };
        if (base.items.some((x) => x.id === n.id)) return base;
        return { ...base, items: [n, ...base.items].slice(0, 50), unreadCount: base.unreadCount + 1 };
      });
    });
  }, [me, setData]);

  const markRead = async (ids?: string[]) => {
    const now = new Date().toISOString();
    setData((page) =>
      page
        ? {
            ...page,
            items: page.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)),
            unreadCount: ids ? Math.max(0, page.unreadCount - ids.length) : 0,
          }
        : page,
    );
    await api("/me/notifications/read", { method: "POST", body: ids ? { ids } : { all: true } }).catch(() => void reload());
  };

  if (!me) return null;
  const list = (items ?? []).filter((n) => filter === "all" || !n.readAt);
  const Icon = unread ? BellDot : Bell;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={unread ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          toggle();
          if (!open) void reload();
        }}
        className="inline-flex size-10 cursor-pointer items-center justify-center rounded-xl text-foreground/70 outline-hidden transition-colors hover:bg-foreground/5 hover:text-foreground aria-expanded:bg-foreground/5"
      >
        <Icon className={cn("size-5", unread && "[&_circle]:fill-current")} aria-hidden />
      </button>
      <PopoverPanel open={open} align="right" className="mt-3 w-96 max-w-[calc(100vw-2rem)] py-0">
        <div role="dialog" aria-label="Thông báo">
          <div className="flex items-center gap-2 pt-3 pr-1 pl-4">
            <h2 className="flex-1 text-sm font-semibold">Thông báo</h2>
            {unread ? (
              <button type="button" onClick={() => void markRead()} className="inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground">
                Đánh dấu đã đọc
              </button>
            ) : null}
          </div>
          <div className="px-3 pt-2 pb-2">
            <Tabs
              label="Lọc thông báo"
              value={filter}
              onChange={setFilter}
              items={[
                { value: "all", label: "Tất cả" },
                { value: "unread", label: "Chưa đọc" },
              ]}
            />
          </div>
          <div className="border-t border-border">
            {error && !items ? (
              <p className="px-4 py-10 text-center text-sm text-muted">Không tải được thông báo.</p>
            ) : !items ? (
              <div aria-busy="true" aria-label="Đang tải" className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-foreground/5" />
                ))}
              </div>
            ) : !list.length ? (
              <p className="px-4 py-10 text-center text-sm text-muted">{filter === "unread" && items.length ? "Bạn đã đọc hết thông báo" : "Chưa có thông báo nào"}</p>
            ) : (
              <ul className="mb-2 max-h-[min(28rem,calc(100dvh-13rem))] overflow-y-auto p-2">
                {list.map((n) => {
                  const info = describe(n);
                  const href = hrefOf(n);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        disabled={!href}
                        onClick={() => {
                          if (!n.readAt) void markRead([n.id]);
                          setOpen(false);
                          if (href) router.push(href);
                        }}
                        className="flex w-full cursor-pointer gap-3 rounded-lg px-3 py-3 text-left outline-hidden hover:bg-item-hover focus-visible:bg-item-hover disabled:cursor-default"
                      >
                        {info.actor ? (
                          <Avatar name={info.actor} />
                        ) : (
                          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-foreground/70" aria-hidden>
                            <Bell className="size-4" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className={cn("line-clamp-2 text-sm [overflow-wrap:anywhere]", n.readAt ? "text-foreground/70" : "text-foreground")}>{info.text}</span>
                          {info.snippet ? <span className="mt-0.5 line-clamp-2 text-sm text-muted [overflow-wrap:anywhere]">{info.snippet}</span> : null}
                          <span className="mt-1 block text-xs text-muted tabular-nums">{formatWhen(n.createdAt, { withTime: true })}</span>
                        </span>
                        {!n.readAt ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" aria-label="Chưa đọc" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </PopoverPanel>
    </div>
  );
}
