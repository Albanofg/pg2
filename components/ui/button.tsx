"use client";

import { cn } from "@/lib/utils";

/**
 * The one button. A clear, visible action with an obvious hierarchy:
 *  - primary   → the most useful action on a surface (solid steel-blue, bold)
 *  - secondary → an alternative action (clearly outlined, readable ink)
 *  - danger    → a destructive action (tinted red, still obviously a button)
 *  - ghost     → a quiet action (cancel, dismiss)
 * Bigger and higher-contrast than the old inline buttons so the inventor always
 * sees what they can do.
 */
type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-brand font-semibold shadow-sm hover:bg-accent/90 active:translate-y-px focus-visible:ring-accent/60",
  secondary:
    "border border-border bg-bg/60 text-ink font-medium hover:border-accent hover:bg-accent/10 focus-visible:ring-accent/40",
  danger:
    "border border-red-500/50 bg-red-500/5 text-red-300 font-medium hover:bg-red-500/15 hover:border-red-500/70 focus-visible:ring-red-500/40",
  ghost:
    "text-ink-muted font-medium hover:text-ink hover:bg-ink/5 focus-visible:ring-accent/30",
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-1.5 text-sm",
  lg: "px-4 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-sans transition-all duration-150 ease-util focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
