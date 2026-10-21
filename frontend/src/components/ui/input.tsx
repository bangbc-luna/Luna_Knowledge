"use client";

import { Search } from "lucide-react";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

const INPUT =
  "h-11 w-full min-w-0 rounded-xl border bg-surface px-4 text-base text-foreground outline-hidden transition-colors placeholder:text-muted focus:ring-2 md:h-10 md:text-sm";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          INPUT,
          invalid ? "border-err-line focus:ring-err-line/10" : "border-border-strong focus:border-focus focus:ring-focus",
          className,
        )}
        {...rest}
      />
    );
  },
);

export function SearchInput({ label, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("relative block min-w-0", className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input type="search" className="pl-10" {...rest} />
    </label>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-sm text-err-text">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
