"use client";

import { useEffect, useRef, useState } from "react";

const MIN_HEIGHT = 44;
const MAX_HEIGHT = 420;
const DEFAULT_HEIGHT = 60;

/**
 * The always-on Helper input. The inventor can type to the assistant at any
 * point in any module. Pinned at the foot of the panel, it grows UPWARD: drag
 * the handle on top edge up to enlarge it (native resize only grows downward,
 * which runs off-screen here). Enter sends; Shift+Enter makes a newline.
 */
export default function HelperComposer({
  placeholder,
  busy,
  onSend,
}: {
  placeholder: string;
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const start = useRef({ y: 0, h: DEFAULT_HEIGHT });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      // Dragging up (smaller clientY) enlarges the box.
      const delta = start.current.y - e.clientY;
      setHeight(
        Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, start.current.h + delta)),
      );
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragging.current = true;
    start.current = { y: e.clientY, h: height };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    e.preventDefault();
  };

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    onSend(t);
  };

  return (
    <div>
      {/* Drag handle — pull up to enlarge. */}
      <div
        onMouseDown={startDrag}
        title="Drag up to enlarge"
        className="group flex h-3 cursor-ns-resize items-center justify-center"
        role="separator"
        aria-orientation="horizontal"
      >
        <div className="h-1 w-10 rounded-full bg-ink-muted/40 transition-colors group-hover:bg-accent" />
      </div>

      <div className="flex items-end gap-2 rounded-md border border-border bg-bg px-3 py-2 focus-within:border-accent">
        <span className="select-none pb-1 font-mono text-sm text-accent">&gt;</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          style={{ height }}
          placeholder={placeholder}
          className="flex-1 resize-none overflow-y-auto bg-transparent font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-ink-muted disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
