import { useEffect, useRef } from "react";
import { DuckIcon } from "./DuckIcon";

export const SPEECH_LANGS: { code: string; label: string }[] = [
  { code: "zh-TW", label: "中文（台灣）" },
  { code: "zh-CN", label: "中文（中国）" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "ja-JP", label: "日本語" },
];

interface Props {
  /** The box contents: typed text plus whatever dictation has recognised so far */
  text: string;
  onTextChange: (text: string) => void;
  /** The duck's latest reply, shown under it */
  reply: string | null;
  busy: boolean;
  guide: boolean;
  speechSupported: boolean;
  listening: boolean;
  level: number;
  lang: string;
  onLangChange: (lang: string) => void;
  onToggleMic: () => void;
  onSend: () => void;
  onClose: () => void;
}

/**
 * Full-screen "talk to the duck" mode. Typing and dictation both happen here; the duck grows
 * with the microphone level and answers under itself. Enter sends, Esc closes.
 */
export function DuckStage({
  text,
  onTextChange,
  reply,
  busy,
  guide,
  speechSupported,
  listening,
  level,
  lang,
  onLangChange,
  onToggleMic,
  onSend,
  onClose,
}: Props) {
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => box.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  // Keep focus in the box so Enter always sends, unless the user is on the language picker
  useEffect(() => {
    if (!listening) return;
    box.current?.focus();
  }, [listening, text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scale = 1 + Math.min(level, 1) * 0.18;
  const tilt = (Math.min(level, 1) * 6).toFixed(1);
  const canSend = text.trim().length > 0;

  return (
    <div className={`duck-stage ${busy ? "busy" : ""} ${listening ? "listening" : ""}`} role="dialog" aria-label="Talking to the duck">
      <button className="duck-stage-close ghost" onClick={onClose} title="Back to the canvas (Esc)">
        Back to canvas <kbd>Esc</kbd>
      </button>
      <div className="duck-stage-top">
        <div className="duck-stage-ring" style={{ transform: `scale(${(1 + level * 0.6).toFixed(3)})`, opacity: 0.25 + level * 0.5 }} />
        <div className="duck-stage-duck" style={{ transform: `scale(${scale.toFixed(3)}) rotate(-${tilt}deg)` }}>
          <DuckIcon size={240} />
        </div>
        <p className={`duck-stage-reply ${busy || !reply ? "muted" : ""}`}>
          {busy ? (guide ? "Thinking…" : "Filing…") : reply ?? (listening ? "I'm listening…" : "Tell me what's on your mind.")}
        </p>
      </div>
      <div className="duck-stage-input">
        <textarea
          ref={box}
          value={text}
          rows={3}
          placeholder={listening ? "Speak, or type; Enter sends" : "Type, or press the microphone; Enter sends, Shift+Enter for a new line"}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        <div className="duck-stage-actions">
          {speechSupported && (
            <>
              <select
                className="duck-stage-lang"
                value={lang}
                title="Speech recognition language"
                onChange={(e) => onLangChange(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {SPEECH_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
                {!SPEECH_LANGS.some((l) => l.code === lang) && <option value={lang}>{lang}</option>}
              </select>
              <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={onToggleMic} title={listening ? "Stop dictation" : "Dictate"} aria-pressed={listening}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                  <path d="M5 11a7 7 0 0 0 14 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M12 18v3M9 21h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {listening ? "Listening" : "Speak"}
              </button>
            </>
          )}
          <button className="primary" onClick={onSend} disabled={!canSend}>
            {busy ? "Queue" : "Send"} <kbd>Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
