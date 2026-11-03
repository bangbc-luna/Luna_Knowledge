"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CircleAlert, RotateCw, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { publishMinutes, saveMinutesDraft } from "@/lib/meetings";
import type { MeetingMinutes, MinutesDraft } from "@/lib/meetings";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { LunaMention } from "../documents/extensions";
import { meetingErrorText } from "./meeting-errors";

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string };

const CONFIRM_TEXT = "Biên bản sẽ hiện cho mọi người xem được workspace và gửi thông báo";
const CONFLICT_TEXT = "Có người vừa lưu biên bản, tải lại để xem";

const textOf = (node: Node): string => (typeof node.text === "string" ? node.text : (node.content ?? []).map(textOf).join(""));

function hasSuggested(node: Node, userId: string): boolean {
  if (node.type === "mention" && node.attrs?.suggested === true && node.attrs.id === userId) return true;
  return (node.content ?? []).some((c) => hasSuggested(c, userId));
}

function taskTitle(node: Node, userId: string): string | null {
  if (node.type === "tableRow" && hasSuggested(node, userId)) {
    const title = textOf(node.content?.[1] ?? {}).trim();
    return title || null;
  }
  for (const child of node.content ?? []) {
    const found = taskTitle(child, userId);
    if (found) return found;
  }
  return null;
}

function suggestedIds(node: Node, out = new Set<string>()): Set<string> {
  if (node.type === "mention" && node.attrs?.suggested === true && typeof node.attrs.id === "string") out.add(node.attrs.id);
  (node.content ?? []).forEach((c) => suggestedIds(c, out));
  return out;
}

export function MinutesDraftEditor({
  meetingId,
  minutes,
  draft,
  onReload,
  onPublished,
}: {
  meetingId: string;
  minutes: MeetingMinutes;
  draft: MinutesDraft;
  onReload: () => void;
  onPublished: () => void;
}) {
  const toast = useToast();
  const [revision, setRevision] = useState(draft.revision);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [present, setPresent] = useState<ReadonlySet<string>>(() => suggestedIds(draft.doc as Node));
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ undoRedo: {} }), TaskList, TaskItem.configure({ nested: true }), TableKit.configure({ table: { resizable: false } }), LunaMention],
    content: draft.doc,
    editorProps: { attributes: { class: "luna-prose luna-editor luna-minutes-editor", "aria-label": "Nội dung biên bản nháp", spellcheck: "false" } },
    onUpdate: ({ editor: e }) => {
      setDirty(true);
      setPresent(suggestedIds(e.getJSON() as Node));
    },
  });

  const items = useMemo(() => {
    return draft.suggestions
      .filter((s) => present.has(s.userId))
      .map((s) => ({ ...s, task: taskTitle(draft.doc as Node, s.userId) }));
  }, [present, draft]);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      setConflict(true);
      toast("error", CONFLICT_TEXT);
    } else {
      toast("error", meetingErrorText(err));
    }
  };

  const save = async (): Promise<number | null> => {
    if (!editor) return null;
    try {
      const res = await saveMinutesDraft(meetingId, editor.getJSON() as Record<string, unknown>, revision);
      setRevision(res.revision);
      setDirty(false);
      return res.revision;
    } catch (err) {
      fail(err);
      return null;
    }
  };

  const saveClick = async () => {
    setSaving(true);
    const next = await save();
    setSaving(false);
    if (next !== null) toast("success", "Đã lưu nháp");
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const current = dirty ? await save() : revision;
      if (current === null) return;
      const confirmed = items.filter((s) => checked.has(s.userId)).map((s) => s.userId);
      await publishMinutes(meetingId, current, [...new Set(confirmed)]);
      setConfirming(false);
      toast("success", "Đã gửi biên bản");
      onPublished();
    } catch (err) {
      setConfirming(false);
      fail(err);
    } finally {
      setPublishing(false);
    }
  };

  const toggle = (userId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  return (
    <div className="mt-3 flex flex-col gap-4">
      <Dialog
        open={confirming}
        onClose={() => !publishing && setConfirming(false)}
        title="Gửi biên bản?"
        description={CONFIRM_TEXT}
        footer={
          <>
            <Button variant="secondary" size="touch" disabled={publishing} onClick={() => setConfirming(false)}>
              Huỷ
            </Button>
            <Button variant="primary" size="touch" icon={Send} loading={publishing} onClick={() => void publish()}>
              Gửi biên bản
            </Button>
          </>
        }
      />
      <p className="text-sm text-muted text-pretty">Đây là bản nháp do AI viết. Sửa trực tiếp bên dưới, kiểm lại người phụ trách rồi gửi.</p>
      {minutes.warning ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn text-pretty">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{minutes.warning}</span>
        </p>
      ) : null}
      {minutes.droppedItemCount > 0 ? (
        <p className="text-sm text-muted text-pretty">AI đã bỏ {formatNumber(minutes.droppedItemCount)} việc không có căn cứ trong lời nói.</p>
      ) : null}
      {conflict ? (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-err-border bg-err-bg px-3 py-2 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm text-err">{CONFLICT_TEXT}</p>
          <Button size="sm" icon={RotateCw} onClick={onReload}>
            Tải lại
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-border-strong bg-surface p-3 focus-within:ring-2 focus-within:ring-primary sm:p-4">
        <EditorContent editor={editor} />
      </div>
      {items.length ? (
        <fieldset className="min-w-0">
          <legend className="text-sm font-semibold">Gợi ý gắn người phụ trách</legend>
          <p className="mt-1 text-xs text-muted text-pretty">Chọn người bạn xác nhận được giao việc; bỏ trống thì tên chỉ hiện dạng chữ.</p>
          <ul className="mt-2">
            {items.map((s) => (
              <li key={`${s.userId}-${s.actionIndex}`}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm">
                  <input type="checkbox" checked={checked.has(s.userId)} onChange={() => toggle(s.userId)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    Gắn <span className="font-medium">@{s.userName}</span> cho việc {s.task ? `“${s.task}”` : `số ${s.actionIndex + 1}`}
                    {s.name !== s.userName ? <span className="text-muted"> (AI nghe là “{s.name}”)</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button size="touch" loading={saving} disabled={!dirty || publishing || conflict} onClick={() => void saveClick()}>
          Lưu nháp
        </Button>
        <Button variant="primary" size="touch" icon={Send} disabled={saving || conflict} onClick={() => setConfirming(true)}>
          Gửi biên bản
        </Button>
      </div>
    </div>
  );
}
