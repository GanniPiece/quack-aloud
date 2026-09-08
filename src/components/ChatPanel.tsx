import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/graph";
import { useSpeech } from "../useSpeech";
import { DuckIcon } from "./DuckIcon";
import { DuckStage, SPEECH_LANGS } from "./DuckStage";

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

const LANG_KEY = "quackaloud.speechLang";

function defaultSpeechLang(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  const nav = navigator.language || "en-US";
  if (nav.toLowerCase().startsWith("zh")) return nav.toLowerCase().includes("cn") ? "zh-CN" : "zh-TW";
  return SPEECH_LANGS.some((l) => l.code === nav) ? nav : "en-US";
}

export function ChatPanel({ messages, pending, busy, error, disabledReason, guide, restore, onGuideChange, onCollapse, onSend }: Props) {
  const [text, setText] = useState("");
  const [stageOpen, setStageOpen] = useState(false);
  const [speechLang, setSpeechLang] = useState(defaultSpeechLang);
  const listRef = useRef<HTMLDivElement>(null);
  const speech = useSpeech(speechLang);
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

  const submit = useCallback(() => {
    const t = text.trim();
    if (!t) return;
    if (speech.listening) speech.stop();
    onSend(t);
    setText("");
  }, [text, speech, onSend]);

  const toggleDictation = useCallback(() => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    dictationBase.current = text.trim();
    speech.start();
  }, [speech, text]);

  const openStage = useCallback(() => setStageOpen(true), []);

  const closeStage = useCallback(() => {
    if (speech.listening) speech.stop();
    setStageOpen(false);
  }, [speech]);

  const changeLang = useCallback((lang: string) => {
    setSpeechLang(lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* ignore */
    }
  }, []);

  const lastReply = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? null;

  return (
    <aside className="chat">
      {stageOpen && (
        <DuckStage
          text={text}
          onTextChange={setText}
          reply={lastReply}
          busy={busy || pending.length > 0}
          guide={guide}
          speechSupported={speech.supported}
          listening={speech.listening}
          level={speech.level}
          lang={speechLang}
          onLangChange={changeLang}
          onToggleMic={toggleDictation}
          onSend={submit}
          onClose={closeStage}
        />
      )}
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
        <button className="talk" onClick={openStage} title="Talk to the duck: type or speak on a full-screen stage">
          <DuckIcon size={22} />
          <span>
            <b>Talk to the duck</b>
            <small>{text.trim() ? `Draft: ${text.trim().slice(0, 40)}${text.trim().length > 40 ? "…" : ""}` : "Type or speak, full screen"}</small>
          </span>
        </button>
      </div>
    </aside>
  );
}
