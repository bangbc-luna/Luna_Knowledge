"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatNumber, formatWhen } from "@/lib/format";
import { getMeetingUsage } from "@/lib/meetings";
import type { MeetingUsage } from "@/lib/meetings";
import type { AdminStats, AuditItem, Page } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { Avatar, Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { actorName, AuditSentence } from "./audit-text";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "warn" }) {
  return (
    <div className="row-span-3 grid min-w-0 grid-rows-subgrid content-start gap-1 bg-surface p-4 sm:p-5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
      <p className={cn("text-xs text-pretty", tone === "warn" ? "font-medium text-warn" : "text-muted")}>{sub}</p>
    </div>
  );
}

function ActivityChart({ days }: { days: AdminStats["activity"]["last7Days"] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((s, d) => s + d.count, 0);
  if (!total) {
    return (
      <div className="flex min-h-[14rem] flex-1 flex-col justify-center">
        <p className="text-sm text-muted">Chưa có hoạt động nào trong 7 ngày. Số liệu hiện sau lượt đăng nhập đầu tiên.</p>
      </div>
    );
  }
  const label = (iso: string, i: number) => (i === days.length - 1 ? "Hôm nay" : `${iso.slice(8, 10)}/${iso.slice(5, 7)}`);
  return (
    <>
      <div className="flex min-h-[14rem] flex-1 items-end gap-2 sm:gap-3" role="img" aria-label={`Lượt hoạt động 7 ngày, tổng ${total}`}>
        {days.map((d, i) => (
          <div key={d.date} className="flex h-full flex-1 flex-col justify-end gap-2">
            <p className="text-center text-xs font-medium text-muted tabular-nums">{d.count}</p>
            <div
              className={cn("mx-auto w-full max-w-8 rounded-t-md", i === days.length - 1 ? "bg-chart-fill/35" : "bg-chart-fill")}
              style={{ height: `${Math.max(d.count ? 2 : 0, Math.round((d.count / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2 border-t border-border pt-3 sm:gap-3">
        {days.map((d, i) => (
          <p key={d.date} className="min-w-0 flex-1 text-center text-xs/4 text-balance text-muted">
            {label(d.date, i)}
          </p>
        ))}
      </div>
    </>
  );
}

const usd = (n: number) => `$${n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function usageRange() {
  const now = new Date(Date.now() + 7 * 3_600_000);
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  return { from: key(start), to: key(now) };
}

function MeetingsUsage({ months }: { months: MeetingUsage["months"] }) {
  const showLiveKit = months.some((m) => m.liveKitEstimateUsd > 0);
  const th = "h-9 px-3 text-right font-medium whitespace-nowrap";
  const td = "h-10 px-3 text-right text-sm whitespace-nowrap tabular-nums text-foreground/80";
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[30rem] border-collapse">
        <thead>
          <tr className="text-xs text-muted">
            <th className="h-9 pr-3 text-left font-medium whitespace-nowrap">Tháng</th>
            <th className={th}>Cuộc họp</th>
            <th className={th}>Phút phòng</th>
            <th className={th}>Phút người dự</th>
            <th className={th}>Phút chép lời</th>
            <th className={th}>Chi phí AI</th>
            {showLiveKit ? <th className={th}>LiveKit ước tính</th> : null}
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((m) => (
            <tr key={m.month} className="border-t border-border">
              <th scope="row" className="h-10 pr-3 text-left text-sm font-medium whitespace-nowrap">
                {m.month.slice(5)}/{m.month.slice(0, 4)}
              </th>
              <td className={td}>{formatNumber(m.meetings)}</td>
              <td className={td}>{formatNumber(m.roomMinutes)}</td>
              <td className={td}>{formatNumber(m.participantMinutes)}</td>
              <td className={td}>{formatNumber(m.sttMinutes)}</td>
              <td className={td}>{usd(m.aiCostUsd)}</td>
              {showLiveKit ? <td className={td}>{usd(m.liveKitEstimateUsd)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OverviewPage() {
  const stats = useApi(() => api<AdminStats>("/admin/stats"), []);
  const recent = useApi(() => api<Page<AuditItem>>("/admin/audit-logs", { query: { limit: 6 } }), []);
  const usage = useApi(() => {
    const range = usageRange();
    return getMeetingUsage(range.from, range.to);
  }, []);
  const s = stats.data;
  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Tổng quan</h1>
      </TopBar>
      <PageBody>
        {stats.error ? (
          <Card>
            <ErrorBanner error={stats.error} what="số liệu tổng quan" onRetry={stats.reload} />
          </Card>
        ) : !s ? (
          <Card>
            <SkeletonRows rows={2} />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border-strong bg-border-strong lg:grid-cols-4">
            <Stat label="Người dùng" value={formatNumber(s.users.total)} sub={`${s.users.active} đang hoạt động · ${s.users.disabled} đã khoá`} />
            <Stat label="Hoạt động 7 ngày" value={formatNumber(s.users.activeLast7Days)} sub="người có thao tác" />
            <Stat label="Workspace" value={formatNumber(s.workspaces.total)} sub={`${formatNumber(s.content.folders)} thư mục · ${formatNumber(s.content.documents + s.content.files + s.content.videos)} tệp`} />
            <Stat label="Đăng nhập thất bại" value={formatNumber(s.activity.failedLoginsLast7Days)} sub="7 ngày qua" tone={s.activity.failedLoginsLast7Days ? "warn" : undefined} />
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="flex h-full flex-col p-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-base font-semibold text-balance">Lượt hoạt động 7 ngày</h2>
                <p className="text-xs whitespace-nowrap text-muted">Hôm nay chưa hết ngày</p>
              </div>
              {s ? <ActivityChart days={s.activity.last7Days} /> : <div className="min-h-[14rem] animate-pulse rounded-xl bg-foreground/4" />}
            </div>
          </Card>
          <Card>
            <div className="flex h-full flex-col p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Hoạt động gần đây</h2>
                <Link href="/admin/logs" className="inline-flex h-8 shrink-0 items-center text-sm font-medium whitespace-nowrap text-foreground/70 underline decoration-border-strong underline-offset-4 hover:text-foreground">
                  Xem nhật ký
                </Link>
              </div>
              {recent.loading && !recent.data ? (
                <SkeletonRows rows={4} />
              ) : recent.error ? (
                <p className="text-sm text-err-text">Không tải được hoạt động gần đây.</p>
              ) : !recent.data?.items.length ? (
                <EmptyState text="Chưa có hoạt động." />
              ) : (
                <ul className="flex flex-col">
                  {recent.data.items.map((item, i) => (
                    <li key={item.id} className={cn("flex gap-3 py-2.5", i && "border-t border-border")}>
                      <Avatar name={actorName(item)} src={item.actor?.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm text-foreground/80 text-pretty">
                          <AuditSentence item={item} />
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {item.workspace ? `${item.workspace.name} · ` : ""}
                          {formatWhen(item.createdAt, { withTime: true })}
                          {item.action === "auth.login_failed" && item.ip ? <span className="font-medium text-err"> · IP {item.ip}</span> : null}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
        <Card>
          <div className="p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold">Cuộc họp</h2>
              <p className="text-xs text-muted">6 tháng gần nhất</p>
            </div>
            {usage.error ? (
              <ErrorBanner error={usage.error} what="số liệu cuộc họp" onRetry={usage.reload} />
            ) : !usage.data ? (
              <SkeletonRows rows={3} />
            ) : !usage.data.months.some((m) => m.meetings > 0) ? (
              <EmptyState text="Chưa có cuộc họp nào trong 6 tháng qua." />
            ) : (
              <MeetingsUsage months={usage.data.months} />
            )}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
