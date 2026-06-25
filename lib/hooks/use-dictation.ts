"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal Web Speech API typings — not in the standard DOM lib across setups. */
type SpeechAlternative = { transcript: string };
type SpeechResult = { readonly length: number; [i: number]: SpeechAlternative };
type SpeechResultList = { readonly length: number; [i: number]: SpeechResult };
type SpeechResultEvent = { resultIndex: number; results: SpeechResultList };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser speech-to-text. Calls `onText` with each finalized chunk so any input
 * can let the inventor SPEAK instead of type. `supported` is false where the
 * Web Speech API is unavailable (then the caller hides the mic).
 */
export function useDictation(onText: (chunk: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(!!getSpeechCtor());
    return () => recognition.current?.stop();
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  const toggle = useCallback(() => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        chunk += e.results[i][0].transcript;
      }
      const piece = chunk.trim();
      if (piece) onTextRef.current(piece);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    rec.start();
    setListening(true);
  }, [listening]);

  return { supported, listening, toggle, stop };
}
