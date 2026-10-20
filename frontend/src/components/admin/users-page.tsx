"use client";

import { ChevronLeft, ChevronRight, Lock, LockOpen, ScrollText, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatWhen } from "@/lib/format";
import type { AdminUser, Page } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PageBody, TopBar } from "../shell/shell";
import { ConfirmDialog } from "../ui/dialog";
import { SearchInput } from "../ui/input";
import { RowMenu } from "../ui/menu";
import { Avatar, Badge, Card, EmptyState, ErrorBanner, SkeletonRows, Tabs } from "../ui/misc";
import { useToast } from "../ui/toast";
import { Button } from "../ui/button";

type Status = "ALL" | "ACTIVE" | "DISABLED";
const PAGE_SIZE = 25;

export function UsersPage() {
  const { me, reloadMe } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("ALL");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [confirm, setConfirm] = useState<{ user: AdminUser; patch: { status?: "ACTIVE" | "DISABLED"; isSystemAdmin?: boolean } } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setCursors([undefined]);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const cursor = cursors[cursors.length - 1];
  const { data, loading, error, reload } = useApi(
    () => api<Page<AdminUser>>("/admin/users", { query: { q: query || undefined, status: status === "ALL" ? undefined : status, cursor, limit: PAGE_SIZE } }),
    [query, status, cursor],
  );

  const apply = async (user: AdminUser, patch: { status?: "ACTIVE" | "DISABLED"; isSystemAdmin?: boolean }) => {
    try {
      await api(`/admin/users/${user.id}`, { method: "PATCH", body: patch });
      toast(
        "success",
        patch.status === "DISABLED" ? `Đã khoá ${user.email}, mọi phiên của họ bị thu hồi` : patch.status === "ACTIVE" ? `Đã mở khoá ${user.email}` : patch.isSystemAdmin ? `${user.email} giờ là System Admin` : `Đã gỡ quyền System Admin của ${user.email}`,
      );
      await reload();
      await reloadMe();
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  return (
    <>
      <TopBar>
        <h1 className="truncate text-base font-semibold">Người dùng</h1>
      </TopBar>
      <PageBody>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Tabs
            label="Lọc theo trạng thái"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setCursors([undefined]);
            }}
            items={[
              { value: "ALL", label: "Tất cả" },
              { value: "ACTIVE", label: "Đang hoạt động" },
              { value: "DISABLED", label: "Đã khoá" },
            ]}
          />
          <SearchInput label="Tìm người dùng" placeholder="Tìm theo tên hoặc email" value={q} onChange={(e) => setQ(e.target.value)} className="md:ml-auto md:w-72" />
        </div>
        <div className="@container">
          <Card>
            {loading && !data ? (
              <SkeletonRows rows={6} />
            ) : error ? (
              <ErrorBanner error={error} what="danh sách người dùng" onRetry={reload} />
            ) : !data?.items.length ? (
              <EmptyState text={query ? `Không có người dùng nào khớp «${query}».` : "Không có người dùng nào."} action={query ? <Button onClick={() => setQ("")}>Xoá tìm kiếm</Button> : undefined} />
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead className="hidden sm:table-header-group">
                    <tr className="text-left text-xs font-medium text-muted">
                      <th className="h-10 px-4 font-medium sm:pl-5">Người dùng</th>
                      <th className="hidden h-10 w-px px-4 font-medium whitespace-nowrap @2xl:table-cell">Đăng nhập cuối</th>
                      <th className="hidden h-10 w-px px-4 font-medium whitespace-nowrap @3xl:table-cell">Tạo lúc</th>
                      <th className="h-10 w-px px-2 whitespace-nowrap sm:pr-3">
                        <span className="sr-only">Thao tác</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((u) => {
                      const isMe = u.id === me?.id;
                      const disabled = u.status === "DISABLED";
                      return (
                        <tr key={u.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-t border-border px-4 py-2.5 sm:table-row sm:px-0 sm:py-0">
                          <td className="min-w-0 sm:h-16 sm:w-full sm:max-w-0 sm:pr-4 sm:pl-5">
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar name={u.name} src={u.avatarUrl} />
                              <div className="min-w-0">
                                <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                                  <span className={disabled ? "truncate text-muted" : "truncate"}>{u.name}</span>
                                  {isMe ? <span className="shrink-0 text-xs font-normal text-muted">Bạn</span> : null}
                                  {u.isSystemAdmin ? <Badge small tone="primary">System Admin</Badge> : null}
                                  {disabled ? <Badge small tone="err">Đã khoá</Badge> : null}
                                </p>
                                <p className="truncate text-xs text-muted">
                                  {u.email}
                                  <span className="@2xl:hidden"> · {u.lastLoginAt ? formatWhen(u.lastLoginAt) : "Chưa đăng nhập"}</span>
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="hidden px-4 text-sm whitespace-nowrap text-muted tabular-nums @2xl:table-cell">{u.lastLoginAt ? formatWhen(u.lastLoginAt, { withTime: true }) : "—"}</td>
                          <td className="hidden px-4 text-sm whitespace-nowrap text-muted tabular-nums @3xl:table-cell">{formatWhen(u.createdAt)}</td>
                          <td className="whitespace-nowrap sm:w-px sm:px-2 sm:pr-3">
                            <div className="flex justify-end">
                              <RowMenu
                                groups={[
                                  [{ icon: ScrollText, label: "Xem nhật ký của người này", onSelect: () => router.push(`/admin/logs?actorId=${u.id}`) }],
                                  [{ icon: Shield, label: u.isSystemAdmin ? "Gỡ quyền System Admin" : "Cấp quyền System Admin", onSelect: () => setConfirm({ user: u, patch: { isSystemAdmin: !u.isSystemAdmin } }), hidden: isMe }],
                                  [
                                    disabled
                                      ? { icon: LockOpen, label: "Mở khoá tài khoản", onSelect: () => apply(u, { status: "ACTIVE" }), hidden: isMe }
                                      : { icon: Lock, label: "Khoá tài khoản", danger: true, onSelect: () => setConfirm({ user: u, patch: { status: "DISABLED" } }), hidden: isMe },
                                  ],
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 sm:px-5">
                  <p className="text-sm tabular-nums text-muted">
                    {data.items.length} người dùng{cursors.length > 1 || data.nextCursor ? ` · trang ${cursors.length}` : ""}
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
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        danger={confirm?.patch.status === "DISABLED"}
        icon={confirm?.patch.status === "DISABLED" ? Lock : Shield}
        title={confirm?.patch.status === "DISABLED" ? "Khoá tài khoản?" : confirm?.patch.isSystemAdmin ? "Cấp quyền System Admin?" : "Gỡ quyền System Admin?"}
        confirmLabel={confirm?.patch.status === "DISABLED" ? "Khoá tài khoản" : confirm?.patch.isSystemAdmin ? "Cấp quyền" : "Gỡ quyền"}
        onConfirm={async () => {
          if (confirm) await apply(confirm.user, confirm.patch);
        }}
      >
        <span className="font-medium text-foreground [overflow-wrap:anywhere]">{confirm?.user.email}</span>
        {confirm?.patch.status === "DISABLED"
          ? " sẽ bị đăng xuất ngay và không đăng nhập được nữa cho tới khi mở khoá."
          : confirm?.patch.isSystemAdmin
            ? " sẽ vào được trang quản trị: xem mọi người dùng, nhật ký và quản lý mọi workspace."
            : " sẽ không vào được trang quản trị nữa."}
      </ConfirmDialog>
    </>
  );
}
