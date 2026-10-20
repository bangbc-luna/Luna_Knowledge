"use client";

import { CircleAlert, Download, History, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { ACCEPT_ATTR, fileKindLabel, formatBytes } from "@/lib/files";
import { formatWhen, roleAtLeast } from "@/lib/format";
import { subscribeSse } from "@/lib/sse";
import type { FileDetail, NodeEvent } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useUploads } from "@/lib/uploads";
import { NodeIcon, TagChip } from "../content/node-name";
import { PageBody, TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { Avatar, Breadcrumb, Card, ErrorBanner } from "../ui/misc";
import { useToast } from "../ui/toast";
import { FilePreviewPane } from "./file-preview";
import { VersionsSheet } from "./versions-sheet";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:items-baseline @sm:gap-6">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Trang xem tệp: đầu trang (tên + nút), vùng xem trước bên trái, thông tin tệp bên phải (khung ≥ 70rem). */
export function FilePage() {
  const { wsId, nodeId } = useParams<{ wsId: string; nodeId: string }>();
  const router = useRouter();
  const { me } = useAuth();
  const toast = useToast();
  const uploads = useUploads();
  const membership = me?.workspaces.find((w) => w.id === wsId) ?? null;
  const [versionsOpen, setVersionsOpen] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);

  const detail = useApi(() => api<FileDetail>(`/files/${nodeId}`), [nodeId]);
  const crumbs = useApi(() => api<Array<{ id: string; name: string }>>(`/nodes/${nodeId}/breadcrumb`), [nodeId]);

  // Trạng thái xử lý đổi (worker xong, phiên bản mới) thì tải lại chi tiết.
  const status = detail.data?.node.status;
  const currentId = detail.data?.currentVersion?.id;
  const statusRef = useRef({ status, currentId });
  useEffect(() => {
    statusRef.current = { status, currentId };
  }, [status, currentId]);
  const reloadDetail = detail.reload;
  useEffect(
    () =>
      subscribeSse<NodeEvent>(`/nodes/${nodeId}/events`, (type, e) => {
        if (type !== "status") return;
        const cur = statusRef.current;
        if (cur.status && (e.status !== cur.status || (e.versionId && e.versionId !== cur.currentId))) void reloadDetail();
      }),
    [nodeId, reloadDetail],
  );

  const d = detail.data;
  const node = d?.node;
  const v = d?.currentVersion ?? null;
  const canEdit = roleAtLeast(node?.myRole, "EDITOR");
  const busy = node?.status === "UPLOADING" || node?.status === "PROCESSING";
  const canDownload = !!d?.canDownload && !!v;

  const path = crumbs.data ?? [];
  // Thành viên luôn thấy gốc workspace; người chỉ được share thấy từ folder được share trở xuống.
  const parents = [
    ...(membership && path.length ? [{ label: membership.name, href: `/w/${wsId}/f` }] : []),
    ...path.slice(0, -1).map((c) => ({ label: c.name, href: `/w/${wsId}/f/${c.id}` })),
  ];

  const download = async (versionId?: string) => {
    try {
      const link = await api<{ url: string }>(`/files/${nodeId}/download-link`, { method: "POST", query: { version: versionId } });
      window.location.assign(link.url);
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  const notFound = detail.error instanceof ApiError && detail.error.status === 404;

  return (
    <>
      <TopBar>
        {parents.length ? (
          <>
            <Breadcrumb items={parents} className="hidden md:flex" />
            <Breadcrumb items={parents.slice(-1)} className="md:hidden" />
          </>
        ) : (
          <p className="text-sm text-muted">{notFound ? "Không tìm thấy tệp" : ""}</p>
        )}
      </TopBar>
      <PageBody>
        {notFound ? (
          <div className="flex flex-col items-center px-4 py-20 text-center">
            <p className="text-sm font-medium text-muted tabular-nums">404</p>
            <h1 className="mt-2 text-xl font-semibold text-balance">Không tìm thấy tệp</h1>
            <p className="mt-2 max-w-[48ch] text-sm text-pretty text-muted">Tệp có thể đã bị xoá, hoặc bạn không có quyền xem.</p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link href={membership ? `/w/${wsId}/f` : "/shared"} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
                {membership ? "Về thư mục gốc" : "Về Được chia sẻ"}
              </Link>
              <Button variant="ghost" onClick={() => router.back()}>
                Quay lại trang trước
              </Button>
            </div>
          </div>
        ) : detail.error ? (
          <Card>
            <ErrorBanner error={detail.error} what="tệp" onRetry={() => void detail.reload()} />
          </Card>
        ) : !d || !node ? (
          <div aria-busy="true" aria-label="Đang tải" className="space-y-4">
            <div className="h-14 w-2/3 animate-pulse rounded-xl bg-foreground/5" />
            <div className="h-[28rem] animate-pulse rounded-2xl bg-foreground/5" />
          </div>
        ) : (
          <>
            {/* Đầu trang: tên <h1> + dòng tóm tắt, nút bên phải (xuống dưới ở màn hẹp) */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <NodeIcon node={node} />
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg font-semibold text-balance [overflow-wrap:anywhere]">{node.name}</h1>
                  <p className="mt-0.5 text-sm text-muted tabular-nums">
                    {node.type === "VIDEO" ? "Video" : fileKindLabel(v?.fileName ?? node.name, v?.mime)}
                    {v ? ` · ${formatBytes(v.size)} · Phiên bản ${v.versionNo} · ${formatWhen(v.createdAt)}` : ""}
                  </p>
                </div>
              </div>
              {(() => {
                const secondary = [
                  d.versionCount > 0 ? (
                    <Button key="history" icon={History} onClick={() => setVersionsOpen(true)}>
                      Phiên bản
                      <span className="text-muted tabular-nums">{d.versionCount}</span>
                    </Button>
                  ) : null,
                  canEdit && node.type === "FILE" ? (
                    <Button key="replace" icon={Upload} loading={busy} onClick={() => replaceInput.current?.click()}>
                      Tải bản mới
                    </Button>
                  ) : null,
                ].filter(Boolean);
                const primary = canDownload ? (
                  <Button key="download" icon={Download} variant="primary" onClick={() => void download()} className={cn("order-first col-span-2 sm:order-none")}>
                    Tải về
                  </Button>
                ) : null;
                if (!secondary.length && !primary) return null;
                return (
                  <div className={cn("grid gap-2 sm:flex sm:shrink-0 sm:flex-wrap", secondary.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
                    {secondary}
                    {primary}
                  </div>
                );
              })()}
              <input
                ref={replaceInput}
                type="file"
                accept={ACCEPT_ATTR}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  if (e.target.files?.length) uploads.add(e.target.files, { wsId, parentId: node.parentId, replaceNodeId: node.id });
                  e.target.value = "";
                }}
              />
            </div>

            {node.status === "READY" && d.processingError ? (
              <div role="status" className="flex items-start gap-3 rounded-xl border border-border-strong bg-warn-bg p-4">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                <p className="min-w-0 text-sm text-pretty text-foreground [overflow-wrap:anywhere]">
                  <span className="font-medium">Lần xử lý gần nhất có lỗi.</span> {d.processingError}
                </p>
              </div>
            ) : null}

            <div className="@container">
              <div className="grid items-start gap-4 @[70rem]:grid-cols-[minmax(0,1fr)_22rem]">
                <Card className="overflow-hidden">
                  <FilePreviewPane detail={d} onDownload={canDownload ? () => void download() : undefined} onReplace={canEdit ? () => replaceInput.current?.click() : undefined} />
                </Card>
                <Card className="p-5">
                  <h2 className="text-sm font-semibold">Thông tin</h2>
                  <dl className="@container mt-4 space-y-3 text-sm">
                    <Row label="Loại">{node.type === "VIDEO" ? "Video" : fileKindLabel(v?.fileName ?? node.name, v?.mime)}</Row>
                    <Row label="Kích thước">{v ? <span className="tabular-nums">{formatBytes(v.size)}</span> : <span className="font-normal text-muted">—</span>}</Row>
                    {v && v.fileName !== node.name ? <Row label="Tên tệp gốc">{v.fileName}</Row> : null}
                    <Row label="Tải lên bởi">
                      {v ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={v.uploadedBy.name} src={v.uploadedBy.avatarUrl} size="size-5" />
                          <span className="truncate">{v.uploadedBy.name}</span>
                        </span>
                      ) : (
                        <span className="font-normal text-muted">—</span>
                      )}
                    </Row>
                    <Row label="Tải lên lúc">{v ? <span className="tabular-nums">{formatWhen(v.createdAt, { withTime: true })}</span> : <span className="font-normal text-muted">—</span>}</Row>
                    <Row label="Người tạo">{node.createdBy.name}</Row>
                    <Row label="Tag">
                      {node.tags.length ? (
                        <span className="flex flex-wrap gap-1.5">
                          {node.tags.map((t) => (
                            <TagChip key={t.id} tag={t} />
                          ))}
                        </span>
                      ) : (
                        <span className="font-normal text-muted">—</span>
                      )}
                    </Row>
                  </dl>
                </Card>
              </div>
            </div>

            <VersionsSheet
              node={node}
              open={versionsOpen}
              onClose={() => setVersionsOpen(false)}
              canRestore={canEdit && !busy}
              canDownload={d.canDownload}
              onDownload={(id) => void download(id)}
              onRestored={() => void detail.reload()}
            />
          </>
        )}
      </PageBody>
    </>
  );
}
