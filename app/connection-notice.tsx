"use client";

import { useEffect, useState } from "react";

export function ConnectionNotice({ connected, monitorServer = false }: { connected: boolean; monitorServer?: boolean }) {
  const [browserOffline, setBrowserOffline] = useState(false);
  const [serverUnavailable, setServerUnavailable] = useState(false);

  useEffect(() => {
    const updateOnlineStatus = () => setBrowserOffline(!navigator.onLine);
    const onlineCheck = window.setTimeout(updateOnlineStatus, 0);
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    const timer = monitorServer && !connected
      ? window.setTimeout(() => setServerUnavailable(true), 1_500)
      : window.setTimeout(() => setServerUnavailable(false), 0);
    return () => {
      window.clearTimeout(onlineCheck);
      window.clearTimeout(timer);
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, [connected, monitorServer]);

  if (!browserOffline && !(monitorServer && !connected && serverUnavailable)) return null;
  return <div role="alert" className="offline-screen">
    <div className="offline-notice">
      <span className="status-dot is-waiting" aria-hidden="true" />
      <h1>Нет соединения с сервером</h1>
      <p>Для совместного просмотра требуется сеть</p>
      <button type="button" onClick={() => window.location.reload()} className="button button-primary mt-6 touch-manipulation">Повторить подключение</button>
    </div>
  </div>;
}
