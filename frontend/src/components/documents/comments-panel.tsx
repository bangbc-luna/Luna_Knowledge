"use client";

import { Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { api, describeError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { DocComment, DocThread } from "@/lib/documents";
import { formatWhen } from "@/lib/format";
import type { UserSummary } from "@/lib/types";
import { Button, IconButton } from "../ui/button";
import { RowMenu } from "../ui/menu";
import { Avatar, EmptyState, ErrorBanner, Tabs } from "../ui/misc";
import { useToast } from "../ui/toast";
import { MentionComposer } from "./mention-composer";

export type ThreadFilter = "OPEN" | "RESOLVED";

function Body({ c }: { c: DocComment }) {
  if (!c.mentions.length) return <>{c.body}</>;
  const names = c.mentions.map((m) => `@${m.name}`).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {c.body.split(re).map((part, i) => (names.includes(part) ? <span key={i} className="font-medium text-foreground">{part}</span> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

function CommentItem({ c, people, meId, onChanged, onDeleted }: { c: DocComment; people: UserSummary[]; meId: string; onChanged: (t: DocThread) => void; onDeleted: (threadDeleted: boolean) => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="flex gap-3">
        <Avatar name={c.author.name} src={c.author.avatarUrl} />
        <div className="min-w-0 flex-1">
          <MentionComposer
            people={people}
            meId={meId}
            initial={c.body}
            autoFocus
            placeholder="Sửa bình luận"
            submitLabel="Lưu"
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              try {
                onChanged(await api<DocThread>(`/comments/${c.id}`, { method: "PATCH", body: { body } }));
                setEditing(false);
              } catch (err) {
                toast("error", describeError(err));
              }
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <Avatar name={c.author.name} src={c.author.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">{c.author.name}</p>
          <time className="shrink-0 text-xs text-muted tabular-nums" dateTime={c.createdAt} title={new Date(c.createdAt).toLocaleString("vi-VN")}>
            {formatWhen(c.createdAt, { withTime: true })}
            {c.editedAt ? " · đã sửa" : ""}
          </time>
        </div>
        <p className="mt-0.5 text-sm whitespace-pre-wrap text-foreground/90 [overflow-wrap:anywhere]">
          <Body c={c} />
        </p>
      </div>
      {c.canEdit || c.canDelete ? (
        <div className="-mt-1 -mr-1">
          <RowMenu
            label="Thao tác bình luận"
            groups={[
              [{ icon: Pencil, label: "Sửa", onSelect: () => setEditing(true), hidden: !c.canEdit }],
              [
                {
                  icon: Trash2,
                  label: "Xoá bình luận",
                  danger: true,
                  hidden: !c.canDelete,
                  onSelect: async () => {
                    try {
                      const r = await api<{ threadDeleted: boolean }>(`/comments/${c.id}`, { method: "DELETE" });
                      onDeleted(r.threadDeleted);
                    } catch (err) {
                      toast("error", describeError(err));
                    }
                  },
                },
              ],
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ThreadCard({
  thread,
  active,
  people,
  meId,
  onSelect,
  onChanged,
  onRemoved,
  onReload,
}: {
  thread: DocThread;
  active: boolean;
  people: UserSummary[];
  meId: string;
  onSelect: () => void;
  onChanged: (t: DocThread) => void;
  onRemoved: () => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const resolved = thread.status === "RESOLVED";

  const setStatus = async () => {
    setBusy(true);
    try {
      onChanged(await api<DocThread>(`/threads/${thread.id}/${resolved ? "reopen" : "resolve"}`, { method: "POST" }));
      toast("success", resolved ? "Đã mở lại bình luận" : "Đã đánh dấu xong");
    } catch (err) {
      toast("error", describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      onClick={onSelect}
      className={cn("rounded-2xl border bg-surface p-4 transition-colors", active ? "border-foreground/30" : "border-border-strong hover:border-foreground/20")}
      data-thread={thread.id}
    >
      <div className="flex items-start gap-2">
        {thread.quotedText ? (
          <p className="min-w-0 flex-1 border-l-2 border-amber-300 pl-2.5 text-sm text-muted line-clamp-2 [overflow-wrap:anywhere]" title={thread.quotedText}>
            {thread.quotedText}
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-muted">Bình luận chung</p>
        )}
        {thread.canResolve ? (
          <IconButton
            icon={resolved ? RotateCcw : Check}
            label={resolved ? "Mở lại" : "Đánh dấu xong"}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void setStatus();
            }}
            className="-mt-1 -mr-1"
          />
        ) : null}
      </div>
      {resolved && thread.resolvedBy ? (
        <p className="mt-2 text-xs text-muted">
          {thread.resolvedBy.name} đã đánh dấu xong · {thread.resolvedAt ? formatWhen(thread.resolvedAt, { withTime: true }) : ""}
        </p>
      ) : null}
      <div className="mt-3 space-y-4">
        {thread.comments.map((c) => (
          <CommentItem
            key={c.id}
            c={c}
            people={people}
            meId={meId}
            onChanged={onChanged}
            onDeleted={(gone) => {
              if (gone) onRemoved();
              else onReload();
            }}
          />
        ))}
      </div>
      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        {replying ? (
          <MentionComposer
            people={people}
            meId={meId}
            autoFocus
            placeholder="Trả lời, gõ @ để nhắc ai đó"
            submitLabel="Trả lời"
            onCancel={() => setReplying(false)}
            onSubmit={async (body, mentions) => {
              try {
                const t = await api<DocThread>(`/threads/${thread.id}/comments`, { method: "POST", body: { body, mentions } });
                onChanged(t);
                if (t.ignoredMentions?.length) toast("error", "Có người được nhắc không xem được tài liệu này nên sẽ không nhận thông báo");
                setReplying(false);
              } catch (err) {
                toast("error", describeError(err));
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              onSelect();
              setReplying(true);
            }}
            className="flex h-10 w-full cursor-pointer items-center rounded-xl border border-border-strong px-3 text-left text-sm text-muted outline-hidden hover:border-foreground/20 focus-visible:border-focus"
          >
            Trả lời…
          </button>
        )}
      </div>
    </article>
  );
}

export function CommentsPanel({
  threads,
  error,
  loading,
  filter,
  onFilter,
  activeId,
  people,
  meId,
  draft,
  onDraftCancel,
  onDraftSubmit,
  onSelect,
  onChanged,
  onRemoved,
  onReload,
}: {
  threads: DocThread[] | null;
  error: unknown;
  loading: boolean;
  filter: ThreadFilter;
  onFilter: (f: ThreadFilter) => void;
  activeId: string | null;
  people: UserSummary[];
  meId: string;
  draft: { quotedText: string } | null;
  onDraftCancel: () => void;
  onDraftSubmit: (body: string, mentions: string[]) => Promise<void>;
  onSelect: (id: string) => void;
  onChanged: (t: DocThread) => void;
  onRemoved: (id: string) => void;
  onReload: () => void;
}) {
  const open = threads?.filter((t) => t.status === "OPEN") ?? [];
  const done = threads?.filter((t) => t.status === "RESOLVED") ?? [];
  const list = filter === "OPEN" ? open : done;
  return (
    <div className="flex flex-col gap-3">
      <Tabs
        label="Lọc bình luận"
        value={filter}
        onChange={onFilter}
        items={[
          { value: "OPEN", label: "Đang mở", count: open.length },
          { value: "RESOLVED", label: "Đã xong", count: done.length },
        ]}
      />
      {draft ? (
        <div className="rounded-2xl border border-foreground/30 bg-surface p-4">
          {draft.quotedText ? <p className="border-l-2 border-amber-300 pl-2.5 text-sm text-muted line-clamp-2 [overflow-wrap:anywhere]">{draft.quotedText}</p> : null}
          <div className="mt-3">
            <MentionComposer people={people} meId={meId} autoFocus placeholder="Viết bình luận, gõ @ để nhắc ai đó" submitLabel="Bình luận" onCancel={onDraftCancel} onSubmit={onDraftSubmit} />
          </div>
        </div>
      ) : null}
      {error ? (
        <ErrorBanner error={error} what="bình luận" onRetry={onReload} />
      ) : loading && !threads ? (
        <div aria-busy="true" aria-label="Đang tải" className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-foreground/5" />
          ))}
        </div>
      ) : !list.length && !draft ? (
        <EmptyState text={filter === "OPEN" ? "Chưa có bình luận nào. Bôi đen một đoạn rồi bấm Bình luận để bắt đầu." : "Chưa có bình luận nào được đánh dấu xong."} />
      ) : (
        list.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            active={t.id === activeId}
            people={people}
            meId={meId}
            onSelect={() => onSelect(t.id)}
            onChanged={onChanged}
            onRemoved={() => onRemoved(t.id)}
            onReload={onReload}
          />
        ))
      )}
      {filter === "OPEN" && done.length && !draft ? (
        <Button variant="ghost" className="self-start" onClick={() => onFilter("RESOLVED")}>
          Xem {done.length} bình luận đã xong
        </Button>
      ) : null}
    </div>
  );
}
