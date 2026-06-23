"use client";

import { useCallback, useState } from "react";
import { useWorkspace } from "@/lib/store";
import { phaseLabel, type PhaseKey } from "@/lib/utils";

/**
 * Drives the Socratic Helper conversation. Sends a turn to /api/chat and
 * consumes a newline-delimited JSON event stream:
 *   {type:"token", value}            -> append to the Helper bubble
 *   {type:"phase", value}            -> advance the phase rail
 *   {type:"idea", value}             -> update the distilled Current Idea
 *   {type:"mesh", value}             -> terminal log line (drafter/verifier)
 *   {type:"node", value:{...}}       -> upsert a Live Draft node
 *   {type:"invalidate", value:[...]} -> disavowal cascade
 *   {type:"done"}                    -> end of turn
 */
export function useChat() {
  const [pending, setPending] = useState(false);
  const store = useWorkspace;

  const send = useCallback(
    async (text: string, quote?: string) => {
      const s = store.getState();
      if (!text.trim() || pending) return;
      setPending(true);

      const userMsgId = crypto.randomUUID();
      s.addMessage({
        id: userMsgId,
        role: "user",
        content: text,
        isDisavowal: !!quote,
        quote,
      });
      s.addMessage({ id: crypto.randomUUID(), role: "helper", content: "" });
      s.setInput("");
      s.setPendingQuote(null);
      s.setMesh({ active: true });
      s.clearMeshLog();

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: s.projectId,
            phase: s.phase,
            message: text,
            disavowedQuote: quote ?? null,
            history: s.messages.slice(-12).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!res.ok || !res.body) throw new Error("chat request failed");
        s.setConnection("online");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            handleEvent(line);
          }
        }
        if (buffer.trim()) handleEvent(buffer);
      } catch {
        store.getState().setConnection("reconnecting");
        store
          .getState()
          .appendToLastHelperMessage(
            "\n\n[Connection interrupted. Your inputs are preserved locally — try again.]"
          );
      } finally {
        store.getState().setMesh({ active: false });
        setPending(false);
      }
    },
    [pending, store]
  );

  return { send, pending };
}

function handleEvent(line: string) {
  const s = useWorkspace.getState();
  let evt: any;
  try {
    evt = JSON.parse(line);
  } catch {
    return;
  }
  switch (evt.type) {
    case "token":
      s.appendToLastHelperMessage(evt.value);
      break;
    case "phase":
      s.setPhase(evt.value as PhaseKey);
      break;
    case "idea":
      s.setCurrentIdea(evt.value);
      break;
    case "mesh":
      s.pushMeshLog(evt.value);
      break;
    case "node":
      s.upsertDraftNode({
        nodeKey: evt.value.nodeKey,
        label: phaseLabel(evt.value.nodeKey) || evt.value.nodeKey,
        draftOutput: evt.value.draftOutput ?? null,
        isVerified: !!evt.value.isVerified,
        invalidated: false,
      });
      break;
    case "invalidate":
      s.invalidateNodes(evt.value as string[]);
      break;
    default:
      break;
  }
}
