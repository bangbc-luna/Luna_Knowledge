"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { UserSummary } from "@/lib/types";
import { Input } from "./input";
import { Avatar } from "./misc";

const DEBOUNCE_MS = 200;
const LIMIT = 8;

export function UserSuggestInput({
  id,
  value,
  onChange,
  onPick,
  taken,
  invalid,
  placeholder,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (user: UserSummary) => void;
  taken?: ReadonlySet<string>;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  const query = value.trim();
  const [result, setResult] = useState<{ q: string; users: UserSummary[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!query) return;
    let stopped = false;
    const timer = setTimeout(async () => {
      try {
        const users = await api<UserSummary[]>("/users", { query: { q: query, limit: LIMIT } });
        if (!stopped) setResult({ q: query, users });
      } catch {
        if (!stopped) setResult({ q: query, users: [] });
      }
    }, DEBOUNCE_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [query]);

  const users = query && result?.q === query ? result.users : [];
  const exact = users.length === 1 && users[0]!.email === query.toLowerCase();
  const showList = open && !!query && result?.q === query && !exact;
  const selectable = users.map((u) => !taken?.has(u.id));
  const active = selectable[cursor] ? cursor : selectable.indexOf(true);
  const pick = (u: UserSummary) => {
    onPick(u);
    setOpen(false);
  };
  const move = (step: number) => {
    if (!users.length) return;
    let next = active < 0 ? cursor : active;
    for (let i = 0; i < users.length; i++) {
      next = (next + step + users.length) % users.length;
      if (selectable[next]) return setCursor(next);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        invalid={invalid}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || !showList) return;
          if (e.key === "ArrowDown") return (e.preventDefault(), move(1));
          if (e.key === "ArrowUp") return (e.preventDefault(), move(-1));
          if (e.key === "Escape") return (e.stopPropagation(), setOpen(false));
          if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(users[active]!);
          }
        }}
      />
      {showList ? (
        <div id={listId} role="listbox" aria-label="Gợi ý người dùng" className="animate-pop absolute top-full right-0 left-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-border bg-surface-overlay p-1 shadow-popover">
          {users.length ? (
            users.map((u, i) => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={i === active}
                aria-disabled={!selectable[i] || undefined}
                disabled={!selectable[i]}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => selectable[i] && setCursor(i)}
                onClick={() => pick(u)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left",
                  selectable[i] ? "cursor-pointer" : "cursor-default opacity-60",
                  i === active && "bg-item-hover",
                )}
              >
                <Avatar name={u.name} src={u.avatarUrl} size="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{u.name}</span>
                  <span className="block truncate text-xs text-muted">{u.email}</span>
                </span>
                {!selectable[i] ? <span className="shrink-0 text-xs text-muted">Đã ở trong workspace</span> : null}
              </button>
            ))
          ) : (
            <p className="px-2.5 py-2 text-sm text-pretty text-muted">
              Không thấy ai khớp «{query}». Người chưa đăng nhập lần nào thì nhập đủ email @lunatech.vn để mời.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
