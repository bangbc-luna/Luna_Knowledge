"use client";

import { Pencil, UserPlus, CalendarX2 } from "lucide-react";
import { useState } from "react";
import type { MeetingDetail } from "@/lib/meetings";
import { cancelMeeting, inviteToMeeting, uninviteFromMeeting, updateMeeting } from "@/lib/meetings";
import type { UpdateMeetingInput } from "@/lib/meetings";
import type { UserSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { ConfirmDialog, Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { useToast } from "../ui/toast";
import { UserSuggestInput } from "../ui/user-suggest";
import { meetingErrorText } from "./meeting-errors";
import { AiNotesSwitch, PersonChips, ScheduleField } from "./meeting-form-parts";
import { inputToDate, inputToIso, toLocalInput } from "./meeting-time";

type Panel = "edit" | "invite" | "cancel" | null;

export function ManageActions({ meeting, onChanged, onCancelled }: { meeting: MeetingDetail; onChanged: () => void; onCancelled: () => void }) {
  const [panel, setPanel] = useState<Panel>(null);
  const toast = useToast();
  const close = () => setPanel(null);
  return (
    <div className="mx-auto mb-4 flex w-full max-w-5xl flex-wrap items-center justify-end gap-2" role="group" aria-label="Quản lý buổi họp">
      <Button icon={Pencil} onClick={() => setPanel("edit")}>
        Sửa
      </Button>
      <Button icon={UserPlus} onClick={() => setPanel("invite")}>
        Mời thêm
      </Button>
      <Button icon={CalendarX2} variant="danger" onClick={() => setPanel("cancel")}>
        Huỷ buổi họp
      </Button>
      {panel === "edit" ? <EditForm meeting={meeting} onClose={close} onSaved={onChanged} /> : null}
      {panel === "invite" ? <InviteForm meeting={meeting} onClose={close} onChanged={onChanged} /> : null}
      <ConfirmDialog
        open={panel === "cancel"}
        onClose={close}
        title="Huỷ buổi họp này?"
        confirmLabel="Huỷ buổi họp"
        icon={CalendarX2}
        onConfirm={async () => {
          try {
            await cancelMeeting(meeting.id);
            toast("success", `Đã huỷ «${meeting.title}»`);
            onCancelled();
          } catch (err) {
            toast("error", meetingErrorText(err));
            onChanged();
          }
        }}
      >
        Mọi người được mời sẽ nhận thông báo huỷ và không thể vào phòng nữa. Không hoàn tác được.
      </ConfirmDialog>
    </div>
  );
}

function EditForm({ meeting, onClose, onSaved }: { meeting: MeetingDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const initialWhen = meeting.scheduledAt ? toLocalInput(new Date(meeting.scheduledAt)) : "";
  const [title, setTitle] = useState(meeting.title);
  const [when, setWhen] = useState(initialWhen);
  const [aiNotes, setAiNotes] = useState(meeting.aiNotesEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const name = title.trim();
    if (!name) return setError("Nhập tiêu đề cuộc họp");
    const patch: UpdateMeetingInput = {};
    if (name !== meeting.title) patch.title = name;
    if (meeting.aiNotesAvailable && aiNotes !== meeting.aiNotesEnabled) patch.aiNotesEnabled = aiNotes;
    if (when !== initialWhen) {
      const at = inputToDate(when);
      if (!when || Number.isNaN(at.getTime())) return setError("Chọn ngày và giờ họp");
      if (at.getTime() < Date.now() - 5 * 60_000) return setError("Giờ họp không được ở quá khứ");
      patch.scheduledAt = inputToIso(when);
    }
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    setError(null);
    try {
      await updateMeeting(meeting.id, patch);
      toast("success", "Đã lưu thay đổi");
      onSaved();
      onClose();
    } catch (err) {
      setError(meetingErrorText(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Sửa buổi họp"
      onSubmit={() => void submit()}
      footer={
        <>
          <Button size="touch" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" variant="primary" size="touch" loading={busy}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Tiêu đề">{(id) => <Input id={id} autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <ScheduleField value={when} onChange={setWhen} />
        <AiNotesSwitch checked={aiNotes} onChange={setAiNotes} unavailable={!meeting.aiNotesAvailable} />
        {error ? (
          <p role="alert" className="text-sm text-err-text">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function InviteForm({ meeting, onClose, onChanged }: { meeting: MeetingDetail; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [invited, setInvited] = useState<UserSummary[]>(meeting.invitees);
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = new Set([...invited, ...picked].map((u) => u.id));

  const add = async () => {
    if (!picked.length) return onClose();
    setBusy(true);
    setError(null);
    try {
      const res = await inviteToMeeting(
        meeting.id,
        picked.map((u) => u.email),
      );
      setInvited((list) => [...list, ...res.added.filter((a) => !list.some((x) => x.id === a.id))]);
      setPicked([]);
      toast("success", res.added.length ? `Đã mời ${res.added.length} người` : "Những người này đã được mời trước đó");
      onChanged();
    } catch (err) {
      setError(meetingErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (user: UserSummary) => {
    setRemoving(true);
    setError(null);
    try {
      await uninviteFromMeeting(meeting.id, user.id);
      setInvited((list) => list.filter((x) => x.id !== user.id));
      onChanged();
    } catch (err) {
      setError(meetingErrorText(err));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mời thêm người"
      onSubmit={() => void add()}
      footer={
        <>
          <Button size="touch" onClick={onClose}>
            Đóng
          </Button>
          <Button type="submit" variant="primary" size="touch" loading={busy} disabled={!picked.length}>
            Mời
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Thêm người" hint="Gõ tên hoặc email để chọn. Người được mời nhận thông báo.">
          {(id) => (
            <UserSuggestInput
              id={id}
              value={query}
              onChange={setQuery}
              taken={taken}
              placeholder="Tìm theo tên hoặc email"
              onPick={(u) => {
                setPicked((list) => (list.some((x) => x.id === u.id) ? list : [...list, u]));
                setQuery("");
              }}
            />
          )}
        </Field>
        {picked.length ? <PersonChips people={picked} label="Sắp mời" removeLabel={(name) => `Bỏ ${name}`} onRemove={(u) => setPicked((list) => list.filter((x) => x.id !== u.id))} /> : null}
        <section aria-labelledby="invited-heading">
          <h3 id="invited-heading" className="text-sm font-medium">
            Đã mời <span className="font-normal tabular-nums text-muted">{invited.length}</span>
          </h3>
          {invited.length ? (
            <div className="mt-2">
              <PersonChips people={invited} label="Người đã được mời" removeLabel={(name) => `Bỏ lời mời ${name}`} onRemove={(u) => void remove(u)} disabled={removing} />
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">Chưa mời ai.</p>
          )}
        </section>
        {error ? (
          <p role="alert" className="text-sm text-err-text">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
