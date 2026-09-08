import { useEffect } from "react";
import { DuckIcon } from "./DuckIcon";

interface Props {
  /** What has been recognised so far (may be empty) */
  transcript: string;
  /** Microphone loudness 0..1 */
  level: number;
  lang: string;
  canSend: boolean;
  onSend: () => void;
  onCancel: () => void;
}

/**
 * Full-screen "talk to the duck" stage shown while dictating. The duck grows with the
 * microphone level, the transcript appears under it, Enter sends and Esc cancels.
 */
export function DuckStage({ transcript, level, lang, canSend, onSend, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (canSend) onSend();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSend, onCancel, canSend]);

  const scale = 1 + Math.min(level, 1) * 0.18;
  const tilt = (Math.min(level, 1) * 6).toFixed(1);

  return (
    <div className="duck-stage" role="dialog" aria-label="Talking to the duck">
      <div className="duck-stage-duck" style={{ transform: `scale(${scale.toFixed(3)}) rotate(-${tilt}deg)` }}>
        <DuckIcon size={320} />
      </div>
      <div className="duck-stage-ring" style={{ transform: `scale(${(1 + level * 0.6).toFixed(3)})`, opacity: 0.25 + level * 0.5 }} />
      <p className={`duck-stage-text ${transcript ? "" : "empty"}`}>{transcript || "I'm listening…"}</p>
      <div className="duck-stage-actions">
        <button className="ghost" onClick={onCancel}>
          Cancel <kbd>Esc</kbd>
        </button>
        <button className="primary" onClick={onSend} disabled={!canSend}>
          Send <kbd>Enter</kbd>
        </button>
      </div>
      <p className="duck-stage-hint">Speaking {lang}. Keep talking; the duck files it when you send.</p>
    </div>
  );
}
