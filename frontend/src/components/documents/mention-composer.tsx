"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { UserSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { Avatar } from "../ui/misc";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

export function MentionComposer({
  people,
  meId,
  placeholder,
  submitLabel,
  initial = "",
  autoFocus,
  onSubmit,
  onCancel,
}: {
  people: UserSummary[];
  meId: string;
  placeholder: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (body: string, mentions: string[]) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const [query, setQuery] = useState<{ start: number; q: string } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const options = useMemo(() => {
    if (!query) return [];
    const q = fold(query.q);
    return people.filter((p) => p.id !== meId && (fold(p.name).includes(q) || fold(p.email).startsWith(q))).slice(0, 6);
  }, [people, query, meId]);

  const detect = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    if (m) {
      setQuery({ start: caret - m[2]!.length - 1, q: m[2]! });
      setCursor(0);
    } else setQuery(null);
  };

  const choose = (p: UserSummary) => {
    if (!query) return;
    const caret = ref.current?.selectionStart ?? text.length;
    const insert = `@${p.name} `;
    const next = text.slice(0, query.start) + insert + text.slice(caret);
    setText(next);
    setPicked((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + insert.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSubmit(body, picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id));
      setText("");
      setPicked([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={2}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (query && options.length) {
            if (e.key === "ArrowDown") return (e.preventDefault(), setCursor((c) => (c + 1) % options.length));
            if (e.key === "ArrowUp") return (e.preventDefault(), setCursor((c) => (c - 1 + options.length) % options.length));
            if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), choose(options[cursor]!));
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            if (query) setQuery(null);
            else onCancel?.();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        className="field-sizing-content block max-h-48 min-h-18 w-full resize-none rounded-xl border border-border-strong bg-surface px-3 py-2 text-base text-foreground outline-hidden placeholder:text-muted focus:border-focus focus:ring-2 focus:ring-focus md:text-sm"
      />
      {query && options.length ? (
        <div role="listbox" aria-label="Nhắc đến" className="animate-pop absolute top-full left-0 z-40 mt-1 w-full rounded-2xl border border-border bg-surface-overlay p-1 shadow-popover">
          {options.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === cursor}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(p)}
              className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left", i === cursor && "bg-item-hover")}
            >
              <Avatar name={p.name} src={p.avatarUrl} size="size-6" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                <span className="block truncate text-xs text-muted">{p.email}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="secondary" className="min-h-8 rounded-lg px-3" onClick={onCancel}>
            Huỷ
          </Button>
        ) : null}
        <Button variant="primary" className="min-h-8 rounded-lg px-3" disabled={!text.trim()} loading={busy} onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
