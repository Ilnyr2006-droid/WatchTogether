"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import type { Socket } from "socket.io-client";
import type { ChatMessage, ClientToServerEvents, ServerToClientEvents } from "@/types/realtime";

export function ChatPanel({ socket, initialMessages = [] }: { socket: Socket<ServerToClientEvents, ClientToServerEvents>; initialMessages?: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const receive = (message: ChatMessage) => setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current.slice(-99), message]);
    socket.on("chat:message", receive);
    return () => { socket.off("chat:message", receive); };
  }, [socket]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    socket.emit("chat:send", { text: value }, (response) => { if (response.ok) { setText(""); setError(""); } else setError(response.error); });
  }

  return <section className="panel flex min-h-[20rem] flex-col overflow-hidden"><div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><MessageCircle className="size-4 text-violet-400" /><h2 className="font-semibold">Чат</h2></div><div className="flex-1 space-y-3 overflow-y-auto p-4">{messages.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Здесь появятся сообщения комнаты</p>}{messages.map((message) => <div key={message.id}><div className="flex items-baseline gap-2"><span className="text-sm font-semibold text-violet-300">{message.username}</span><time className="text-[10px] text-slate-600">{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p className="mt-0.5 break-words text-sm text-slate-300">{message.text}</p></div>)}<div ref={endRef} /></div><form className="border-t border-white/10 p-3" onSubmit={submit}><div className="flex gap-2"><input className="input py-2.5" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Сообщение…" /><button className="button-primary px-3 py-2" disabled={!text.trim()} aria-label="Отправить"><Send className="size-4" /></button></div>{error && <p className="mt-2 text-xs text-red-300">{error}</p>}</form></section>;
}
