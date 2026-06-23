"use client";

import { useEffect, useRef } from "react";
import { useWorkspace } from "@/lib/store";
import { useChat } from "@/lib/hooks/use-chat";
import { cn } from "@/lib/utils";

/** The Socratic Helper — the single point of interaction. */
export default function CenterChat() {
  const { messages, input, setInput, pendingQuote, setPendingQuote, mesh } =
    useWorkspace();
  const { send, pending } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, mesh.log]);

  const submit = () => {
    if (!input.trim()) return;
    send(input, pendingQuote ?? undefined);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="flex h-screen flex-col overflow-hidden bg-bg">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {messages.length === 0 && (
            <div className="animate-fade-in pt-6 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.15em] text-action">
                Phase 1 · Core Novelty
              </p>
              <p className="mx-auto mt-4 max-w-md font-mono text-sm leading-relaxed text-ink-muted">
                In one or two sentences, what does your software do that nothing
                else does? Don&apos;t explain how yet — just the surprising
                result.
              </p>
            </div>
          )}

          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} quote={m.quote}>
              {m.content || (m.role === "helper" && pending ? "…" : "")}
            </Bubble>
          ))}
        </div>
      </div>

      {/* Agent thinking state — miniature terminal log */}
      {mesh.active && mesh.log.length > 0 && (
        <div className="border-t border-border bg-panel/60 px-6 py-2">
          <div className="mx-auto max-w-2xl space-y-0.5 font-mono text-[11px] leading-relaxed text-action">
            {mesh.log.slice(-4).map((line, i) => (
              <div key={i} className="animate-fade-in">
                <span className="text-ink-muted">&gt; </span>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pinned command-line input */}
      <div className="border-t border-border bg-panel px-6 py-4">
        <div className="mx-auto max-w-2xl">
          {pendingQuote && (
            <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-action bg-action/10 px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-action">
                Disavowing
              </span>
              <span className="flex-1 font-mono text-xs italic text-ink">
                “{pendingQuote}”
              </span>
              <button
                onClick={() => setPendingQuote(null)}
                className="font-mono text-xs text-ink-muted hover:text-action"
                aria-label="Cancel disavowal"
              >
                ✕
              </button>
            </div>
          )}
          <div
            className={cn(
              "flex items-end gap-2 rounded-md border bg-bg px-4 py-3 transition-colors duration-150 ease-util",
              pending ? "border-action/60" : "border-border focus-within:border-accent"
            )}
          >
            <span className="select-none pb-[2px] font-mono text-sm text-accent">
              &gt;
            </span>
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              disabled={pending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                pending ? "The mesh is working…" : "Articulate your invention…"
              }
              className="max-h-40 flex-1 resize-none bg-transparent font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-ink-muted disabled:opacity-50"
            />
            <button
              onClick={submit}
              disabled={pending || !input.trim()}
              className="shrink-0 rounded bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand transition-colors duration-150 ease-util hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Bubble({
  role,
  quote,
  children,
}: {
  role: "user" | "helper";
  quote?: string;
  children: React.ReactNode;
}) {
  const isHelper = role === "helper";
  return (
    <div className={cn("flex animate-fade-in", isHelper ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[85%]", isHelper ? "" : "items-end")}>
        {quote && (
          <div className="mb-1 border-l-2 border-action/60 pl-2 font-mono text-[11px] italic text-ink-muted">
            “{quote}”
          </div>
        )}
        <div
          className={cn(
            "whitespace-pre-wrap rounded-md px-4 py-3 font-mono text-sm leading-relaxed",
            isHelper
              ? "bg-accent/15 text-ink"
              : "border border-border bg-panel text-ink"
          )}
        >
          {children}
        </div>
        <div
          className={cn(
            "mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted",
            isHelper ? "text-left" : "text-right"
          )}
        >
          {isHelper ? "Helper" : "Inventor"}
        </div>
      </div>
    </div>
  );
}
