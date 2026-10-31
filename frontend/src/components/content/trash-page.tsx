"use client";

import { Trash2, Undo2 } from "lucide-react";
import { Clapperboard, File, FileText, Folder } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatWhen } from "@/lib/format";
import type { TrashItem } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { invalidateTree } from "@/lib/tree-sync";
import { PageBody, TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/dialog";
import { RowMenu } from "../ui/menu";
import { Badge, Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { useToast } from "../ui/toast";

const ICON = { FOLDER: Folder, DOCUMENT: FileText, FILE: File, VIDEO: Clapperboard };
const RETENTION_DAYS = 30;
const daysLeft = (iso: string) => Math.max(0, RETENTION_DAYS - Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

export function TrashPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const { me } = useAuth();
  const toast = useToast();
  const ws = me?.workspaces.find((w) => w.id === wsId);
  const isAdmin = !!me?.isSystemAdmin || ws?.role === "ADMIN";
  const { data, loading, error, reload } = useApi(() => api<TrashItem[]>(`/workspaces/${wsId}/trash`), [wsId]);
  const [confirm, setConfirm] = useState<{ kind: "purge"; item: TrashItem } | { kind: "empty" } | null>(null);

  const restore = async (item: TrashItem) => {
    try {
      const res = await api<{ movedToRoot: boolean; renamed: boolean; name: string }>(`/nodes/${item.id}/restore`, { method: "POST" });
      toast("success", `Đã khôi phục «${res.name}»${res.movedToRoot ? " về gốc (thư mục cũ đã bị xoá)" : ""}${res.renamed ? " (đổi tên vì trùng)" : ""}`);
      invalidateTree(wsId);
      await reload();
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Thùng rác{ws ? ` · ${ws.name}` : ""}</h1>
      </TopBar>
      <PageBody>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm text-muted text-pretty">Người đã xoá hoặc quản trị workspace khôi phục được; chỉ quản trị xoá vĩnh viễn. Khôi phục đưa cả nhánh về chỗ cũ; thư mục cha đã bị xoá thì về gốc.</p>
          {isAdmin && data?.length ? (
            <Button variant="danger" icon={Trash2} className="shrink-0 self-start" onClick={() => setConfirm({ kind: "empty" })}>
              Dọn sạch thùng rác
            </Button>
          ) : null}
        </div>
        <div className="@container">
          <Card>
            {loading && !data ? (
              <SkeletonRows rows={3} />
            ) : error ? (
              <ErrorBanner error={error} what="thùng rác" onRetry={reload} />
            ) : !data?.length ? (
              <EmptyState text="Thùng rác trống." />
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead className="hidden sm:table-header-group">
                    <tr className="text-left text-xs font-medium text-muted">
                      <th className="h-10 px-4 font-medium sm:pl-3">Tên</th>
                      <th className="hidden h-10 px-4 font-medium whitespace-nowrap @3xl:table-cell">Người xoá</th>
                      <th className="h-10 w-px px-4 font-medium whitespace-nowrap">Xoá lúc</th>
                      <th className="h-10 w-px px-4 font-medium whitespace-nowrap">Tự xoá sau</th>
                      <th className="h-10 w-px px-2 whitespace-nowrap sm:pr-3">
                        <span className="sr-only">Thao tác</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((t) => {
                      const Icon = ICON[t.type];
                      const left = daysLeft(t.deletedAt);
                      const canRestore = isAdmin || t.deletedBy?.id === me?.id;
                      return (
                        <tr key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-t border-border px-4 py-2.5 sm:table-row sm:px-0 sm:py-0">
                          <td className="min-w-0 sm:h-11 sm:w-full sm:max-w-0 sm:pr-4 sm:pl-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/70">
                                <Icon className="size-4" aria-hidden />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium" title={t.name}>
                                  {t.name}
                                </p>
                                <p className="truncate text-xs text-muted">
                                  {t.itemCount} mục<span className="@3xl:hidden"> · {t.deletedBy?.name ?? "—"}</span>
                                  <span className="sm:hidden"> · {formatWhen(t.deletedAt)}</span>
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="hidden px-4 text-sm whitespace-nowrap text-foreground/80 @3xl:table-cell">{t.deletedBy?.name ?? "—"}</td>
                          <td className="hidden px-4 text-sm whitespace-nowrap text-muted tabular-nums sm:table-cell">{formatWhen(t.deletedAt)}</td>
                          <td className="col-start-1 pl-11 text-sm whitespace-nowrap tabular-nums sm:w-px sm:px-4">
                            {left <= 3 ? <Badge tone="warn">{left} ngày</Badge> : <span className="text-muted">{left} ngày</span>}
                          </td>
                          <td className="col-start-2 row-span-2 row-start-1 whitespace-nowrap sm:w-px sm:px-2 sm:pr-3">
                            <div className="flex items-center justify-end gap-1">
                              {canRestore ? (
                                <Button icon={Undo2} className="h-8 min-h-8 rounded-lg px-3 whitespace-nowrap" onClick={() => restore(t)}>
                                  Khôi phục
                                </Button>
                              ) : null}
                              <RowMenu groups={[[{ icon: Trash2, label: "Xoá vĩnh viễn", danger: true, onSelect: () => setConfirm({ kind: "purge", item: t }), hidden: !isAdmin }]]} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="border-t border-border px-3 py-2 sm:px-3">
                  <p className="text-sm text-muted text-pretty">
                    {data.length} lần xoá · {data.reduce((s, t) => s + t.itemCount, 0)} mục. Mục quá {RETENTION_DAYS} ngày được tự xoá lúc 03:00 hằng ngày.
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>
      </PageBody>
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "empty" ? "Dọn sạch thùng rác?" : "Xoá vĩnh viễn?"}
        confirmLabel={confirm?.kind === "empty" ? "Dọn sạch" : "Xoá vĩnh viễn"}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            if (confirm.kind === "empty") {
              const res = await api<{ deleted: number }>(`/workspaces/${wsId}/trash`, { method: "DELETE" });
              toast("success", `Đã xoá vĩnh viễn ${res.deleted} lần xoá`);
            } else {
              await api(`/nodes/${confirm.item.id}/permanent`, { method: "DELETE" });
              toast("success", `Đã xoá vĩnh viễn «${confirm.item.name}»`);
            }
            invalidateTree(wsId);
            await reload();
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        {confirm?.kind === "empty" ? (
          "Mọi mục trong thùng rác sẽ bị xoá vĩnh viễn, không khôi phục được."
        ) : (
          <>
            <span className="font-medium text-foreground">{confirm?.kind === "purge" ? confirm.item.name : ""}</span>
            {confirm?.kind === "purge" && confirm.item.itemCount > 1 ? ` cùng ${confirm.item.itemCount - 1} mục bên trong` : ""} sẽ bị xoá vĩnh viễn, không khôi phục được.
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
