import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/graph";
import { useSpeech } from "../useSpeech";
import { DuckIcon } from "./DuckIcon";

export interface PendingMessage {
  id: number;
  text: string;
  status: "sending" | "queued";
}

interface Props {
  messages: ChatMessage[];
  /** Messages sent but not yet answered, shown right after the saved history */
  pending: PendingMessage[];
  busy: boolean;
  error: string | null;
  disabledReason: string | null;
  guide: boolean;
  /** Text to put back into the box (e.g. after a failed send); the key makes repeats distinct */
  restore?: { key: number; text: string } | null;
  onGuideChange: (on: boolean) => void;
  onCollapse: () => void;
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, pending, busy, error, disabledReason, guide, restore, onGuideChange, onCollapse, onSend }: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const speech = useSpeech();
  // what was in the box when dictation started; the transcript is appended to it
  const dictationBase = useRef("");

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending.length, busy]);

  useEffect(() => {
    if (!restore) return;
    setText((t) => (t.trim() ? `${restore.text}\n${t}` : restore.text));
  }, [restore]);

  useEffect(() => {
    if (!speech.listening) return;
    const base = dictationBase.current;
    setText(base && speech.transcript ? `${base} ${speech.transcript}` : base || speech.transcript);
  }, [speech.transcript, speech.listening]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (speech.listening) speech.stop();
    onSend(t);
    setText("");
  };

  const toggleDictation = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    dictationBase.current = text.trim();
    speech.start();
  };

  return (
    <aside className="chat">
      <div className="chat-head">
        <button className="collapse" onClick={onCollapse} title="Hide the chat panel" aria-label="Hide the chat panel">
          ‹
        </button>
        <label className="toggle" title={guide ? "The duck files your ideas, asks questions, and pushes back on what it doubts" : "The duck only files what you say; no opinions"}>
          <input type="checkbox" checked={guide} onChange={(e) => onGuideChange(e.target.checked)} />
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-thumb" />
          </span>
          <span className="toggle-text">
            AI guidance <b>{guide ? "on" : "off"}</b>
          </span>
        </label>
        <span className="chat-mode">{guide ? "Files your ideas, then asks, observes, and pushes back" : "Files your ideas only"}</span>
      </div>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && pending.length === 0 && (
          <div className="chat-empty">
            <DuckIcon size={72} className="duck" />
            <p>Explain what you're thinking to the duck, one piece at a time.</p>
            <p>
              {guide
                ? "It maps what you say onto the canvas, then adds questions, observations, and challenges to anything it doubts."
                : "It files what you say as cards on the canvas. Turn on AI guidance if you want it to weigh in."}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={`${m.ts}-${i}`} className={`msg ${m.role}`}>
            {m.role === "assistant" && <DuckIcon size={22} className="avatar" />}
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.id} className={`msg user pending ${p.status}`}>
            <div className="bubble">
              {p.text}
              <span className="status">{p.status === "sending" ? "Sending…" : "Queued"}</span>
            </div>
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <DuckIcon size={22} className="avatar" />
            <div className="bubble thinking">{guide ? "Thinking…" : "Filing…"}</div>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        {speech.error && <div className="chat-error">{speech.error}</div>}
      </div>
      {disabledReason && <div className="chat-warn">{disabledReason}</div>}
      <div className="chat-input">
        <textarea
          value={text}
          placeholder={speech.listening ? "Listening… speak, then press Enter to send" : "What's on your mind? (Enter to send, Shift+Enter for a new line)"}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="chat-actions">
          {speech.supported && (
            <button
              type="button"
              className={`mic ${speech.listening ? "on" : ""}`}
              onClick={toggleDictation}
              title={speech.listening ? "Stop dictation" : `Dictate (${speech.lang})`}
              aria-label={speech.listening ? "Stop dictation" : "Start dictation"}
              aria-pressed={speech.listening}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                <path d="M5 11a7 7 0 0 0 14 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 18v3M9 21h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button onClick={submit} disabled={!text.trim()}>
            {busy || pending.length ? "Queue" : "Send"}
          </button>
        </div>
      </div>
    </aside>
  );
}
