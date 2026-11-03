"use client";

import { X } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/cn";
import type { UserSummary } from "@/lib/types";
import { focusRing } from "../ui/focus";
import { Field, Input } from "../ui/input";
import { Avatar } from "../ui/misc";
import { toLocalInput } from "./meeting-time";

export function ScheduleField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Ngày và giờ" hint="Tính theo giờ Việt Nam (UTC+7).">
      {(id) => <Input id={id} type="datetime-local" min={toLocalInput(new Date())} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export const AI_UNAVAILABLE_HINT = "Chưa cấu hình dịch vụ AI";

export function AiNotesSwitch({ checked, onChange, unavailable }: { checked: boolean; onChange: (value: boolean) => void; unavailable?: boolean }) {
  const labelId = useId();
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-sm font-medium">
          Ghi biên bản AI
        </p>
        <p className="text-xs text-muted text-pretty">{unavailable ? AI_UNAVAILABLE_HINT : "Ghi âm lời thoại và tự tóm tắt sau cuộc họp."}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked && !unavailable}
        aria-labelledby={labelId}
        disabled={unavailable}
        onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50", focusRing, checked && !unavailable ? "bg-primary" : "bg-border-strong")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-surface transition-transform motion-reduce:transition-none", checked && !unavailable && "translate-x-4")} />
      </button>
    </div>
  );
}

export function PersonChips({ people, label, removeLabel, onRemove, disabled }: { people: UserSummary[]; label: string; removeLabel: (name: string) => string; onRemove: (user: UserSummary) => void; disabled?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {people.map((u) => (
        <li key={u.id} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-secondary pr-1 pl-1">
          <Avatar name={u.name} src={u.avatarUrl} size="size-6" />
          <span className="min-w-0 truncate text-sm" title={u.email}>
            {u.name}
          </span>
          <button
            type="button"
            aria-label={removeLabel(u.name)}
            disabled={disabled}
            onClick={() => onRemove(u)}
            className={cn("inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-foreground/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50", focusRing)}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
