"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { formatNumber, formatWhen, SHARE_LABEL } from "@/lib/format";
import type { ActivityItem, NodeItem, Page } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button } from "../ui/button";
import { Sheet } from "../ui/dialog";
import { Avatar, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

function describe(a: ActivityItem): { text: React.ReactNode; detail?: React.ReactNode } {
  const m = a.metadata;
  switch (a.action) {
    case "node.create":
      return { text: "đã tạo mục này" };
    case "node.rename":
      return { text: "đã đổi tên", detail: `«${str(m.from)}» → «${str(m.to)}»` };
    case "node.move":
      return { text: "đã di chuyển sang thư mục khác" };
    case "node.trash":
      return { text: "đã xoá vào thùng rác" };
    case "node.restore":
      return { text: "đã khôi phục từ thùng rác" };
    case "document.edit": {
      const added = num(m.wordsAdded);
      const removed = num(m.wordsRemoved);
      return {
        text: "đã sửa nội dung",
        detail: (
          <>
            {added ? <span className="text-ok">thêm {formatNumber(added)} từ</span> : null}
            {added && removed ? ", " : null}
            {removed ? <span className="text-err">bớt {formatNumber(removed)} từ</span> : null}
            {!added && !removed ? "đổi định dạng" : null}
            {m.versionNo ? <span className="text-muted"> · phiên bản {num(m.versionNo)}</span> : null}
          </>
        ),
      };
    }
    case "document.import":
      return { text: "đã tạo từ file Word" };
    case "document.copy":
      return { text: "đã tạo bản sao từ", detail: m.fromName ? `«${str(m.fromName)}»` : undefined };
    case "document.version_create":
      return { text: "đã lưu phiên bản", detail: m.versionName ? `«${str(m.versionName)}»` : undefined };
    case "document.version_restore":
      return { text: `đã khôi phục phiên bản ${num(m.fromVersionNo)}` };
    case "file.upload":
      return { text: m.newVersion ? "đã tải lên phiên bản mới" : "đã tải lên", detail: str(m.fileName) || undefined };
    case "file.version_restore":
      return { text: `đã dùng lại phiên bản ${num(m.versionNo)}` };
    case "file.regenerate":
      return { text: "đã tạo lại bản xem trước" };
    case "video.retranscode":
      return { text: "đã xử lý lại video" };
    case "video.update_info":
    {
      const renamed = m.from !== m.to;
      const text = renamed && m.descriptionChanged ? "đã sửa tiêu đề và mô tả" : renamed ? "đã sửa tiêu đề" : "đã sửa mô tả";
      return { text, detail: renamed ? `«${str(m.from)}» → «${str(m.to)}»` : undefined };
    }
    case "share.add":
      return { text: "đã chia sẻ", detail: `${str(m.email) || "một người"} · ${SHARE_LABEL[m.role === "EDITOR" ? "EDITOR" : "VIEWER"]}` };
    case "share.update":
      return { text: "đã đổi quyền chia sẻ" };
    case "share.remove":
      return { text: "đã thu hồi chia sẻ" };
    default:
      return { text: a.action };
  }
}

export function ActivitySheet({ node, open, onClose }: { node: Pick<NodeItem, "id" | "name">; open: boolean; onClose: () => void }) {
  const first = useApi(() => api<Page<ActivityItem>>(`/nodes/${node.id}/activity`, { query: { limit: 30 } }), [node.id, open], { enabled: open });
  const [more, setMore] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setMore([]);
    setCursor(undefined);
  }
  const next = cursor === undefined ? first.data?.nextCursor : cursor;
  const items = [...(first.data?.items ?? []), ...more];

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await api<Page<ActivityItem>>(`/nodes/${node.id}/activity`, { query: { limit: 30, cursor: next } });
      setMore((list) => [...list, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Hoạt động" subtitle={<span className="block truncate">{node.name}</span>}>
      {first.loading && !first.data ? (
        <SkeletonRows rows={5} />
      ) : first.error ? (
        <ErrorBanner error={first.error} what="hoạt động" onRetry={() => void first.reload()} />
      ) : !items.length ? (
        <EmptyState text="Chưa có hoạt động nào." />
      ) : (
        <div className="px-6 py-5">
          <p className="mb-4 text-xs text-pretty text-muted">Chỉ người sở hữu, người được chia sẻ quyền chỉnh sửa và quản trị hệ thống thấy mục này.</p>
          <ol className="text-sm">
            {items.map((a, i) => {
              const d = describe(a);
              return (
                <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {i < items.length - 1 ? <span className="absolute top-10 bottom-1 left-[15px] w-0.5 bg-border" aria-hidden /> : null}
                  <Avatar name={a.actor?.name ?? "Hệ thống"} src={a.actor?.avatarUrl} />
                  <div className="min-w-0 flex-1 pt-1.5">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <p className="text-foreground">
                        <span className="font-medium">{a.actor?.name ?? "Hệ thống"}</span> {d.text}
                      </p>
                      <time className="shrink-0 text-xs whitespace-nowrap text-muted tabular-nums" dateTime={a.createdAt}>
                        {formatWhen(a.createdAt, { withTime: true })}
                      </time>
                    </div>
                    {d.detail ? <p className="mt-1 max-w-[55ch] text-pretty text-muted [overflow-wrap:anywhere]">{d.detail}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {next ? (
            <Button variant="ghost" className="mt-4 ml-8" loading={loadingMore} onClick={() => void loadMore()}>
              Xem hoạt động cũ hơn
            </Button>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
