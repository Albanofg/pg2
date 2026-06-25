"use client";

import { useState } from "react";
import type { HelperQuestion, HelperTurn } from "@/lib/modules/shared";

/**
 * The Helper's reply area — a running thread of the Helper's short replies and
 * the inventor's own messages. This is where the Helper TALKS to the inventor
 * (answers, teaches, brainstorms) in EVERY module, instead of silently filing
 * notes. Shared across all five module panels.
 *
 * Replying is fast by design: when the Helper asks something, it asks at most ONE
 * short question and proposes a few tap-to-answer options (the inventor can always
 * type their own). Only the latest question is interactive; older ones read as
 * history. `onQuickReply` sends the chosen answer back through the same channel as
 * the composer.
 */
export default function HelperThread({
  turns,
  onQuickReply,
  busy = false,
}: {
  turns: HelperTurn[];
  onQuickReply?: (text: string) => void;
  busy?: boolean;
}) {
  if (!turns || turns.length === 0) return null;
  let lastHelperIdx = -1;
  turns.forEach((t, i) => {
    if (t.role === "helper") lastHelperIdx = i;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        Helper
      </div>
      {turns.map((t, i) =>
        t.role === "helper" ? (
          <div key={i} className="rounded-md border border-action/30 bg-action/5 p-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
              Helper
            </div>
            <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
              {t.text}
            </p>
            {t.question?.ask && (
              <QuestionBlock
                question={t.question}
                interactive={i === lastHelperIdx && !!onQuickReply}
                busy={busy}
                onAnswer={(text) => onQuickReply?.(text)}
              />
            )}
            {/* Legacy stored turns only — newer turns use `question`. */}
            {!t.question?.ask && t.teaching && t.teaching.length > 0 && (
              <ul className="mt-2 space-y-1">
                {t.teaching.map((tp, j) => (
                  <li key={j} className="font-mono text-[11px] leading-relaxed text-accent">
                    {tp.ask}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-md border border-border bg-panel px-3 py-2">
              <div className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-ink-muted">
                You
              </div>
              <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
                {t.text}
              </p>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * One short question with tap-to-answer options + a free-text fallback. When not
 * interactive (it's an older turn), it just shows the question for context.
 */
export function QuestionBlock({
  question,
  interactive,
  busy,
  onAnswer,
}: {
  question: HelperQuestion;
  interactive: boolean;
  busy: boolean;
  onAnswer: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const send = (value: string) => {
    const v = value.trim();
    if (!v || busy) return;
    onAnswer(v);
    setText("");
  };
  return (
    <div className="mt-3 rounded-md border border-border bg-bg/40 p-3">
      <div className="font-sans text-xs font-semibold text-ink">{question.ask}</div>
      {question.why && (
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-muted">{question.why}</p>
      )}
      {!interactive ? null : (
        <>
          {question.options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {question.options.map((opt, j) => (
                <button
                  key={j}
                  type="button"
                  onClick={() => send(opt)}
                  disabled={busy}
                  className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[11px] text-ink hover:bg-accent/20 disabled:opacity-50"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send(text);
                }
              }}
              placeholder="…or type your own"
              className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => send(text)}
              disabled={busy || !text.trim()}
              className="shrink-0 rounded-md bg-accent px-2.5 py-1 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
