"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatWhen, SHARE_LABEL, TYPE_LABEL } from "@/lib/format";
import type { NodeItem } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { NoWorkspaceNotice } from "../shell/no-workspace";
import { PageBody, TopBar } from "../shell/shell";
import { Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { NodeName } from "./node-name";

interface Row {
  node: NodeItem;
  meta: React.ReactNode;
  right: React.ReactNode;
}

function NodeListPage({ title, empty, load }: { title: string; empty: string; load: () => Promise<Row[]> }) {
  const { data, loading, error, reload } = useApi(load, []);
  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">{title}</h1>
      </TopBar>
      <PageBody>
        <NoWorkspaceNotice />
        <Card>
          {loading && !data ? (
            <SkeletonRows rows={5} />
          ) : error ? (
            <ErrorBanner error={error} what={title.toLowerCase()} onRetry={reload} />
          ) : !data?.length ? (
            <EmptyState text={empty} />
          ) : (
            <ul>
              {data.map((r, i) => (
                <li key={r.node.id} className={cn("relative flex min-h-11 items-center gap-3 px-3 py-2 hover:bg-surface-hover", i && "border-t border-border")}>
                  <div className="min-w-0 flex-1">
                    <NodeName node={r.node} sub={r.meta} stretched />
                  </div>
                  <div className="shrink-0 text-right text-sm whitespace-nowrap text-muted tabular-nums">{r.right}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  );
}

export function SharedPage() {
  return (
    <NodeListPage
      title="Được chia sẻ với tôi"
      empty="Chưa có mục nào được chia sẻ riêng cho bạn."
      load={async () =>
        (
          await api<Array<{ node: NodeItem; shareRole: "EDITOR" | "VIEWER"; sharedBy: { name: string } | null; sharedAt: string; workspace: { name: string } }>>("/shared-with-me")
        ).map((s) => ({
          node: s.node,
          meta: `${TYPE_LABEL[s.node.type]} · ${s.workspace.name}${s.sharedBy ? ` · bởi ${s.sharedBy.name}` : ""}`,
          right: (
            <>
              <span className="block text-foreground/80">{SHARE_LABEL[s.shareRole]}</span>
              <span className="text-xs">{formatWhen(s.sharedAt)}</span>
            </>
          ),
        }))
      }
    />
  );
}

export function FavoritesPage() {
  return (
    <NodeListPage
      title="Yêu thích"
      empty="Chưa có mục yêu thích. Bấm ngôi sao ở một dòng để thêm."
      load={async () =>
        (await api<NodeItem[]>("/me/favorites")).map((n) => ({
          node: n,
          meta: `${TYPE_LABEL[n.type]} · ${n.createdBy.name}`,
          right: formatWhen(n.updatedAt),
        }))
      }
    />
  );
}

export function RecentPage() {
  return (
    <NodeListPage
      title="Gần đây"
      empty="Chưa mở tài liệu, tệp hay video nào. Thư mục không tính vào danh sách này."
      load={async () =>
        (await api<Array<{ node: NodeItem; viewedAt: string }>>("/me/recent")).map((r) => ({
          node: r.node,
          meta: `${TYPE_LABEL[r.node.type]} · ${r.node.createdBy.name}`,
          right: formatWhen(r.viewedAt),
        }))
      }
    />
  );
}
