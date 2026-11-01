"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { createMeeting, meetingHref } from "@/lib/meetings";
import type { UserSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { focusRing } from "../ui/focus";
import { Field, Input } from "../ui/input";
import { Avatar } from "../ui/misc";
import { useToast } from "../ui/toast";
import { UserSuggestInput } from "../ui/user-suggest";
import { defaultScheduleValue, toLocalInput } from "./meeting-time";

export type MeetingMode = "instant" | "scheduled";

const MODES: Array<{ value: MeetingMode; label: string }> = [
  { value: "instant", label: "Họp ngay" },
  { value: "scheduled", label: "Đặt lịch" },
];

export function CreateMeetingDialog({
  wsId,
  open,
  initialMode,
  onClose,
  onCreated,
}: {
  wsId: string;
  open: boolean;
  initialMode: MeetingMode;
  onClose: () => void;
  onCreated: () => void;
}) {
  if (!open) return null;
  return <CreateForm key={initialMode} wsId={wsId} initialMode={initialMode} onClose={onClose} onCreated={onCreated} />;
}

function CreateForm({ wsId, initialMode, onClose, onCreated }: { wsId: string; initialMode: MeetingMode; onClose: () => void; onCreated: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<MeetingMode>(initialMode);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(() => defaultScheduleValue());
  const [aiNotes, setAiNotes] = useState(true);
  const [invitees, setInvitees] = useState<UserSummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scheduled = mode === "scheduled";
  const submit = async () => {
    const name = title.trim();
    if (!name) return setError("Nhập tiêu đề cuộc họp");
    let scheduledAt: string | undefined;
    if (scheduled) {
      const at = new Date(when);
      if (!when || Number.isNaN(at.getTime())) return setError("Chọn ngày và giờ họp");
      if (at.getTime() < Date.now() - 5 * 60_000) return setError("Giờ họp không được ở quá khứ");
      scheduledAt = at.toISOString();
    }
    setBusy(true);
    setError(null);
    try {
      const meeting = await createMeeting(wsId, {
        title: name,
        mode,
        scheduledAt,
        aiNotesEnabled: aiNotes,
        inviteeEmails: invitees.map((u) => u.email),
      });
      onCreated();
      onClose();
      if (mode === "instant") router.push(meetingHref(wsId, meeting.id));
      else toast("success", `Đã đặt lịch «${meeting.title}»`);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Tạo cuộc họp"
      onSubmit={() => void submit()}
      footer={
        <>
          <Button size="touch" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" variant="primary" size="touch" loading={busy}>
            {scheduled ? "Đặt lịch" : "Họp ngay"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Kiểu cuộc họp" className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={cn(
                "h-9 cursor-pointer rounded-lg text-sm font-medium transition-colors",
                focusRing,
                mode === m.value ? "bg-surface text-foreground" : "text-foreground/70 hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Field label="Tiêu đề">
          {(id) => <Input id={id} autoFocus maxLength={200} placeholder="Họp tuần nhóm sản phẩm" value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        {scheduled ? (
          <Field label="Ngày và giờ">
            {(id) => <Input id={id} type="datetime-local" min={toLocalInput(new Date())} value={when} onChange={(e) => setWhen(e.target.value)} />}
          </Field>
        ) : null}
        <Field label="Mời người tham gia" hint="Gõ tên hoặc email để chọn. Người được mời nhận thông báo.">
          {(id) => (
            <UserSuggestInput
              id={id}
              value={query}
              onChange={setQuery}
              taken={new Set(invitees.map((u) => u.id))}
              placeholder="Tìm theo tên hoặc email"
              onPick={(u) => {
                setInvitees((list) => (list.some((x) => x.id === u.id) ? list : [...list, u]));
                setQuery("");
              }}
            />
          )}
        </Field>
        {invitees.length ? (
          <ul className="-mt-2 flex flex-wrap gap-1.5" aria-label="Người được mời">
            {invitees.map((u) => (
              <li key={u.id} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-secondary pr-1 pl-1">
                <Avatar name={u.name} src={u.avatarUrl} size="size-6" />
                <span className="min-w-0 truncate text-sm" title={u.email}>
                  {u.name}
                </span>
                <button
                  type="button"
                  aria-label={`Bỏ ${u.name}`}
                  onClick={() => setInvitees((list) => list.filter((x) => x.id !== u.id))}
                  className={cn("inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-foreground/8 hover:text-foreground", focusRing)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p id="ai-notes-label" className="text-sm font-medium">
              Ghi biên bản AI
            </p>
            <p className="text-xs text-muted text-pretty">Ghi âm lời thoại và tự tóm tắt sau cuộc họp.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiNotes}
            aria-labelledby="ai-notes-label"
            onClick={() => setAiNotes((v) => !v)}
            className={cn("relative h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors", focusRing, aiNotes ? "bg-primary" : "bg-border-strong")}
          >
            <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-surface transition-transform motion-reduce:transition-none", aiNotes && "translate-x-4")} />
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-err-text">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
