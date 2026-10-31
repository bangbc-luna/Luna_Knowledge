"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatBytes } from "@/lib/files";
import { formatDuration, formatNumber, formatWhen } from "@/lib/format";
import type { AdminVideo } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { Button, IconButton } from "../ui/button";
import { ConfirmDialog } from "../ui/dialog";
import { SearchInput } from "../ui/input";
import { Badge, Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";

const LIMIT = 50;

function StatusBadge({ status }: { status: AdminVideo["status"] }) {
  if (status === "READY") return null;
  if (status === "FAILED") return <Badge small tone="err">Lỗi xử lý</Badge>;
  return <Badge small tone="warn">{status === "UPLOADING" ? "Đang tải lên" : "Đang xử lý"}</Badge>;
}

export function VideosPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<AdminVideo | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, error, reload } = useApi(() => api<AdminVideo[]>("/admin/videos", { query: { q: query || undefined, limit: LIMIT } }), [query]);

  const downloadOriginal = async (v: AdminVideo) => {
    try {
      const link = await api<{ url: string }>(`/admin/videos/${v.id}/original-link`, { method: "POST" });
      window.location.assign(link.url);
      toast("success", `Đang tải file gốc «${v.name}»`);
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Video</h1>
      </TopBar>
      <PageBody>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <p className="min-w-0 flex-1 text-sm text-pretty text-muted">Người dùng chỉ xem được video, không tải về. File gốc chỉ lấy ở đây, mỗi lượt tải đều ghi vào nhật ký.</p>
          <SearchInput label="Tìm video" placeholder="Tìm theo tên video" value={q} onChange={(e) => setQ(e.target.value)} className="md:w-72" />
        </div>
        <div className="@container">
          <Card>
            {loading && !data ? (
              <SkeletonRows rows={6} />
            ) : error ? (
              <ErrorBanner error={error} what="danh sách video" onRetry={reload} />
            ) : !data?.length ? (
              <EmptyState text={query ? `Không có video nào khớp «${query}».` : "Chưa có video nào."} action={query ? <Button onClick={() => setQ("")}>Xoá tìm kiếm</Button> : undefined} />
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead className="hidden sm:table-header-group">
                    <tr className="text-left text-xs font-medium text-muted">
                      <th className="h-10 pr-4 pl-3 font-medium">Video</th>
                      <th className="hidden h-10 px-4 font-medium whitespace-nowrap @3xl:table-cell">Người tải lên</th>
                      <th className="hidden h-10 w-px px-4 text-right font-medium whitespace-nowrap @2xl:table-cell">Thời lượng</th>
                      <th className="hidden h-10 w-px px-4 text-right font-medium whitespace-nowrap @2xl:table-cell">Dung lượng</th>
                      <th className="hidden h-10 w-px px-4 text-right font-medium whitespace-nowrap @4xl:table-cell">Lượt xem</th>
                      <th className="hidden h-10 w-px px-4 font-medium whitespace-nowrap @3xl:table-cell">Tải lên</th>
                      <th className="h-10 w-px px-2 whitespace-nowrap sm:pr-3">
                        <span className="sr-only">Thao tác</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((v) => (
                      <tr key={v.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-t border-border px-4 py-2.5 sm:table-row sm:px-0 sm:py-0">
                        <td className="min-w-0 sm:h-11 sm:w-full sm:max-w-0 sm:pr-4 sm:pl-3">
                          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                            <span className="truncate" title={v.name}>
                              {v.name}
                            </span>
                            <StatusBadge status={v.status} />
                          </p>
                          <p className="truncate text-xs text-muted tabular-nums">
                            {v.workspace.name}
                            <span className="@3xl:hidden"> · {v.createdBy.name}</span>
                            <span className="@2xl:hidden">
                              {v.durationSec !== null ? ` · ${formatDuration(v.durationSec)}` : ""}
                              {v.size !== null ? ` · ${formatBytes(v.size)}` : ""}
                            </span>
                          </p>
                        </td>
                        <td className="hidden max-w-0 px-4 @3xl:table-cell">
                          <p className="truncate text-sm text-foreground/80" title={v.createdBy.email}>
                            {v.createdBy.name}
                          </p>
                        </td>
                        <td className="hidden px-4 text-right text-sm whitespace-nowrap text-foreground/80 tabular-nums @2xl:table-cell">{v.durationSec !== null ? formatDuration(v.durationSec) : <span className="text-muted">—</span>}</td>
                        <td className="hidden px-4 text-right text-sm whitespace-nowrap text-foreground/80 tabular-nums @2xl:table-cell">{v.size !== null ? formatBytes(v.size) : <span className="text-muted">—</span>}</td>
                        <td className="hidden px-4 text-right text-sm whitespace-nowrap text-foreground/80 tabular-nums @4xl:table-cell">{formatNumber(v.viewCount)}</td>
                        <td className="hidden px-4 text-sm whitespace-nowrap text-muted tabular-nums @3xl:table-cell">{formatWhen(v.createdAt)}</td>
                        <td className="whitespace-nowrap sm:w-px sm:px-2 sm:pr-3">
                          <div className="flex justify-end">
                            <IconButton icon={Download} label={`Tải file gốc ${v.name}`} disabled={v.size === null} onClick={() => setTarget(v)} className="@xl:hidden" />
                            <span className="hidden @xl:block">
                              <Button icon={Download} disabled={v.size === null} onClick={() => setTarget(v)} className="min-h-8 rounded-lg px-3">
                                Tải file gốc
                              </Button>
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-border px-3 py-2">
                  <p className="text-sm text-muted tabular-nums">
                    {data.length} video{data.length === LIMIT ? ` · đang hiện ${LIMIT} video mới nhất, tìm theo tên để thấy video cũ hơn` : ""}
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>
      </PageBody>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Tải file gốc video?"
        confirmLabel="Tải file gốc"
        danger={false}
        icon={Download}
        onConfirm={async () => {
          if (target) await downloadOriginal(target);
        }}
      >
        Lượt tải <span className="font-medium text-foreground">{target?.name}</span>
        {target?.size !== null && target?.size !== undefined ? ` (${formatBytes(target.size)})` : ""} sẽ được ghi vào nhật ký hệ thống với tên của bạn.
      </ConfirmDialog>
    </>
  );
}
