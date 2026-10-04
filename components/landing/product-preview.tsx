import { MessageCircle, Pause, Play, Radio, Users } from "lucide-react";

export function ProductPreview() {
  return (
    <div className="product-preview" aria-label="Пример комнаты WatchTogether">
      <div className="preview-topbar"><span className="preview-brand">watchtogether.</span><span className="preview-live"><i /> LIVE ROOM</span><Users aria-hidden="true" /></div>
      <div className="preview-screen"><div className="preview-sky" /><div className="preview-horizon" /><div className="preview-subject" /><div className="preview-vignette" /><div className="preview-movie-copy"><span>СЕГОДНЯ ВМЕСТЕ</span><strong>THE<br />NIGHT<br />IS OURS</strong></div><div className="preview-presence"><span>И</span><span>А</span><b>+2</b><small>смотрят вместе</small></div></div>
      <div className="preview-controls"><button type="button" aria-label="Пример паузы"><Pause aria-hidden="true" /></button><span className="preview-time">00:42 <i><b /></i> 02:18</span><MessageCircle aria-hidden="true" /><Radio aria-hidden="true" /></div>
      <div className="preview-caption"><span>WATCHTOGETHER / ROOM 04</span><span><Play aria-hidden="true" /> синхронный просмотр</span></div>
    </div>
  );
}
