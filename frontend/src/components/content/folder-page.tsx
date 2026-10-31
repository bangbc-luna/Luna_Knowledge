"use client";

import { Copy, FilePlus2, FolderInput, FolderPlus, Pencil, Share2, Tag as TagIcon, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { docHref } from "@/lib/documents";
import { cn } from "@/lib/cn";
import { DOC_ACCEPT_ATTR, extensionOf, VIDEO_ACCEPT_ATTR, VIDEO_EXTENSIONS } from "@/lib/files";
import { contentRoleOf, roleAtLeast, SECTION_LABEL, sectionPath } from "@/lib/format";
import { useReportSection } from "@/lib/section";
import type { Member, NodeItem, NodeSection, Page } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useUploads } from "@/lib/uploads";
import { invalidateTree } from "@/lib/tree-sync";
import { PageBody, TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/dialog";
import { SearchInput } from "../ui/input";
import type { MenuAction } from "../ui/menu";
import { Breadcrumb, Card, EmptyState, ErrorBanner, SkeletonRows } from "../ui/misc";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast";
import { CopyDialog, MoveDialog, NameDialog, NewDocumentDialog, TagsDialog } from "./node-dialogs";
import { FolderTable } from "./folder-table";
import { RecentUpdates } from "./recent-updates";
import { VideoGrid } from "./video-grid";
import { ShareSheet } from "./share-sheet";

type Sort = "name" | "updatedAt" | "createdAt";
const SORTS = [
  { value: "name" as const, label: "Tên" },
  { value: "updatedAt" as const, label: "Sửa lần cuối" },
  { value: "createdAt" as const, label: "Ngày tạo" },
];

export function FolderPage({ section: routeSection }: { section: NodeSection }) {
  const { wsId, folder } = useParams<{ wsId: string; folder?: string[] }>();
  const folderId = folder?.[0] ?? null;
  const { me } = useAuth();
  const toast = useToast();
  const membership = me?.workspaces.find((w) => w.id === wsId) ?? null;
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [dialog, setDialog] = useState<
    | { kind: "create" }
    | { kind: "rename" | "move" | "copy" | "tags" | "delete" | "share"; node: NodeItem }
    | null
  >(null);

  const router = useRouter();
  const [newDocOpen, setNewDocOpen] = useState(false);

  const current = useApi(
    () => (folderId ? Promise.all([api<NodeItem>(`/nodes/${folderId}`), api<Array<{ id: string; name: string }>>(`/nodes/${folderId}/breadcrumb`)]) : Promise.resolve(null)),
    [folderId],
  );
  const list = useApi(
    () =>
      api<Page<NodeItem>>(`/workspaces/${wsId}/nodes`, {
        query: { parentId: folderId ?? undefined, section: folderId ? undefined : routeSection, sort, order: sort === "name" ? "asc" : "desc", limit: 200 },
      }),
    [wsId, folderId, sort, routeSection],
  );
  const members = useApi(() => api<Member[]>(`/workspaces/${wsId}/members`), [wsId], { enabled: !!membership });
  const memberEmails = useMemo(() => new Set((members.data ?? []).map((m) => m.user.email)), [members.data]);

  const folderNode = current.data?.[0] ?? null;
  const crumbs = current.data?.[1] ?? [];
  const section = folderNode?.section ?? routeSection;
  useReportSection(section);
  const isVideo = section === "VIDEOS";
  const base = `/w/${wsId}/${sectionPath(section)}`;
  const myRole = folderNode?.myRole ?? contentRoleOf(membership?.role);
  const canEdit = roleAtLeast(myRole, "EDITOR");
  const canShare = roleAtLeast(folderNode?.myRole, "OWNER");
  const title = folderNode?.name ?? SECTION_LABEL[section];
  const parents = folderId
    ? [
        ...(membership && (crumbs[0]?.id !== folderId || crumbs.length > 1) ? [{ label: SECTION_LABEL[section], href: base }] : []),
        ...crumbs.slice(0, -1).map((c) => ({ label: c.name, href: `${base}/${c.id}` })),
      ]
    : [];

  const items = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase("vi");
    return (list.data?.items ?? []).filter((n) => !q || n.name.toLocaleLowerCase("vi").includes(q));
  }, [list.data, filter]);

  const patchItem = (id: string, patch: Partial<NodeItem>) =>
    list.setData((d) => (d ? { ...d, items: d.items.map((n) => (n.id === id ? { ...n, ...patch } : n)) } : d));
  const menuFor = (n: NodeItem): MenuAction[][] => {
    const rowOwner = roleAtLeast(n.myRole, "OWNER");
    const rowEdit = roleAtLeast(n.myRole, "EDITOR");
    return [
      [
        { icon: Pencil, label: "Đổi tên", onSelect: () => setDialog({ kind: "rename", node: n }), hidden: !rowEdit },
        { icon: FolderInput, label: "Di chuyển", onSelect: () => setDialog({ kind: "move", node: n }), hidden: !rowEdit },
        { icon: Copy, label: "Tạo bản sao", onSelect: () => setDialog({ kind: "copy", node: n }), hidden: n.type !== "DOCUMENT" },
        { icon: Share2, label: "Chia sẻ", onSelect: () => setDialog({ kind: "share", node: n }), hidden: !rowOwner },
        { icon: TagIcon, label: "Gắn tag", onSelect: () => setDialog({ kind: "tags", node: n }), hidden: !rowEdit || !membership },
      ],
      [{ icon: Trash2, label: "Xoá vào thùng rác", danger: true, onSelect: () => setDialog({ kind: "delete", node: n }), hidden: !rowEdit }],
    ];
  };
  const onFavorite = (id: string, fav: boolean) => patchItem(id, { isFavorite: fav });
  const reloadAll = () => {
    invalidateTree(wsId);
    void list.reload();
    if (folderId) void current.reload();
  };
  const changed = (extraParents: Array<string | null> = []) => {
    invalidateTree(wsId, [folderId, ...extraParents]);
    void list.reload();
    if (folderId) void current.reload();
  };

  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const uploadTick = uploads.doneTick(wsId, folderId);
  const reloadList = list.reload;
  useEffect(() => {
    if (!uploadTick) return;
    void reloadList();
    invalidateTree(wsId, [folderId]);
  }, [uploadTick, reloadList, wsId, folderId]);
  const pending = (list.data?.items ?? []).some((n) => n.status === "PROCESSING" || n.status === "UPLOADING");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void reloadList(), 4000);
    return () => clearInterval(timer);
  }, [pending, reloadList]);
  const startUpload = (files: FileList | null) => {
    if (!files?.length) return;
    const all = Array.from(files);
    const fits = all.filter((f) => VIDEO_EXTENSIONS.includes(extensionOf(f.name)) === isVideo);
    const skipped = all.length - fits.length;
    if (skipped) toast("error", isVideo ? `Bỏ qua ${skipped} tệp không phải video. Tệp tài liệu tải lên ở mục Tài liệu.` : `Bỏ qua ${skipped} video. Video tải lên ở mục Video.`);
    if (fits.length) uploads.add(fits, { wsId, parentId: folderId });
  };
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const dropProps = canEdit
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (hasFiles(e)) e.preventDefault();
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          startUpload(e.dataTransfer.files);
        },
      }
    : {};

  const loadError = current.error ?? list.error;
  const loading = current.loading || list.loading;
  const showList = !(loading && !list.data) && !loadError && items.length > 0;
  const notMemberAtRoot = !folderId && !membership;
  const showRecent = !folderId && !!membership;

  return (
    <>
      <TopBar>
        <div className="flex min-w-0 items-center gap-1">
          {parents.length ? (
            <div className="hidden min-w-0 shrink-[2] items-center gap-1 md:flex">
              <Breadcrumb items={parents} tail={1} />
              <span className="shrink-0 text-muted" aria-hidden>
                ›
              </span>
            </div>
          ) : null}
          <h1 className="min-w-24 truncate text-base font-semibold">{title}</h1>
        </div>
      </TopBar>
      <PageBody>
        {notMemberAtRoot ? (
          <Card>
            <EmptyState
              text="Bạn không phải thành viên workspace này. Các mục được chia sẻ cho bạn nằm ở Được chia sẻ."
              action={
                <Link href="/shared" className="inline-flex min-h-10 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-button-hover">
                  Mở Được chia sẻ
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput label="Lọc theo tên" placeholder="Lọc theo tên trong thư mục này" value={filter} onChange={(e) => setFilter(e.target.value)} className="flex-1 sm:max-w-80 sm:[&_input]:h-9" />
              <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex sm:flex-nowrap sm:items-center">
                <Select prefix="Sắp xếp:" value={sort} options={SORTS} onChange={setSort} className="order-first col-span-2 w-full sm:order-none sm:w-fit sm:[&>button]:h-9 max-xl:sm:[&>button>span.text-muted]:hidden" />
                {folderNode && canShare ? (
                  <Button icon={Share2} title="Chia sẻ" className="col-span-2 sm:h-9 sm:min-h-9 sm:px-2.5 sm:py-0 xl:px-4" onClick={() => setDialog({ kind: "share", node: folderNode })}>
                    <span className="sm:sr-only xl:not-sr-only">Chia sẻ</span>
                  </Button>
                ) : null}
                {canEdit ? (
                  <>
                    {isVideo ? null : (
                      <Button icon={FilePlus2} title="Tài liệu mới" className="sm:h-9 sm:min-h-9 sm:px-2.5 sm:py-0 xl:px-4" onClick={() => setNewDocOpen(true)}>
                        <span className="sm:sr-only xl:not-sr-only">Tài liệu mới</span>
                      </Button>
                    )}
                    <Button icon={FolderPlus} title="Thư mục mới" className={cn("sm:h-9 sm:min-h-9 sm:px-2.5 sm:py-0 xl:px-4", isVideo && "col-span-2")} onClick={() => setDialog({ kind: "create" })}>
                      <span className="sm:sr-only xl:not-sr-only">Thư mục mới</span>
                    </Button>
                    <Button icon={Upload} variant="primary" className="order-first col-span-2 sm:order-none sm:h-9 sm:min-h-9 sm:py-0" onClick={() => fileInput.current?.click()}>
                      {isVideo ? "Tải video lên" : "Tải lên"}
                    </Button>
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      accept={isVideo ? VIDEO_ACCEPT_ATTR : DOC_ACCEPT_ATTR}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => {
                        startUpload(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </>
                ) : null}
              </div>
            </div>
            <div className={cn(showRecent && "flex flex-col gap-3", showRecent && !isVideo && "xl:flex-row xl:items-start xl:gap-6")}>
              <div className="relative min-w-0 flex-1 @container" {...dropProps}>
                {dragging ? (
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-foreground/40 bg-background text-center">
                    <Upload className="size-5 text-muted" aria-hidden />
                    <p className="mt-2 text-sm font-medium text-foreground">{isVideo ? "Thả video để tải lên" : "Thả tệp để tải lên"}</p>
                    <p className="mt-1 max-w-[40ch] truncate text-sm text-muted">vào «{title}»</p>
                  </div>
                ) : null}
                <div className={cn(!showList && "rounded-2xl border border-border bg-surface")}>
                  {loading && !list.data ? (
                    <SkeletonRows rows={6} />
                  ) : loadError ? (
                    <ErrorBanner error={loadError} what="thư mục" onRetry={reloadAll} />
                  ) : !items.length ? (
                    <EmptyState
                      text={
                        filter ? (
                          `Không có mục nào khớp «${filter}».`
                        ) : canEdit ? (
                          <>
                            {folderId ? "Thư mục này chưa có gì." : isVideo ? "Chưa có video nào." : "Chưa có tài liệu nào."}
                            <span className="[@media(hover:none)]:hidden">{isVideo ? " Kéo thả video vào đây để tải lên." : " Kéo thả tệp vào đây để tải lên."}</span>
                          </>
                        ) : folderId ? (
                          "Thư mục này chưa có gì."
                        ) : isVideo ? (
                          "Chưa có video nào."
                        ) : (
                          "Chưa có tài liệu nào."
                        )
                      }
                      action={
                        filter ? (
                          <Button onClick={() => setFilter("")}>Xoá lọc</Button>
                        ) : canEdit ? (
                          <div className="flex flex-wrap justify-center gap-2">
                            <Button icon={Upload} onClick={() => fileInput.current?.click()}>
                              {isVideo ? "Tải video lên" : "Tải tệp lên"}
                            </Button>
                            {isVideo ? null : (
                              <Button icon={FilePlus2} onClick={() => setNewDocOpen(true)}>
                                Tạo tài liệu
                              </Button>
                            )}
                            <Button icon={FolderPlus} onClick={() => setDialog({ kind: "create" })}>
                              Tạo thư mục
                            </Button>
                          </div>
                        ) : undefined
                      }
                    />
                  ) : (
                    <>
                      {isVideo ? <VideoGrid items={items} menuFor={menuFor} onFavorite={onFavorite} /> : <FolderTable items={items} menuFor={menuFor} onFavorite={onFavorite} />}
                      <p className="py-2 text-sm tabular-nums text-muted sm:px-3">
                        {items.length} mục
                        {filter ? ` khớp «${filter}»` : ""}
                        {list.data?.nextCursor ? " · đang hiện 200 mục đầu" : ""}
                      </p>
                    </>
                  )}
                </div>
              </div>
              {showRecent ? (
                <RecentUpdates
                  key={`${wsId}:${section}`}
                  wsId={wsId}
                  section={section}
                  className={cn("border-t border-border pt-3", !isVideo && "xl:w-[22rem] xl:shrink-0 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6")}
                />
              ) : null}
            </div>
          </>
        )}
      </PageBody>

      <NewDocumentDialog
        open={newDocOpen}
        onClose={() => setNewDocOpen(false)}
        workspaceId={wsId}
        parentId={folderId}
        onCreated={(doc, named) => {
          invalidateTree(wsId, [folderId]);
          router.push(`${docHref(wsId, doc.node.id)}${named ? "" : "?new=1"}`);
        }}
      />
      <NameDialog
        open={dialog?.kind === "create"}
        onClose={() => setDialog(null)}
        title="Thư mục mới"
        submitLabel="Tạo thư mục"
        onSubmit={async (name) => {
          await api(`/workspaces/${wsId}/folders`, { method: "POST", body: { name, parentId: folderId, section } });
          toast("success", `Đã tạo thư mục «${name}»`);
          changed();
        }}
      />
      <NameDialog
        open={dialog?.kind === "rename"}
        onClose={() => setDialog(null)}
        title="Đổi tên"
        submitLabel="Lưu"
        initial={dialog && "node" in dialog ? dialog.node.name : ""}
        onSubmit={async (name) => {
          if (!dialog || !("node" in dialog)) return;
          await api(`/nodes/${dialog.node.id}`, { method: "PATCH", body: { name } });
          toast("success", "Đã đổi tên");
          changed();
        }}
      />
      <MoveDialog
        open={dialog?.kind === "move"}
        onClose={() => setDialog(null)}
        node={dialog?.kind === "move" ? dialog.node : null}
        workspaceId={wsId}
        canUseRoot={!!membership && membership.role !== "VIEWER"}
        section={section}
        onMoved={(targetParentId) => {
          toast("success", "Đã di chuyển");
          changed([targetParentId]);
        }}
      />
      <CopyDialog
        open={dialog?.kind === "copy"}
        onClose={() => setDialog(null)}
        source={dialog?.kind === "copy" ? { id: dialog.node.id, name: dialog.node.name, workspaceId: wsId, parentId: dialog.node.parentId, parentName: folderNode?.name ?? null } : null}
      />
      <TagsDialog
        open={dialog?.kind === "tags"}
        onClose={() => setDialog(null)}
        node={dialog?.kind === "tags" ? dialog.node : null}
        workspaceId={wsId}
        onSaved={() => {
          toast("success", "Đã cập nhật tag");
          void list.reload();
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onClose={() => setDialog(null)}
        title="Xoá vào thùng rác?"
        confirmLabel="Xoá"
        onConfirm={async () => {
          if (dialog?.kind !== "delete") return;
          try {
            await api(`/nodes/${dialog.node.id}`, { method: "DELETE" });
            toast("success", `Đã chuyển «${dialog.node.name}» vào thùng rác`);
            changed();
          } catch (err) {
            toast("error", describeError(err));
          }
        }}
      >
        <span className="font-medium text-foreground">{dialog?.kind === "delete" ? dialog.node.name : ""}</span>
        {dialog?.kind === "delete" && dialog.node.type === "FOLDER" ? " cùng mọi mục bên trong" : ""} sẽ vào thùng rác. Khôi phục được trong 30 ngày.
      </ConfirmDialog>
      <ShareSheet node={dialog?.kind === "share" ? dialog.node : null} onClose={() => setDialog(null)} memberEmails={memberEmails} />
    </>
  );
}
