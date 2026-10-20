"use client";

import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { MenuItem, PopoverPanel, usePopover } from "./popover";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Ô chọn (không dùng <select> gốc): không hover, lúc mở viền màu nhấn + ring (button.md, choice-controls.md). */
export function Select<T extends string>({
  value,
  options,
  onChange,
  prefix,
  align = "left",
  className,
  ariaLabel,
  size = "field",
  id,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  prefix?: string;
  align?: "left" | "right";
  className?: string;
  ariaLabel?: string;
  size?: "field" | "inline";
  id?: string;
}) {
  const { open, setOpen, toggle, rootRef } = usePopover();
  const current = options.find((o) => o.value === value);
  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        className={cn(
          size === "field"
            ? "flex h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-border-strong bg-surface px-4 text-left text-base whitespace-nowrap outline-hidden aria-expanded:border-focus aria-expanded:ring-2 aria-expanded:ring-focus md:h-10 md:text-sm"
            : "flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm outline-hidden hover:bg-foreground/8 aria-expanded:bg-foreground/8",
        )}
      >
        {prefix ? <span className="text-muted">{prefix}</span> : null}
        {size === "inline" ? (
          // Mũi tên thẳng cột giữa các dòng: nút rộng bằng nhãn dài nhất (members, app.md).
          <span className="grid">
            {options.map((o) => (
              <span key={o.value} className={cn("col-start-1 row-start-1", o.value !== value && "invisible")} aria-hidden={o.value !== value}>
                {o.label}
              </span>
            ))}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">{current?.label}</span>
        )}
        <ChevronDown className={cn("shrink-0 text-muted", size === "inline" ? "size-3.5" : "size-4")} aria-hidden />
      </button>
      <PopoverPanel open={open} align={align} className="w-max max-w-[calc(100vw-2rem)] min-w-full">
        <div role="listbox" className="px-1">
          {options.map((o) => (
            <MenuItem
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                setOpen(false);
                if (o.value !== value) onChange(o.value);
              }}
              className="items-start"
            >
              <span className="min-w-0 flex-1">
                <span className="block">{o.label}</span>
                {o.hint ? <span className="block text-xs text-muted">{o.hint}</span> : null}
              </span>
              {o.value === value ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <span className="size-4 shrink-0" />}
            </MenuItem>
          ))}
        </div>
      </PopoverPanel>
    </div>
  );
}
