"use client";

import { ChevronLeft, ChevronRight, Download, Filter } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api, describeError, downloadFile } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ACTION_GROUPS, ACTION_LABEL, formatWhen } from "@/lib/format";
import type { AdminUser, AuditItem, Page, Workspace } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { Sheet } from "../ui/dialog";
import { Avatar, Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast";
import { ActionBadge, actorName, shortAgent, targetText } from "./audit-text";

const PAGE_SIZE = 50;
const RANGES = [
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày qua" },
  { value: "30d", label: "30 ngày qua" },
  { value: "all", label: "Mọi thời gian" },
] as const;
type Range = (typeof RANGES)[number]["value"];

function rangeFrom(range: Range): string | undefined {
  if (range === "all") return undefined;
  if (range === "today") {
    const start = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()) + "T00:00:00+07:00");
    return start.toISOString();
  }
  return new Date(Date.now() - (range === "7d" ? 7 : 30) * 86_400_000).toISOString();
}

export function LogsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const actorId = params.get("actorId") ?? "ALL";
  const group = params.get("group") ?? "ALL";
  const workspaceId = params.get("workspaceId") ?? "ALL";
  const targetId = params.get("targetId") ?? undefined;
  const range = (params.get("range") as Range | null) ?? "7d";
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [selected, setSelected] = useState<AuditItem | null>(null);
  const [exporting, setExporting] = useState(false);

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (!value || value === "ALL" || (key === "range" && value === "7d")) next.delete(key);
    else next.set(key, value);
    setCursors([undefined]);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };

  const users = useApi(() => api<Page<AdminUser>>("/admin/users", { query: { limit: 200 } }), []);
  const workspaces = useApi(() => api<Workspace[]>("/workspaces", { query: { scope: "all" } }), []);
  const filters = useMemo(
    () => ({
      actorId: actorId === "ALL" ? undefined : actorId,
      actions: group === "ALL" ? undefined : ACTION_GROUPS.find((g) => g.key === group)?.actions.join(","),
      workspaceId: workspaceId === "ALL" ? undefined : workspaceId,
      targetId,
      from: rangeFrom(range),
    }),
    [actorId, group, workspaceId, targetId, range],
  );
  const cursor = cursors[cursors.length - 1];
  const { data, loading, error, reload } = useApi(() => api<Page<AuditItem>>("/admin/audit-logs", { query: { ...filters, cursor, limit: PAGE_SIZE } }), [filters, cursor]);

  const userOptions = [{ value: "ALL", label: "Tất cả" }, ...(users.data?.items ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.email }))];
  const wsOptions = [{ value: "ALL", label: "Tất cả" }, ...(workspaces.data ?? []).map((w) => ({ value: w.id, label: w.name }))];
  const groupOptions = [{ value: "ALL", label: "Tất cả" }, ...ACTION_GROUPS.map((g) => ({ value: g.key, label: g.label }))];
  const filtered = actorId !== "ALL" || group !== "ALL" || workspaceId !== "ALL" || !!targetId || range !== "7d";

  return (
    <>
      <TopBar
        actions={
          <Button
            icon={Download}
            loading={exporting}
            aria-label="Xuất CSV"
            size="sm" className="h-9 shrink-0"
            onClick={async () => {
              setExporting(true);
              try {
                await downloadFile("/admin/audit-logs/export", filters, "nhat-ky.csv");
              } catch (err) {
                toast("error", describeError(err));
              } finally {
                setExporting(false);
              }
            }}
          >
            <span className="hidden sm:inline">Xuất CSV</span>
          </Button>
        }
      >
        <h1 className="truncate text-base font-semibold">Nhật ký hoạt động</h1>
      </TopBar>
      <PageBody>
        <div className="grid gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center">
          <Select prefix="Người:" value={actorId} options={userOptions} onChange={(v) => setParam("actorId", v)} className="xl:w-fit" />
          <Select prefix="Hành động:" value={group} options={groupOptions} onChange={(v) => setParam("group", v)} className="xl:w-fit" />
          <Select prefix="Workspace:" value={workspaceId} options={wsOptions} onChange={(v) => setParam("workspaceId", v)} className="xl:w-fit" />
          <Select value={range} options={[...RANGES]} onChange={(v) => setParam("range", v)} className="xl:w-fit" align="right" />
          {targetId ? (
            <Button variant="secondary" className="xl:w-fit" onClick={() => setParam("targetId", undefined)}>
              Đối tượng #{targetId.slice(0, 8)} ✕
            </Button>
          ) : null}
        </div>
        <div className="@container">
          <Card>
            {loading && !data ? (
              <SkeletonRows rows={8} />
            ) : error ? (
              <ErrorBanner error={error} what="nhật ký" onRetry={reload} />
            ) : !data?.items.length ? (
              <EmptyState
                text={filtered ? "Không có sự kiện nào khớp bộ lọc." : "Chưa có sự kiện nào."}
                action={filtered ? <Button onClick={() => router.replace(pathname)}>Xoá bộ lọc</Button> : undefined}
              />
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead className="hidden sm:table-header-group">
                    <tr className="text-left text-xs font-medium text-muted">
                      <th className="h-10 w-px pr-4 pl-3 font-medium whitespace-nowrap">Thời gian</th>
                      <th className="h-10 px-4 font-medium">Người</th>
                      <th className="h-10 w-px px-4 font-medium whitespace-nowrap">Hành động</th>
                      <th className="hidden h-10 px-4 font-medium @4xl:table-cell">Đối tượng</th>
                      <th className="hidden h-10 w-px px-4 font-medium whitespace-nowrap @5xl:table-cell">Workspace</th>
                      <th className="hidden h-10 w-px px-4 font-medium whitespace-nowrap @3xl:table-cell">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => {
                      const target = targetText(item);
                      const failed = item.action === "auth.login_failed";
                      return (
                        <tr
                          key={item.id}
                          tabIndex={0}
                          aria-label={`${actorName(item)} ${ACTION_LABEL[item.action] ?? item.action}, xem chi tiết`}
                          onClick={() => setSelected(item)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(item))}
                          className={cn(
                            "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-border px-4 py-3 outline-hidden hover:bg-surface-hover focus-visible:bg-surface-hover sm:table-row sm:px-0 sm:py-0",
                            selected?.id === item.id && "bg-surface-hover",
                          )}
                        >
                          <td className="col-start-2 row-start-1 text-xs whitespace-nowrap text-muted tabular-nums sm:h-11 sm:pr-4 sm:pl-3 sm:text-sm">{formatWhen(item.createdAt, { withTime: true })}</td>
                          <td className="col-start-1 row-start-1 min-w-0 sm:max-w-0 sm:px-4">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Avatar name={actorName(item)} src={item.actor?.avatarUrl} size="size-7" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{actorName(item)}</p>
                                <p className="hidden truncate text-xs text-muted sm:block">{item.actor?.email ?? (item.metadata?.email ? "chưa có tài khoản" : "tự động")}</p>
                              </div>
                            </div>
                            {target || item.workspace ? (
                              <p className="mt-1.5 hidden truncate text-xs text-muted sm:block @4xl:hidden">{[target, item.workspace?.name].filter(Boolean).join(" · ")}</p>
                            ) : null}
                          </td>
                          <td className="col-span-2 flex min-w-0 items-center gap-2 pl-9.5 sm:table-cell sm:w-px sm:px-4">
                            <ActionBadge action={item.action} />
                            {target || item.workspace ? (
                              <span className="min-w-0 truncate text-xs text-muted sm:hidden">{[target, item.workspace?.name].filter(Boolean).join(" · ")}</span>
                            ) : null}
                          </td>
                          <td className="hidden min-w-0 px-4 @4xl:table-cell @4xl:max-w-0">
                            <p className="truncate text-sm text-foreground/80" title={target ?? ""}>
                              {target ?? <span className="text-muted">—</span>}
                            </p>
                          </td>
                          <td className="hidden px-4 text-sm whitespace-nowrap text-foreground/80 @5xl:table-cell">{item.workspace?.name ?? <span className="text-muted">—</span>}</td>
                          <td className={cn("hidden px-4 text-sm whitespace-nowrap tabular-nums @3xl:table-cell", failed ? "font-medium text-err" : "text-muted")}>{item.ip ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2">
                  <p className="text-sm tabular-nums text-muted">
                    {data.items.length} sự kiện{cursors.length > 1 || data.nextCursor ? ` · trang ${cursors.length}` : ""}
                  </p>
                  {cursors.length > 1 || data.nextCursor ? (
                    <nav aria-label="Phân trang" className="flex items-center gap-1">
                      <button type="button" aria-label="Trang trước" disabled={cursors.length === 1} onClick={() => setCursors(cursors.slice(0, -1))} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
                        <ChevronLeft className="size-4" aria-hidden />
                      </button>
                      <button type="button" aria-label="Trang sau" disabled={!data.nextCursor} onClick={() => setCursors([...cursors, data.nextCursor ?? undefined])} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
                        <ChevronRight className="size-4" aria-hidden />
                      </button>
                    </nav>
                  ) : null}
                </div>
              </>
            )}
          </Card>
        </div>
      </PageBody>

      <Sheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? (ACTION_LABEL[selected.action] ?? selected.action) : ""}
        subtitle={selected ? `${formatWhen(selected.createdAt, { withTime: true })} · sự kiện #${selected.id}` : undefined}
      >
        {selected ? (
          <div className="px-6 py-6">
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
              <dt className="text-muted">Người</dt>
              <dd className="[overflow-wrap:anywhere]">
                {actorName(selected)}
                {selected.actor ? <span className="block text-xs text-muted">{selected.actor.email}</span> : null}
              </dd>
              <dt className="text-muted">Hành động</dt>
              <dd>
                <ActionBadge action={selected.action} />
              </dd>
              <dt className="text-muted">Đối tượng</dt>
              <dd className="[overflow-wrap:anywhere]">{targetText(selected) ?? "—"}</dd>
              <dt className="text-muted">Workspace</dt>
              <dd>{selected.workspace?.name ?? "—"}</dd>
              <dt className="text-muted">IP</dt>
              <dd className="tabular-nums">{selected.ip ?? "—"}</dd>
              <dt className="text-muted">Thiết bị</dt>
              <dd title={selected.userAgent ?? ""}>{shortAgent(selected.userAgent)}</dd>
            </dl>
            {selected.metadata && Object.keys(selected.metadata).length ? (
              <div className="mt-6">
                <h3 className="text-sm font-semibold">Dữ liệu kèm theo</h3>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-foreground/4 p-3 text-xs leading-relaxed text-foreground/80">{JSON.stringify(selected.metadata, null, 2)}</pre>
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              {selected.actor ? (
                <Button
                  icon={Filter}
                  onClick={() => {
                    setParam("actorId", selected.actor!.id);
                    setSelected(null);
                  }}
                >
                  Mọi sự kiện của người này
                </Button>
              ) : null}
              {targetText(selected) ? (
                <Button
                  icon={Filter}
                  onClick={() => {
                    setParam("targetId", selected.target!.id);
                    setSelected(null);
                  }}
                >
                  Mọi sự kiện trên đối tượng này
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
