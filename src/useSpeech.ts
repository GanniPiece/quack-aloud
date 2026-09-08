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
  /** Microphone loudness 0..1 while listening, for the duck to react to */
  level: number;
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
  const [level, setLevel] = useState(0);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const meter = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);

  const stopMeter = useCallback(() => {
    const m = meter.current;
    meter.current = null;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close();
    setLevel(0);
  }, []);

  /** Best effort: a level meter on the microphone. Recognition works without it. */
  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const entry = { ctx, stream, raf: 0 };
      meter.current = entry;
      const tick = () => {
        if (meter.current !== entry) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 4));
        entry.raf = requestAnimationFrame(tick);
      };
      entry.raf = requestAnimationFrame(tick);
    } catch {
      /* no meter: the duck just idles */
    }
  }, []);

  const stop = useCallback(() => {
    rec.current?.stop();
    stopMeter();
  }, [stopMeter]);

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
      stopMeter();
    };
    rec.current = r;
    setTranscript("");
    setError(null);
    setListening(true);
    try {
      r.start();
      void startMeter();
    } catch (err) {
      rec.current = null;
      setListening(false);
      setError((err as Error).message);
    }
  }, [lang, startMeter, stopMeter]);

  useEffect(
    () => () => {
      rec.current?.abort();
      stopMeter();
    },
    [stopMeter],
  );

  return { supported, listening, transcript, level, error, lang, start, stop };
}
