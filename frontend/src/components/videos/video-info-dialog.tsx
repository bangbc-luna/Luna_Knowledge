"use client";

import { useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { formatBytes } from "@/lib/files";
import { formatNumber } from "@/lib/format";
import type { NodeItem } from "@/lib/types";
import { type VideoInfo, useUploads } from "@/lib/uploads";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;
const TEXTAREA =
  "w-full resize-y rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-base text-foreground outline-hidden placeholder:text-muted focus:border-focus focus:ring-2 focus:ring-focus aria-invalid:border-err-line md:text-sm";

function titleFromFileName(name: string) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const spaced = /\s/.test(base) ? base : base.replace(/[-_.]+/g, " ");
  return spaced.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

function isComplete(info: VideoInfo) {
  return info.title.trim().length > 0 && info.description.trim().length > 0;
}

function InfoFields({
  value,
  onChange,
  titleError,
}: {
  value: VideoInfo;
  onChange: (value: VideoInfo) => void;
  titleError?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Tiêu đề" error={titleError} hint={<span className="tabular-nums">{value.title.length}/{TITLE_MAX}</span>}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            required
            value={value.title}
            maxLength={TITLE_MAX}
            invalid={!!titleError}
            placeholder="Ví dụ: Hướng dẫn quy trình nhập kho"
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        )}
      </Field>
      <Field label="Mô tả" hint={<span className="tabular-nums">{formatNumber(value.description.length)}/{formatNumber(DESCRIPTION_MAX)}</span>}>
        {(id) => (
          <textarea
            id={id}
            required
            rows={6}
            value={value.description}
            maxLength={DESCRIPTION_MAX}
            placeholder="Video nói về gì, dành cho ai, cần xem phần nào trước"
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            className={TEXTAREA}
          />
        )}
      </Field>
    </div>
  );
}

export function VideoUploadPrompt() {
  const { items, confirmDraft, cancel } = useUploads();
  const drafts = items.filter((i) => i.status === "draft");
  const current = drafts[0];
  const [handled, setHandled] = useState(0);
  const [forId, setForId] = useState<string | null>(null);
  const [form, setForm] = useState<VideoInfo>({ title: "", description: "" });
  if ((current?.id ?? null) !== forId) {
    setForId(current?.id ?? null);
    if (current) setForm({ title: titleFromFileName(current.name), description: "" });
    else setHandled(0);
  }
  if (!current) return null;

  const total = handled + drafts.length;
  const skip = () => {
    setHandled((h) => h + 1);
    cancel(current.id);
  };
  const submit = () => {
    if (!isComplete(form)) return;
    setHandled((h) => h + 1);
    confirmDraft(current.id, { title: form.title.trim(), description: form.description.trim() });
  };

  return (
    <Dialog
      key={current.id}
      open
      onClose={skip}
      title="Thông tin video"
      onSubmit={submit}
      description={
        <span className="flex min-w-0 flex-wrap gap-x-1 tabular-nums">
          {total > 1 ? <span className="font-medium text-foreground">Video {handled + 1}/{total} ·</span> : null}
          <span className="min-w-0 [overflow-wrap:anywhere]">{current.name}</span>
          <span>· {formatBytes(current.file.size)}</span>
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={skip} size="touch">
            Bỏ qua video này
          </Button>
          <Button type="submit" variant="primary" disabled={!isComplete(form)} size="touch">
            Tải lên
          </Button>
        </>
      }
    >
      <InfoFields value={form} onChange={setForm} />
    </Dialog>
  );
}

export function EditVideoInfoDialog({
  node,
  open,
  onClose,
  onSaved,
}: {
  node: Pick<NodeItem, "id" | "name" | "description">;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<VideoInfo>({ title: node.name, description: node.description ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm({ title: node.name, description: node.description ?? "" });
      setError(null);
      setSuggestion(null);
    }
  }

  const submit = async () => {
    if (!isComplete(form)) return;
    setBusy(true);
    setError(null);
    setSuggestion(null);
    try {
      await api(`/videos/${node.id}`, { method: "PATCH", body: { title: form.title.trim(), description: form.description.trim() } });
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        setError("Thư mục này đã có mục trùng tiêu đề.");
        setSuggestion((err.details as { suggestion?: string } | undefined)?.suggestion ?? null);
      } else {
        setError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sửa thông tin video"
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} size="touch">
            Huỷ
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!isComplete(form)} size="touch">
            Lưu
          </Button>
        </>
      }
    >
      <InfoFields
        value={form}
        onChange={setForm}
        titleError={
          error ? (
            <>
              {error}{" "}
              {suggestion ? (
                <button type="button" className="cursor-pointer font-medium underline underline-offset-4" onClick={() => setForm({ ...form, title: suggestion })}>
                  Dùng «{suggestion}»
                </button>
              ) : null}
            </>
          ) : undefined
        }
      />
    </Dialog>
  );
}
