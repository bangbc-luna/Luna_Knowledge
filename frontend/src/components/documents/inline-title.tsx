"use client";

import { Check, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, describeError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";

const FIELD = "rounded-xl border bg-surface text-foreground outline-hidden transition-colors focus:ring-2";

export function InlineTitle({ value, editable, startEditing = false, onSave }: { value: string; editable: boolean; startEditing?: boolean; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(startEditing && editable);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editing) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [editing]);

  const begin = () => {
    setDraft(value);
    setError(null);
    setEditing(true);
  };
  const cancel = (refocus = true) => {
    setEditing(false);
    setError(null);
    if (refocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const save = async (refocus = true) => {
    const name = draft.replace(/\s+/g, " ").trim();
    if (!name) return setError("Chưa nhập tên tài liệu");
    if (name === value) return cancel(refocus);
    setBusy(true);
    try {
      await onSave(name);
      cancel(refocus);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "CONFLICT" ? "Thư mục này đã có mục cùng tên" : describeError(err));
    } finally {
      setBusy(false);
    }
  };
  const keep = (e: React.MouseEvent) => e.preventDefault();

  if (!editable) return <h1 className="text-xl leading-7 font-semibold text-balance text-foreground [overflow-wrap:anywhere]">{value}</h1>;

  if (!editing) {
    return (
      <h1 className="-ml-2.25 min-w-0 sm:pr-26 md:pr-24">
        <button
          ref={triggerRef}
          type="button"
          onClick={begin}
          className="group inline-flex min-h-11 w-fit max-w-full cursor-pointer items-center rounded-xl border border-transparent px-2 py-1.75 text-left text-xl leading-7 font-semibold text-foreground outline-hidden transition-colors hover:bg-foreground/5 focus-visible:border-focus md:min-h-10 md:py-1.25"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {value}
            <span className="sr-only">. Sửa tên tài liệu</span>
            <Pencil className="ml-2 inline-block size-4 align-[-1px] text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden />
          </span>
        </button>
      </h1>
    );
  }

  return (
    <div
      className="-ml-2.25 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !busy) void save(false);
      }}
    >
      <textarea
        ref={fieldRef}
        rows={1}
        enterKeyHint="done"
        aria-label="Tên tài liệu"
        aria-invalid={!!error || undefined}
        maxLength={255}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value.replace(/\n/g, " "));
          setError(null);
        }}
        className={cn(
          FIELD,
          error ? "border-err-line focus:ring-err-line/10" : "border-border-strong focus:border-focus focus:ring-focus",
          "col-span-2 field-sizing-content min-h-11 resize-none px-2 py-1.75 text-xl leading-7 font-semibold sm:col-span-1 md:min-h-10 md:py-1.25",
        )}
      />
      <div className="col-start-2 row-start-2 flex gap-2 sm:row-start-1">
        <Button icon={Check} aria-label="Lưu" title="Lưu · Enter" loading={busy} onMouseDown={keep} onClick={() => void save()} className="size-11 p-0 md:size-10" />
        <Button icon={X} aria-label="Huỷ" title="Huỷ · Esc" onMouseDown={keep} onClick={() => cancel()} className="size-11 p-0 md:size-10" />
      </div>
      {error ? (
        <div className="col-start-1 row-start-2 min-w-0 pl-2.25">
          <p className="text-sm text-err-text">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
