"use client";

import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Activity, Bold, CircleAlert, Download, Eye, History, Italic, Link2, MessageSquare, MessageSquarePlus, Share2, Tag as TagIcon, WifiOff } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, describeError, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { type DocAsset, type DocThread, type DocumentDetail, uploadAsset } from "@/lib/documents";
import { formatWhen, roleAtLeast } from "@/lib/format";
import type { Member, NodeItem, UserSummary } from "@/lib/types";
import { useReportSection } from "@/lib/section";
import { useApi } from "@/lib/use-api";
import { ActivitySheet } from "../content/activity-sheet";
import { TagsDialog } from "../content/node-dialogs";
import { ShareSheet } from "../content/share-sheet";
import { TopBar } from "../shell/shell";
import { Button } from "../ui/button";
import { Dialog, Sheet } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { RowMenu } from "../ui/menu";
import { Avatar, Badge, Breadcrumb, Card, ErrorBanner } from "../ui/misc";
import { useToast } from "../ui/toast";
import { CommentsPanel, type ThreadFilter } from "./comments-panel";
import { DocVersionsSheet } from "./doc-versions-sheet";
import { EditorToolbar, ToolButton } from "./editor-toolbar";
import { buildExtensions } from "./extensions";
import { rememberAssets, setAssetDocument } from "./image-view";
import { InlineTitle } from "./inline-title";
import { type CollabSession, type Peer, useCollab } from "./use-collab";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const UUID = /^[0-9a-f-]{36}$/i;

function Presence({ peers }: { peers: Peer[] }) {
  if (!peers.length) return null;
  const shown = peers.slice(0, 4);
  return (
    <div className="flex shrink-0 items-center" aria-label={`Đang mở cùng: ${peers.map((p) => p.name).join(", ")}`}>
      {shown.map((p, i) => (
        <span key={p.id} title={p.name} className={cn("rounded-full ring-2 ring-surface", i && "-ml-2")} style={{ boxShadow: `0 0 0 2px var(--surface), 0 0 0 4px ${p.color}` }}>
          <Avatar name={p.name} size="size-7" />
        </span>
      ))}
      {peers.length > shown.length ? <span className="ml-1.5 text-xs text-muted tabular-nums">+{peers.length - shown.length}</span> : null}
    </div>
  );
}

function SaveState({ status, synced, unsynced, readOnly }: { status: string; synced: boolean; unsynced: number; readOnly: boolean }) {
  if (status === "offline")
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-warn">
        <WifiOff className="size-3.5" aria-hidden />
        Mất kết nối, đang thử lại
      </span>
    );
  if (status === "connecting" || !synced) return <span className="text-xs text-muted">Đang kết nối…</span>;
  if (readOnly) return null;
  return <span role="status" className="text-xs text-muted">{unsynced > 0 ? "Đang lưu…" : "Đã lưu"}</span>;
}

function LinkDialog({ editor, open, onClose }: { editor: Editor | null; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(open);
  const hasLink = !!editor?.isActive("link");
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setUrl((editor?.getAttributes("link").href as string | undefined) ?? "");
      setError(null);
    }
  }
  const apply = () => {
    if (!editor) return;
    let href = url.trim();
    if (!href) return setError("Nhập địa chỉ link");
    if (!/^(https?:|mailto:)/i.test(href)) href = `https://${href}`;
    try {
      new URL(href);
    } catch {
      return setError("Địa chỉ không hợp lệ");
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !hasLink) chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={hasLink ? "Sửa link" : "Chèn link"}
      onSubmit={apply}
      footer={
        <>
          {hasLink ? (
            <Button
              variant="secondary"
              className="sm:mr-auto"
              onClick={() => {
                editor?.chain().focus().extendMarkRange("link").unsetLink().run();
                onClose();
              }}
            >
              Gỡ link
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="primary" type="submit">
            {hasLink ? "Lưu" : "Chèn link"}
          </Button>
        </>
      }
    >
      <Field label="Địa chỉ" error={error}>
        {(id) => <Input id={id} autoFocus inputMode="url" placeholder="https://" value={url} invalid={!!error} onChange={(e) => (setUrl(e.target.value), setError(null))} />}
      </Field>
    </Dialog>
  );
}

function findRange(editor: Editor, from: number, to: number, quoted: string) {
  const size = editor.state.doc.content.size;
  if (to <= size && editor.state.doc.textBetween(from, to, "\n") === quoted) return { from, to };
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return !found;
    const i = node.text.indexOf(quoted);
    if (i >= 0) found = { from: pos + i, to: pos + i + quoted.length };
    return false;
  });
  return found;
}

function removeCommentMark(editor: Editor, threadId: string) {
  const type = editor.schema.marks.comment;
  if (!type) return;
  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) if (m.type === type && m.attrs.threadId === threadId) tr.removeMark(pos, pos + node.nodeSize, m);
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

function DocEditor({
  session,
  editable,
  onReady,
  onCommentClick,
  onAddComment,
  onLink,
  onImage,
}: {
  session: CollabSession;
  editable: boolean;
  onReady: (e: Editor | null) => void;
  onCommentClick: (threadId: string) => void;
  onAddComment: () => void;
  onLink: () => void;
  onImage: (files: File[]) => void;
}) {
  const handlers = useRef({ onCommentClick, onAddComment, onLink, onImage });
  useEffect(() => {
    handlers.current = { onCommentClick, onAddComment, onLink, onImage };
  });
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: buildExtensions({ ydoc: session.ydoc, provider: session.provider, user: session.user }),
      editorProps: {
        attributes: { class: "luna-prose luna-editor", "aria-label": "Nội dung tài liệu", spellcheck: "false" },
        handleKeyDown: (_view, event) => {
          const mod = event.metaKey || event.ctrlKey;
          if (mod && !event.shiftKey && event.key.toLowerCase() === "k") {
            event.preventDefault();
            handlers.current.onLink();
            return true;
          }
          if (mod && event.altKey && (event.key.toLowerCase() === "m" || event.code === "KeyM")) {
            event.preventDefault();
            handlers.current.onAddComment();
            return true;
          }
          return false;
        },
        handleClick: (_view, _pos, event) => {
          const el = (event.target as HTMLElement).closest("[data-thread-id]");
          const id = el?.getAttribute("data-thread-id");
          if (id) handlers.current.onCommentClick(id);
          return false;
        },
        handlePaste: (_view, event) => {
          const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
          if (!files.length) return false;
          handlers.current.onImage(files);
          return true;
        },
        handleDrop: (_view, event) => {
          const files = [...((event as DragEvent).dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
          if (!files.length) return false;
          event.preventDefault();
          handlers.current.onImage(files);
          return true;
        },
      },
    },
    [session],
  );
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  useEffect(() => {
    onReady(editor);
    return () => onReady(null);
  }, [editor, onReady]);
  const bubble = useEditorState({ editor, selector: ({ editor: e }) => ({ bold: !!e?.isActive("bold"), italic: !!e?.isActive("italic"), link: !!e?.isActive("link") }) });

  if (!editor) return <div className="h-[50vh] animate-pulse rounded-xl bg-foreground/5" aria-busy="true" aria-label="Đang tải" />;
  return (
    <>
      <BubbleMenu editor={editor} shouldShow={({ state, editor: e }) => !state.selection.empty && !e.isActive("image") && !e.isActive("codeBlock")} options={{ placement: "top" }}>
        <div className="flex items-center gap-0.5 rounded-xl border border-border bg-surface-overlay p-1 shadow-popover">
          {editable ? (
            <>
              <ToolButton icon={Bold} label="In đậm" active={bubble?.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
              <ToolButton icon={Italic} label="In nghiêng" active={bubble?.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
              <ToolButton icon={Link2} label="Chèn link" active={bubble?.link} onClick={onLink} />
              <span className="mx-1 h-5 w-px bg-border-strong" aria-hidden />
            </>
          ) : null}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onAddComment}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-foreground outline-hidden hover:bg-foreground/8"
          >
            <MessageSquarePlus className="size-4" aria-hidden />
            Bình luận
          </button>
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  );
}

export function DocumentPage() {
  const { wsId, nodeId } = useParams<{ wsId: string; nodeId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { me } = useAuth();
  const toast = useToast();
  const membership = me?.workspaces.find((w) => w.id === wsId) ?? null;

  const detail = useApi(() => api<DocumentDetail>(`/documents/${nodeId}`), [nodeId]);
  const crumbs = useApi(() => api<Array<{ id: string; name: string }>>(`/nodes/${nodeId}/breadcrumb`), [nodeId]);
  const members = useApi(() => api<Member[]>(`/workspaces/${wsId}/members`), [wsId], { enabled: !!membership });
  const threadsApi = useApi(() => api<DocThread[]>(`/documents/${nodeId}/threads`, { query: { status: "ALL" } }), [nodeId]);
  const collab = useCollab(nodeId);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [filter, setFilter] = useState<ThreadFilter>("OPEN");
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ quotedText: string; from: number; to: number } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  useReportSection("DOCS");
  const [wide, setWide] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const mq = matchMedia("(min-width: 80rem)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setAssetDocument(nodeId);
    api<DocAsset[]>(`/documents/${nodeId}/assets`)
      .then(rememberAssets)
      .catch(() => undefined);
  }, [nodeId]);

  const reloadThreads = threadsApi.reload;
  useEffect(() => {
    const onFocus = () => void reloadThreads();
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => document.visibilityState === "visible" && void reloadThreads(), 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [reloadThreads]);

  const threadParam = search.get("thread");
  const [handledThread, setHandledThread] = useState<string | null>(null);
  if (threadParam && threadParam !== handledThread && threadsApi.data) {
    setHandledThread(threadParam);
    const t = threadsApi.data.find((x) => x.id === threadParam);
    if (t) {
      setCommentsOpen(true);
      setFilter(t.status);
      setActiveThread(t.id);
    }
  }

  const d = detail.data;
  const node = d?.node;
  const session = collab.session;
  const readOnly = session?.readOnly ?? d?.readOnly ?? true;
  const editable = !readOnly && collab.status !== "denied";
  const canShare = roleAtLeast(node?.myRole, "OWNER");
  const people: UserSummary[] = useMemo(() => (members.data ?? []).map((m) => m.user), [members.data]);
  const memberEmails = useMemo(() => new Set(people.map((p) => p.email)), [people]);
  const docOrder = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const order: string[] = [];
      e?.state.doc.descendants((n) => {
        for (const m of n.marks) if (m.type.name === "comment" && m.attrs.threadId && !order.includes(m.attrs.threadId as string)) order.push(m.attrs.threadId as string);
      });
      return order.join(",");
    },
  });
  const threads = useMemo(() => {
    const list = threadsApi.data;
    if (!list) return null;
    const order = (docOrder ?? "").split(",");
    const rank = (id: string) => {
      const i = order.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...list].sort((a, b) => rank(a.id) - rank(b.id) || a.createdAt.localeCompare(b.createdAt));
  }, [threadsApi.data, docOrder]);
  const openCount = threads?.filter((t) => t.status === "OPEN").length ?? 0;

  const commentStyle = useMemo(() => {
    const open = (threads ?? []).filter((t) => t.status === "OPEN" && UUID.test(t.id)).map((t) => t.id);
    const rules = open.map((id) => `.luna-editor .luna-comment[data-thread-id="${id}"]{background:var(--comment-bg);border-bottom:2px solid var(--comment-line);cursor:pointer}`);
    if (activeThread && UUID.test(activeThread)) rules.push(`.luna-editor .luna-comment[data-thread-id="${activeThread}"]{background:var(--comment-bg-active)}`);
    return rules.join("\n");
  }, [threads, activeThread]);

  const path = crumbs.data ?? [];
  const parents = [
    ...(membership && path.length ? [{ label: "Tài liệu", href: `/w/${wsId}/f` }] : []),
    ...path.slice(0, -1).map((c) => ({ label: c.name, href: `/w/${wsId}/f/${c.id}` })),
  ];

  const startComment = () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const quotedText = editor.state.doc.textBetween(from, to, " ").slice(0, 500);
    setDraft({ quotedText, from, to });
    setFilter("OPEN");
    setActiveThread(null);
    setCommentsOpen(true);
  };

  const selectThread = (id: string, scrollDoc: boolean) => {
    setActiveThread(id);
    if (scrollDoc) {
      const el = editor?.view.dom.querySelector(`[data-thread-id="${id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setCommentsOpen(true);
      const t = threads?.find((x) => x.id === id);
      if (t) setFilter(t.status);
      requestAnimationFrame(() => document.querySelector(`[data-thread="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    }
  };

  const upsertThread = (t: DocThread) => threadsApi.setData((list) => (list ? (list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]) : [t]));

  const insertImages = async (files: File[]) => {
    if (!editor || !editable) return;
    for (const f of files) {
      try {
        const asset = await uploadAsset(nodeId, f);
        rememberAssets([asset]);
        editor.chain().focus().insertContent({ type: "image", attrs: { src: asset.url, alt: asset.fileName, assetId: asset.id } }).run();
      } catch (err) {
        toast("error", `${f.name}: ${describeError(err)}`);
      }
    }
  };

  const exportAs = async (format: "html" | "md") => {
    try {
      await downloadFile(`/documents/${nodeId}/export`, { format }, `${node?.name ?? "tai-lieu"}.${format}`);
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  const notFound = (detail.error instanceof ApiError && detail.error.status === 404) || collab.status === "denied";
  const collabFailed = !!collab.error && !notFound;

  const panel = (
    <CommentsPanel
      threads={threads}
      error={threadsApi.error}
      loading={threadsApi.loading}
      filter={filter}
      onFilter={setFilter}
      activeId={activeThread}
      people={people}
      meId={me?.id ?? ""}
      draft={draft}
      onDraftCancel={() => setDraft(null)}
      onDraftSubmit={async (body, mentions) => {
        if (!draft) return;
        try {
          const t = await api<DocThread>(`/documents/${nodeId}/threads`, { method: "POST", body: { quotedText: draft.quotedText, body, mentions } });
          if (editor && editable) {
            const range = findRange(editor, draft.from, draft.to, draft.quotedText);
            if (range) editor.chain().setTextSelection(range).setMark("comment", { threadId: t.id }).setTextSelection(range.to).run();
          }
          upsertThread(t);
          setDraft(null);
          setActiveThread(t.id);
          if (t.ignoredMentions?.length) toast("error", "Có người được nhắc không xem được tài liệu này nên sẽ không nhận thông báo");
        } catch (err) {
          toast("error", describeError(err));
        }
      }}
      onSelect={(id) => selectThread(id, true)}
      onChanged={upsertThread}
      onRemoved={(id) => {
        threadsApi.setData((list) => list?.filter((x) => x.id !== id) ?? null);
        if (editor && editable) removeCommentMark(editor, id);
      }}
      onReload={() => void threadsApi.reload()}
    />
  );

  return (
    <>
      <style>{commentStyle}</style>
      <TopBar>
        {parents.length ? (
          <>
            <Breadcrumb items={parents} className="hidden md:flex" />
            <Breadcrumb items={parents.slice(-1)} className="md:hidden" />
          </>
        ) : (
          <p className="text-sm text-muted">{notFound ? "Không tìm thấy tài liệu" : ""}</p>
        )}
      </TopBar>

      {notFound ? (
        <div className="flex flex-col items-center px-4 py-20 text-center">
          <p className="text-sm font-medium text-muted tabular-nums">404</p>
          <h1 className="mt-2 text-xl font-semibold text-balance">Không tìm thấy tài liệu</h1>
          <p className="mt-2 max-w-[48ch] text-sm text-pretty text-muted">Tài liệu có thể đã bị xoá, hoặc bạn không còn quyền xem.</p>
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
        <div className="px-4 py-5 sm:px-6">
          <Card>
            <ErrorBanner error={detail.error} what="tài liệu" onRetry={() => void detail.reload()} />
          </Card>
        </div>
      ) : !d || !node ? (
        <div aria-busy="true" aria-label="Đang tải" className="mx-auto w-full max-w-[52rem] space-y-4 px-4 py-6 sm:px-6">
          <div className="h-10 w-2/3 animate-pulse rounded-xl bg-foreground/5" />
          <div className="h-[60vh] animate-pulse rounded-2xl bg-foreground/5" />
        </div>
      ) : (
        <>
          {editable && editor ? (
            <div className="sticky top-16 z-20 border-b border-border bg-surface px-2 py-1.5 sm:px-4">
              <div className="mx-auto max-w-[52rem]">
                <EditorToolbar editor={editor} canComment onLink={() => setLinkOpen(true)} onImage={() => imageInput.current?.click()} onComment={startComment} />
              </div>
            </div>
          ) : null}

          <div className="flex flex-1 justify-center gap-6 px-4 py-6 sm:px-6">
            <main className="w-full max-w-[52rem] min-w-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <InlineTitle
                    value={node.name}
                    editable={editable}
                    startEditing={search.get("new") === "1"}
                    onSave={async (name) => {
                      const updated = await api<NodeItem>(`/nodes/${node.id}`, { method: "PATCH", body: { name } });
                      detail.setData((prev) => (prev ? { ...prev, node: { ...prev.node, ...updated } } : prev));
                      void crumbs.reload();
                      if (search.get("new")) router.replace(`/w/${wsId}/doc/${nodeId}`);
                    }}
                  />
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted tabular-nums">
                    {readOnly ? (
                      <Badge small>
                        <Eye className="size-3" aria-hidden />
                        Chỉ xem
                      </Badge>
                    ) : null}
                    <SaveState status={collab.status} synced={collab.synced} unsynced={collab.unsynced} readOnly={readOnly} />
                    {d.lastEditedAt ? (
                      <>
                        {!readOnly || collab.status === "offline" || !collab.synced ? <span aria-hidden>·</span> : null}
                        <span>
                          Sửa lần cuối {formatWhen(d.lastEditedAt, { withTime: true }).toLowerCase()}
                          {d.lastEditedBy ? ` bởi ${d.lastEditedBy.name}` : ""}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Presence peers={collab.peers} />
                  <Button icon={MessageSquare} aria-expanded={commentsOpen} onClick={() => setCommentsOpen((v) => !v)} className={cn(commentsOpen && "bg-button-hover")}>
                    Bình luận
                    {openCount ? <span className="text-muted tabular-nums">{openCount}</span> : null}
                  </Button>
                  {canShare ? (
                    <Button icon={Share2} variant="primary" onClick={() => setShareOpen(true)}>
                      Chia sẻ
                    </Button>
                  ) : null}
                  <RowMenu
                    label="Thêm thao tác"
                    groups={[
                      [
                        { icon: History, label: "Lịch sử phiên bản", onSelect: () => setVersionsOpen(true) },
                        { icon: Activity, label: "Hoạt động", onSelect: () => setActivityOpen(true), hidden: !roleAtLeast(node.myRole, "OWNER") && !me?.isSystemAdmin },
                        { icon: TagIcon, label: "Gắn tag", onSelect: () => setTagsOpen(true), hidden: !membership || !roleAtLeast(node.myRole, "EDITOR") },
                      ],
                      [
                        { icon: Download, label: "Tải về dạng HTML", onSelect: () => void exportAs("html") },
                        { icon: Download, label: "Tải về dạng Markdown", onSelect: () => void exportAs("md") },
                      ],
                    ]}
                  />
                </div>
              </div>

              {collabFailed ? (
                <div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-border-strong bg-warn-bg p-4">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  <p className="min-w-0 text-sm text-pretty text-foreground">
                    <span className="font-medium">Không kết nối được máy chủ soạn thảo.</span> Tải lại trang để thử lại. {describeError(collab.error)}
                  </p>
                </div>
              ) : null}

              <Card className="mt-4 px-5 py-8 sm:px-12 sm:py-10">
                {session ? (
                  <DocEditor session={session} editable={editable} onReady={setEditor} onCommentClick={(id) => selectThread(id, false)} onAddComment={startComment} onLink={() => editable && setLinkOpen(true)} onImage={(f) => void insertImages(f)} />
                ) : (
                  <div className="h-[50vh] animate-pulse rounded-xl bg-foreground/5" aria-busy="true" aria-label="Đang tải" />
                )}
              </Card>
            </main>

            {commentsOpen && wide ? (
              <aside aria-label="Bình luận" className="sticky top-32 hidden max-h-[calc(100dvh-9rem)] w-80 shrink-0 self-start overflow-y-auto pb-6 xl:block">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Bình luận</h2>
                  <Button variant="ghost" className="min-h-8 rounded-lg px-3" onClick={() => setCommentsOpen(false)}>
                    Đóng
                  </Button>
                </div>
                {panel}
              </aside>
            ) : null}
          </div>

          <Sheet open={commentsOpen && !wide} onClose={() => setCommentsOpen(false)} title="Bình luận" subtitle={<span className="block truncate">{node.name}</span>}>
            <div className="px-4 py-4 sm:px-6">{panel}</div>
          </Sheet>

          <input
            ref={imageInput}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (e.target.files?.length) void insertImages([...e.target.files]);
              e.target.value = "";
            }}
          />
          <LinkDialog editor={editor} open={linkOpen} onClose={() => setLinkOpen(false)} />
          <DocVersionsSheet
            nodeId={nodeId}
            name={node.name}
            open={versionsOpen}
            onClose={() => setVersionsOpen(false)}
            canEdit={editable}
            refreshKey={versionsOpen}
          />
          <ActivitySheet node={node} open={activityOpen} onClose={() => setActivityOpen(false)} />
          <TagsDialog
            open={tagsOpen}
            onClose={() => setTagsOpen(false)}
            node={tagsOpen ? node : null}
            workspaceId={node.workspaceId}
            onSaved={() => {
              toast("success", "Đã cập nhật tag");
              void detail.reload();
            }}
          />
          {canShare ? <ShareSheet node={shareOpen ? node : null} onClose={() => setShareOpen(false)} memberEmails={memberEmails} /> : null}
        </>
      )}
    </>
  );
}
