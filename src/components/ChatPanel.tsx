import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/graph";
import { DuckIcon } from "./DuckIcon";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  disabledReason: string | null;
  guide: boolean;
  onGuideChange: (on: boolean) => void;
  onCollapse: () => void;
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, busy, error, disabledReason, guide, onGuideChange, onCollapse, onSend }: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
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
        {messages.length === 0 && (
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
        {busy && (
          <div className="msg assistant">
            <DuckIcon size={22} className="avatar" />
            <div className="bubble thinking">{guide ? "Thinking…" : "Filing…"}</div>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
      </div>
      {disabledReason && <div className="chat-warn">{disabledReason}</div>}
      <div className="chat-input">
        <textarea
          value={text}
          placeholder="What's on your mind? (Enter to send, Shift+Enter for a new line)"
          rows={3}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button onClick={submit} disabled={busy || !text.trim()}>
          Send
        </button>
      </div>
    </aside>
  );
}
