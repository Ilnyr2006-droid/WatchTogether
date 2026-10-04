"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Loader2 } from "lucide-react";
import { ConnectionNotice } from "@/app/connection-notice";
import { ProductPreview } from "@/components/landing/product-preview";
import { Logo } from "@/components/logo";
import { useSocket } from "@/hooks/use-socket";
import { buildInvitation, isPublicIpv4Text, parseInvitation } from "@/lib/invite";

interface NetworkInfo { publicBaseUrl: string | null; publicIp: string | null; port: number }
type EntryFlow = "create" | "join" | null;

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { socket, connected } = useSocket();
  const [username, setUsername] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [manualPublicIp, setManualPublicIp] = useState("");
  const [needsManualIp, setNeedsManualIp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [flow, setFlow] = useState<EntryFlow>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const validName = username.trim().length > 0 && username.trim().length <= 32;
  const roomFromQuery = searchParams.get("room") ?? "";
  const tokenFromQuery = searchParams.get("token") ?? "";
  const queryInvitation = typeof window !== "undefined" && /^[a-z0-9]{10}$/.test(roomFromQuery)
    ? parseInvitation(`${window.location.origin}/room/${roomFromQuery}?token=${encodeURIComponent(tokenFromQuery)}`)?.url ?? "" : "";
  const displayedInvitation = inviteInput || queryInvitation;

  useEffect(() => {
    if (flow) nameInput.current?.focus();
  }, [flow]);

  async function createRoom(manualIp?: string) {
    if (!validName || !connected) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/network-info", { cache: "no-store" });
      if (!response.ok) throw new Error("network lookup failed");
      const network = await response.json() as NetworkInfo;
      const chosenIp = manualIp?.trim() || network.publicIp;
      if (!network.publicBaseUrl && (!chosenIp || !isPublicIpv4Text(chosenIp))) {
        setNeedsManualIp(true);
        setError("Не удалось определить внешний IPv4. Укажите белый публичный IP вручную.");
        return;
      }
      const baseUrl = network.publicBaseUrl || `http://${chosenIp}:${network.port}`;
      sessionStorage.setItem("watchtogether:username", username.trim());
      socket.emit("room:create", { username: username.trim() }, (created) => {
        setLoading(false);
        if (!created.ok) return setError(created.error);
        const invitation = buildInvitation(baseUrl, created.data.roomId, created.data.roomToken);
        sessionStorage.setItem(`watchtogether:room-token:${created.data.roomId}`, created.data.roomToken);
        sessionStorage.setItem(`watchtogether:owner-token:${created.data.roomId}`, created.data.ownerToken);
        sessionStorage.setItem(`watchtogether:participant-id:${created.data.roomId}`, created.data.participantId);
        sessionStorage.setItem(`watchtogether:session-token:${created.data.roomId}`, created.data.sessionToken);
        sessionStorage.setItem(`watchtogether:invitation:${created.data.roomId}`, invitation);
        sessionStorage.setItem("watchtogether:network", JSON.stringify(network));
        router.push(`/room/${created.data.roomId}?token=${encodeURIComponent(created.data.roomToken)}`);
      });
    } catch {
      setLoading(false);
      setNeedsManualIp(true);
      setError("Не удалось определить внешний IPv4. Проверьте интернет или укажите IP вручную.");
    }
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

  function chooseFlow(next: Exclude<EntryFlow, null>) {
    setError("");
    setFlow(next);
  }

  return (
    <main className="landing-shell">
      <ConnectionNotice connected={connected} />
      <div className="landing-atmosphere" aria-hidden="true" />
      <header className="landing-header">
        <a href="#top" aria-label="WatchTogether — наверх"><Logo /></a>
        <nav className="landing-links" aria-label="Навигация">
          <a href="#how-it-works">Как это работает</a>
          <a href="https://github.com/Ilnyr2006-droid/WatchTogether" target="_blank" rel="noreferrer">GitHub <ArrowUpRight aria-hidden="true" /></a>
          <button type="button" className="text-link landing-start" onClick={() => chooseFlow("create")}>Начать <ArrowRight aria-hidden="true" /></button>
        </nav>
        <a className="landing-mobile-menu" href="#how-it-works">Обзор <ArrowDownRight aria-hidden="true" /></a>
      </header>

      <section id="top" className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" />КИНО ВМЕСТЕ, ГДЕ БЫ ВЫ НИ БЫЛИ</p>
          <h1>СМОТРИТЕ<br /><span>ВМЕСТЕ.</span><br />ГДЕ УГОДНО.</h1>
          <p className="hero-description">Один фильм. Разные города.<br />Синхронно, без загрузки файла на чужой сервис.</p>

          {!flow ? (
            <div className="entry-actions">
              <button type="button" className="landing-primary" onClick={() => chooseFlow("create")}>Создать комнату <ArrowRight aria-hidden="true" /></button>
              <button type="button" className="landing-secondary" onClick={() => chooseFlow("join")}>Войти по приглашению <ArrowRight aria-hidden="true" /></button>
            </div>
          ) : (
            <form className="entry-form" aria-label={flow === "create" ? "Создать комнату" : "Войти по приглашению"} onSubmit={flow === "join" ? joinRoom : (event) => { event.preventDefault(); void createRoom(needsManualIp ? manualPublicIp : undefined); }}>
              <div className="entry-form-heading"><span>{flow === "create" ? "НОВАЯ КОМНАТА" : "ВХОД ПО ПРИГЛАШЕНИЮ"}</span><button type="button" className="text-link" onClick={() => { setFlow(null); setError(""); }}>Назад</button></div>
              <label htmlFor="username">Ваше имя</label>
              <input ref={nameInput} id="username" className="input" value={username} maxLength={32} onChange={(event) => setUsername(event.target.value)} placeholder="Например, Алекс" autoComplete="name" />
              {flow === "join" && <><label htmlFor="invitation">Ссылка-приглашение</label><input id="invitation" className="input" value={displayedInvitation} onChange={(event) => setInviteInput(event.target.value)} placeholder="Вставьте ссылку на комнату" type="url" /></>}
              {flow === "create" && needsManualIp && <><label htmlFor="publicIp">Публичный IPv4 вручную</label><input id="publicIp" className="input font-mono" value={manualPublicIp} onChange={(event) => setManualPublicIp(event.target.value)} placeholder="95.123.45.67" /></>}
              <button className="landing-primary entry-submit" disabled={!validName || !connected || loading || (flow === "join" && !displayedInvitation.trim())}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}{flow === "join" ? "Подключиться" : "Создать →"}
              </button>
            </form>
          )}
          {error && <p className="landing-error" role="alert">{error}</p>}
          <p className="server-presence"><span className={`status-dot ${connected ? "is-online" : "is-waiting"}`} />{connected ? "Сервер готов" : "Подключаемся к серверу…"}</p>
        </div>
        <ProductPreview />
        <div className="hero-index" aria-hidden="true">WT—01 <span>WATCH PARTY / 2026</span></div>
      </section>

      <section id="how-it-works" className="editorial-section" aria-label="Возможности WatchTogether">
        <article className="editorial-row">
          <span className="editorial-number">01</span><div><p className="eyebrow">БЕЗ ЛИШНИХ КОПИЙ</p><h2>ЛЮБОЙ ФИЛЬМ.<br /><span>БЕЗ ЗАГРУЗКИ.</span></h2><p>Поделитесь ссылкой или включите фильм с компьютера. Выбирайте источник — комната синхронизирует просмотр.</p></div>
          <div className="editorial-art art-source" aria-hidden="true"><span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" /><span className="art-play"><ArrowRight /></span><span className="art-caption">01 / SOURCE</span></div>
        </article>
        <article className="editorial-row editorial-reverse">
          <span className="editorial-number">02</span><div><p className="eyebrow">ОДИН ОБЩИЙ РИТМ</p><h2>ОДНО ВРЕМЯ.<br /><span>У ВСЕХ.</span></h2><p>Пауза, перемотка и продолжение синхронизируются для каждого участника.</p></div>
          <div className="editorial-art art-sync" aria-hidden="true"><span className="sync-time">00:42:18</span><span className="sync-line"><i /></span><span className="sync-caption">PLAYBACK / IN SYNC</span></div>
        </article>
        <article className="editorial-row">
          <span className="editorial-number">03</span><div><p className="eyebrow">КОМНАТА ДЛЯ СВОИХ</p><h2>ГОЛОС.<br />ЧАТ.<br /><span>ОЧЕРЕДЬ.</span></h2><p>Оставайтесь рядом: обсудите сцену, выберите следующий фильм и смотрите дальше вместе.</p></div>
          <div className="editorial-art art-presence" aria-hidden="true"><div className="presence-card"><span className="presence-avatar">A</span><span>Амалия <small>в комнате</small></span><i /></div><div className="presence-card"><span className="presence-avatar avatar-blue">И</span><span>Ильнур <small>говорит</small></span><i /></div><span className="presence-caption">VOICE / CHAT / QUEUE</span></div>
        </article>
      </section>

      <footer className="landing-footer"><Logo /><span>Один экран — много общих вечеров.</span><a href="#top">Вернуться наверх ↑</a></footer>
      <p className="legal-note">Используйте только видео, на просмотр которых у вас есть право.</p>
    </main>
  );
}

export default function HomePage() {
  return <Suspense fallback={<main className="landing-shell landing-loading">Подключение…</main>}><HomeContent /></Suspense>;
}
