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

export type ButtonSize = "sm" | "md" | "touch";

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 rounded-lg px-3 py-1.5",
  md: "min-h-10 rounded-xl px-4 py-2",
  touch: "min-h-11 rounded-xl px-4 py-2 md:min-h-10",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", icon: Icon, loading = false, className, children, onClick, type = "button", ...rest },
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
        "inline-flex max-w-full cursor-pointer items-center justify-center gap-2 text-center text-sm leading-tight font-medium [overflow-wrap:anywhere] outline-hidden transition-colors",
        "disabled:cursor-not-allowed disabled:not-aria-busy:opacity-50 aria-busy:cursor-progress",
        SIZES[size],
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

export type IconButtonSize = "compact" | "md" | "touch";

export const ICON_BUTTON_SIZES: Record<IconButtonSize, string> = {
  compact: "size-6 min-h-6 rounded-md",
  md: "size-8 min-h-8 rounded-lg",
  touch: "size-8 min-h-8 rounded-lg max-sm:size-10 max-sm:min-h-10",
};

export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: IconButtonSize }
>(function IconButton({ icon: Icon, label, size = "md", className, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center text-muted outline-hidden transition-colors hover:bg-foreground/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-foreground/8",
        ICON_BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
});
