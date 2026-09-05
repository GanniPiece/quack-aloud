import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (Chrome ships it as webkitSpeechRecognition)
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechState {
  supported: boolean;
  listening: boolean;
  /** Text recognised so far in this session: final parts plus the current interim guess */
  transcript: string;
  error: string | null;
  lang: string;
  start: () => void;
  stop: () => void;
}

/**
 * Dictation through the browser's speech recognition. The caller appends `transcript`
 * to whatever was typed before `start()`; it is replaced (not appended) on every update
 * so interim guesses can be corrected by the recogniser.
 */
export function useSpeech(lang: string = navigator.language || "en-US"): SpeechState {
  const [supported] = useState(() => getCtor() !== null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    let finals = "";
    r.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finals += res[0].transcript;
        else interim += res[0].transcript;
      }
      setTranscript(finals + interim);
    };
    r.onerror = (ev) => {
      setError(
        ev.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in the browser and try again."
          : ev.error === "network"
            ? "Speech recognition needs a network connection."
            : `Speech recognition error: ${ev.error}`,
      );
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    setTranscript("");
    setError(null);
    setListening(true);
    try {
      r.start();
    } catch (err) {
      rec.current = null;
      setListening(false);
      setError((err as Error).message);
    }
  }, [lang]);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported, listening, transcript, error, lang, start, stop };
}
