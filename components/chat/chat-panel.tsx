"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { Socket } from "socket.io-client";
import type { ChatMessage, ClientToServerEvents, ServerToClientEvents } from "@/types/realtime";

export function ChatPanel({ socket, initialMessages = [] }: { socket: Socket<ServerToClientEvents, ClientToServerEvents>; initialMessages?: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const visibleMessages = useMemo(() => {
    const merged = new Map(messages.map((message) => [message.id, message]));
    initialMessages.forEach((message) => merged.set(message.id, message));
    return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-100);
  }, [initialMessages, messages]);

  useEffect(() => {
    const receive = (message: ChatMessage) => setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current.slice(-99), message]);
    socket.on("chat:message", receive);
    return () => { socket.off("chat:message", receive); };
  }, [socket]);
  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    endRef.current?.scrollIntoView({ behavior });
  }, [visibleMessages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    socket.emit("chat:send", { text: value }, (response) => { if (response.ok) { setText(""); setError(""); } else setError(response.error); });
  }

  return <section className="chat-panel" aria-label="Чат комнаты">
    <div className="chat-heading"><h2>Сообщения</h2><span className="participant-count">{visibleMessages.length}</span></div>
    <div className="chat-messages" role="log" aria-label="Сообщения комнаты" aria-live="polite">
      {visibleMessages.length === 0 && <p className="chat-empty">Начните разговор — здесь появятся сообщения комнаты.</p>}
      {visibleMessages.map((message, index) => {
        const continued = visibleMessages[index - 1]?.username === message.username;
        return <article key={message.id} className={`chat-message ${continued ? "is-continued" : ""}`} data-testid="chat-message">
          <div className="chat-message-meta"><strong>{continued ? <span className="sr-only">{message.username}</span> : message.username}</strong><time dateTime={new Date(message.timestamp).toISOString()}>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
          <p>{message.text}</p>
        </article>;
      })}
      <div ref={endRef} />
    </div>
    <form className="chat-form" onSubmit={submit}>
      <input className="input" aria-label="Сообщение в чате" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} placeholder="Сообщение…" />
      <button className="chat-send" disabled={!text.trim()} aria-label="Отправить"><Send aria-hidden="true" /></button>
    </form>
    {error && <p className="chat-error" role="alert">{error}</p>}
  </section>;
}
