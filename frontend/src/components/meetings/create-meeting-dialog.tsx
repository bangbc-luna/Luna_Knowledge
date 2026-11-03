"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { createMeeting, meetingHref } from "@/lib/meetings";
import type { UserSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { focusRing } from "../ui/focus";
import { Field, Input } from "../ui/input";
import { useToast } from "../ui/toast";
import { UserSuggestInput } from "../ui/user-suggest";
import { meetingErrorText } from "./meeting-errors";
import { AiNotesSwitch, PersonChips, ScheduleField } from "./meeting-form-parts";
import { defaultScheduleValue, inputToDate, inputToIso } from "./meeting-time";

export type MeetingMode = "instant" | "scheduled";

const MODES: Array<{ value: MeetingMode; label: string }> = [
  { value: "instant", label: "Họp ngay" },
  { value: "scheduled", label: "Đặt lịch" },
];

export function CreateMeetingDialog({
  wsId,
  open,
  initialMode,
  aiAvailable,
  onClose,
  onCreated,
}: {
  wsId: string;
  open: boolean;
  initialMode: MeetingMode;
  aiAvailable: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  if (!open) return null;
  return <CreateForm key={initialMode} wsId={wsId} initialMode={initialMode} aiAvailable={aiAvailable} onClose={onClose} onCreated={onCreated} />;
}

function CreateForm({ wsId, initialMode, aiAvailable, onClose, onCreated }: { wsId: string; initialMode: MeetingMode; aiAvailable: boolean; onClose: () => void; onCreated: () => void }) {
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
      const at = inputToDate(when);
      if (!when || Number.isNaN(at.getTime())) return setError("Chọn ngày và giờ họp");
      if (at.getTime() < Date.now() - 5 * 60_000) return setError("Giờ họp không được ở quá khứ");
      scheduledAt = inputToIso(when);
    }
    setBusy(true);
    setError(null);
    try {
      const meeting = await createMeeting(wsId, {
        title: name,
        mode,
        scheduledAt,
        aiNotesEnabled: aiAvailable && aiNotes,
        inviteeEmails: invitees.map((u) => u.email),
      });
      onCreated();
      onClose();
      if (mode === "instant") router.push(meetingHref(wsId, meeting.id));
      else toast("success", `Đã đặt lịch «${meeting.title}»`);
    } catch (err) {
      setError(meetingErrorText(err));
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
          <ScheduleField value={when} onChange={setWhen} />
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
          <div className="-mt-2">
            <PersonChips people={invitees} label="Người được mời" removeLabel={(name) => `Bỏ ${name}`} onRemove={(u) => setInvitees((list) => list.filter((x) => x.id !== u.id))} />
          </div>
        ) : null}
        <AiNotesSwitch checked={aiNotes} onChange={setAiNotes} unavailable={!aiAvailable} />
        {error ? (
          <p role="alert" className="text-sm text-err-text">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
