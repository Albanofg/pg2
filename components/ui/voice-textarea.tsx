"use client";

import { useDictation } from "@/lib/hooks/use-dictation";
import { cn } from "@/lib/utils";

/**
 * A textarea the inventor can type OR speak into. The mic (when the browser
 * supports speech) sits in the bottom-right corner; dictated text is appended to
 * the current value. Use anywhere the inventor supplies words in their own voice.
 */
export function VoiceTextarea({
  value,
  onChange,
  className,
  disabled,
  ...props
}: Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const { supported, listening, toggle } = useDictation((chunk) =>
    onChange(value ? `${value} ${chunk}` : chunk),
  );
  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(supported && "pr-10", className)}
        {...props}
      />
      {supported && (
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          title={listening ? "Stop listening" : "Speak instead of typing"}
          aria-label={listening ? "Stop voice input" : "Start voice input"}
          className={cn(
            "absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md border transition-colors duration-150 ease-util disabled:opacity-50",
            listening
              ? "animate-pulse border-red-500/60 bg-red-500/15 text-red-300"
              : "border-border bg-bg/80 text-ink-muted hover:border-accent hover:text-accent",
          )}
        >
          <MicIcon />
        </button>
      )}
    </div>
  );
}

export function MicIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
