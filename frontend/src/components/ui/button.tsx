"use client";

import { LoaderCircle, type LucideIcon } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "outline" | "primary" | "secondary" | "ghost" | "danger";

function variantClasses(variant: ButtonVariant): string {
  return cn(
    variant === "outline" && "border border-border-strong bg-surface text-foreground hover:bg-button-hover",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary-hover",
    variant === "secondary" && "bg-secondary text-foreground hover:bg-secondary-hover",
    variant === "ghost" && "bg-transparent text-muted hover:bg-foreground/5 hover:text-foreground",
    variant === "danger" && "bg-danger-bg text-danger hover:bg-danger-bg-hover",
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", icon: Icon, loading = false, className, children, onClick, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(event) => {
        if (loading) event.preventDefault();
        else onClick?.(event);
      }}
      className={cn(
        "inline-flex min-h-10 max-w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-center text-sm leading-tight font-medium [overflow-wrap:anywhere] outline-hidden transition-colors",
        "disabled:cursor-not-allowed disabled:not-aria-busy:opacity-50 aria-busy:cursor-progress",
        variantClasses(variant),
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : Icon ? (
        <Icon className="size-4 shrink-0" aria-hidden />
      ) : null}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }
>(function IconButton({ icon: Icon, label, className, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 min-h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted outline-hidden transition-colors hover:bg-foreground/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-foreground/8",
        className,
      )}
      {...rest}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
});
