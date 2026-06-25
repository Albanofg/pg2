"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MicIcon } from "@/components/ui/voice-textarea";
import { useDictation } from "@/lib/hooks/use-dictation";
import { cn } from "@/lib/utils";

/** Compact cap before the box stops auto-growing — use Maximize for more room. */
const MAX_AUTO = 220;

/**
 * The always-on Helper input. Type, paste, or SPEAK at any point. It auto-grows
 * to fit what you write (compact when short — no wasted space) and has a
 * Maximize button that expands it to a full-screen writing surface. Enter sends;
 * Shift+Enter makes a newline. An example chip seeds it via `seedText`/`seedNonce`.
 */
export default function HelperComposer({
  placeholder,
  busy,
  onSend,
  seedText,
  seedNonce,
}: {
  placeholder: string;
  busy: boolean;
  onSend: (text: string) => void;
  /** Text to drop into the box (e.g. from an example chip). */
  seedText?: string;
  /** Bump to re-apply the same seedText again. */
  seedNonce?: number;
}) {
  const [text, setText] = useState("");
  const [maximized, setMaximized] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { supported: voiceSupported, listening, toggle, stop } = useDictation(
    (chunk) => setText((prev) => (prev ? `${prev} ${chunk}` : chunk)),
  );

  // Seed from an example chip (panel-driven). Keyed on the nonce.
  useEffect(() => {
    if (seedNonce === undefined) return;
    if (seedText !== undefined) setText(seedText);
    taRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce]);

  // Auto-size to fit content (compact when short). In maximized mode the box
  // fills its container via flex, so we clear the inline height.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (maximized) {
      ta.style.height = "";
      return;
    }
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_AUTO)}px`;
  }, [text, maximized]);

  const toggleVoice = () => {
    toggle();
    taRef.current?.focus();
  };

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    stop();
    setText("");
    setMaximized(false);
    onSend(t);
  };

  const box = (
    <div
      className={cn(
        "rounded-md border border-border bg-bg focus-within:border-accent",
        maximized && "flex h-full flex-col",
      )}
    >
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && maximized) {
            setMaximized(false);
          }
        }}
        disabled={busy}
        rows={1}
        placeholder={placeholder}
        className={cn(
          "block w-full resize-none overflow-y-auto bg-transparent px-3 pt-2.5 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-ink-muted disabled:opacity-50",
          maximized && "min-h-0 flex-1",
        )}
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {voiceSupported && (
            <button
              onClick={toggleVoice}
              title={listening ? "Stop listening" : "Speak instead of typing"}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ease-util",
                listening
                  ? "animate-pulse border-red-500/60 bg-red-500/15 text-red-300"
                  : "border-border text-ink-muted hover:border-accent hover:text-accent",
              )}
            >
              <MicIcon />
            </button>
          )}
          <button
            onClick={() => setMaximized((v) => !v)}
            title={maximized ? "Shrink (Esc)" : "Expand to full screen"}
            aria-label={maximized ? "Shrink the editor" : "Expand the editor to full screen"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted transition-colors duration-150 ease-util hover:border-accent hover:text-accent"
          >
            {maximized ? <MinimizeIcon /> : <MaximizeIcon />}
          </button>
          <span className="truncate select-none font-mono text-[10px] text-ink-muted">
            {listening
              ? "Listening… tap the mic to stop"
              : "Enter to send · Shift+Enter for a new line"}
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={busy || !text.trim()}
        >
          Send
        </Button>
      </div>
    </div>
  );

  if (maximized) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-bg/95 p-4 backdrop-blur-sm">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col">{box}</div>
      </div>
    );
  }

  return box;
}

function MaximizeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
