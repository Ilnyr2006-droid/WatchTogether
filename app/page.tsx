"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Link2, Loader2, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { useSocket } from "@/hooks/use-socket";
import { buildInvitation, isPublicIpv4Text, parseInvitation } from "@/lib/invite";

interface NetworkInfo { publicBaseUrl: string | null; publicIp: string | null; port: number }

function HomeContent() {
  const router = useRouter(); const searchParams = useSearchParams(); const { socket, connected } = useSocket();
  const [username, setUsername] = useState(""); const [inviteInput, setInviteInput] = useState("");
  const [manualPublicIp, setManualPublicIp] = useState(""); const [needsManualIp, setNeedsManualIp] = useState(false);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const validName = username.trim().length > 0 && username.trim().length <= 32;
  const roomFromQuery = searchParams.get("room") ?? ""; const tokenFromQuery = searchParams.get("token") ?? "";
  const queryInvitation = typeof window !== "undefined" && /^[a-z0-9]{10}$/.test(roomFromQuery)
    ? parseInvitation(`${window.location.origin}/room/${roomFromQuery}?token=${encodeURIComponent(tokenFromQuery)}`)?.url ?? "" : "";
  const displayedInvitation = inviteInput || queryInvitation;

  async function createRoom(manualIp?: string) {
    if (!validName || !connected) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/network-info", { cache: "no-store" });
      if (!response.ok) throw new Error("network lookup failed");
      const network = await response.json() as NetworkInfo;
      const chosenIp = manualIp?.trim() || network.publicIp;
      if (!network.publicBaseUrl && (!chosenIp || !isPublicIpv4Text(chosenIp))) {
        setNeedsManualIp(true); setError("Не удалось определить внешний IPv4. Укажите белый публичный IP вручную."); return;
      }
      const baseUrl = network.publicBaseUrl || `http://${chosenIp}:${network.port}`;
      sessionStorage.setItem("watchtogether:username", username.trim());
      socket.emit("room:create", { username: username.trim() }, (created) => {
        setLoading(false);
        if (!created.ok) return setError(created.error);
        const invitation = buildInvitation(baseUrl, created.data.roomId, created.data.roomToken);
        sessionStorage.setItem(`watchtogether:room-token:${created.data.roomId}`, created.data.roomToken);
        sessionStorage.setItem(`watchtogether:owner-token:${created.data.roomId}`, created.data.ownerToken);
        sessionStorage.setItem(`watchtogether:invitation:${created.data.roomId}`, invitation);
        sessionStorage.setItem("watchtogether:network", JSON.stringify(network));
        router.push(`/room/${created.data.roomId}?token=${encodeURIComponent(created.data.roomToken)}`);
      });
    } catch { setLoading(false); setNeedsManualIp(true); setError("Не удалось определить внешний IPv4. Проверьте интернет или укажите IP вручную."); }
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    const invitation = parseInvitation(displayedInvitation);
    if (!validName || !invitation) return setError("Введите имя и полную корректную ссылку-приглашение");
    if (invitation.origin !== window.location.origin) { window.location.assign(invitation.url); return; }
    sessionStorage.setItem("watchtogether:username", username.trim());
    sessionStorage.setItem(`watchtogether:room-token:${invitation.roomId}`, invitation.roomToken);
    router.push(`/room/${invitation.roomId}?token=${encodeURIComponent(invitation.roomToken)}`);
  }

  return <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-12">
    <div className="pointer-events-none absolute left-1/2 top-[-20rem] h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-violet-700/20 blur-3xl" />
    <section className="relative w-full max-w-lg"><div className="mb-10 flex justify-center"><Logo /></div><div className="panel p-6 sm:p-8">
      <div className="mb-7 text-center"><h1 className="text-3xl font-bold">Кино ближе, когда вы вместе</h1><p className="mt-3 text-slate-400">Домашний Host-сервер, синхронный просмотр, голос и чат.</p></div>
      <label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="username">Ваше имя</label><input id="username" className="input" value={username} maxLength={32} onChange={(event) => setUsername(event.target.value)} placeholder="Например, Алекс" autoComplete="name" />
      <button className="button-primary mt-4 w-full" disabled={!validName || !connected || loading} onClick={() => { void createRoom(needsManualIp ? manualPublicIp : undefined); }}>{loading ? <Loader2 className="size-5 animate-spin" /> : <Users className="size-5" />}Создать комнату</button>
      {needsManualIp && <div className="mt-3"><label className="mb-2 block text-xs text-slate-400" htmlFor="publicIp">Публичный IPv4 вручную</label><input id="publicIp" className="input font-mono" value={manualPublicIp} onChange={(event) => setManualPublicIp(event.target.value)} placeholder="95.123.45.67" /></div>}
      <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-widest text-slate-600"><span className="h-px flex-1 bg-white/10" />или подключиться<span className="h-px flex-1 bg-white/10" /></div>
      <form onSubmit={joinRoom}><label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="invitation">Ссылка-приглашение</label><div className="flex gap-2"><div className="relative flex-1"><Link2 className="absolute left-3 top-3.5 size-5 text-slate-500" /><input id="invitation" className="input pl-10" value={displayedInvitation} onChange={(event) => setInviteInput(event.target.value)} placeholder="https://watch.example.com/room/…?token=…" /></div><button className="button-secondary px-4" disabled={!validName} aria-label="Подключиться"><ArrowRight /></button></div></form>
      {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      <p className="mt-5 text-center text-xs text-slate-500"><span className={`mr-1 inline-block size-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />{connected ? "Сервер доступен" : "Подключение к серверу…"}</p>
    </div><p className="mt-5 text-center text-xs text-slate-600">Используйте только видео, на просмотр которых у вас есть право.</p></section>
  </main>;
}

export default function HomePage() { return <Suspense fallback={<main className="grid min-h-screen place-items-center text-slate-400">Подключение…</main>}><HomeContent /></Suspense>; }
