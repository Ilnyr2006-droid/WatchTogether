# WatchTogether — домашний browser-only Host

WatchTogether запускается на домашнем ПК Host и обслуживает обычные браузеры через Next.js + Socket.IO. Electron, EXE и обязательный VPS не используются. Сохраняются RUTUBE, прямые URL, прежний режим «одинаковый локальный файл у каждого», HTTP Range streaming фильма с диска Host, WebRTC voice и чат.

## Что работает

- приватная комната с 10-символьным Room ID и отдельным 256-битным secret token;
- RUTUBE и прямые MP4/WebM URL;
- локальный файл у каждого участника;
- фильм из настроенной папки Host без копирования и без раскрытия полного пути;
- `200`, `206 Partial Content`, `416`, byte ranges и браузерная перемотка;
- host-controlled play, pause, seek и коррекция currentTime;
- WebRTC mesh voice с Perfect Negotiation, ICE queue, restartIce, STUN/TURN, mute и выбором микрофона;
- Socket.IO reconnect, чат, отдельные rate limits и строгая validation signaling/payload;
- автоматическое определение public IPv4 с timeout и резервным сервисом;
- Caddy HTTPS для удалённого браузера и микрофона.

## 1. Установка на домашний ПК

Установите Node.js 22 LTS и скачайте проект. В каталоге проекта:

```bash
npm install
copy .env.example .env
```

На Linux/macOS вместо `copy` используйте `cp`.

## 2. Папка с фильмами

Создайте папку, например `D:\Movies`, и положите туда MP4/M4V/WebM. В `.env`:

```env
WATCHTOGETHER_PORT=47821
HOSTNAME=0.0.0.0
WATCHTOGETHER_MEDIA_DIR=D:\Movies
```

Сайт показывает Host только файлы непосредственно из этой папки. Клиент выбирает opaque `fileId`; имя, переданный клиентом путь или `../` не используются для доступа к filesystem. Symlink и подпапки не сканируются. В RoomState/API/Socket.IO передаются только имя файла и случайный `streamId`.

MP4 H.264/AAC и WebM рассчитаны на прямое воспроизведение. Расширение не гарантирует совместимость кодеков: если Chromium/Safari/Firefox не может декодировать файл, UI показывает сообщение о необходимости конвертации. MKV/AVI/MOV видны в каталоге как несовместимые и не запускаются. FFmpeg и перекодирование не добавлены; качество исходного файла не изменяется.

## 3. Запуск

```bash
npm run build
npm start
```

Сервер слушает `0.0.0.0:${WATCHTOGETHER_PORT}`, по умолчанию `47821`. Локальная проверка: [http://localhost:47821](http://localhost:47821).

При создании комнаты backend обращается к `https://api.ipify.org` и, при ошибке/timeout, к `https://ipv4.icanhazip.com`. Каждый запрос ограничен 2,5 секундами. LAN, loopback и CGNAT-адреса не принимаются за публичный IPv4. Если оба сервиса недоступны, UI предлагает ввести белый IPv4 вручную.

## 4. Room token и безопасность

`crypto.randomBytes(32)` создаёт отдельный secret каждой комнаты. Войти можно только с правильной парой Room ID + token. Token возвращается Host только в acknowledgement создания и не попадает в обычные server logs или публичный RoomState.

Пример приглашения:

```text
https://watch.example.com/room/a1b2c3d4e5?token=LONG_RANDOM_TOKEN
```

После успешного Socket.IO-входа участник получает дополнительный случайный stream-token. HTTP movie endpoint проверяет его связь с участником и комнатой. После leave/reconnect token аннулируется, активные file streams закрываются. Восемь неудачных входов с одного IP за минуту временно блокируют новые попытки. SDP, ICE, чат, действия видео, participant updates и выбор источника валидируются и ограничены по размеру/rate.

## 5. Port forwarding

Для рекомендованной схемы с Caddy пробросьте на роутере:

```text
TCP 80  → LAN IP домашнего ПК Host, порт 80
TCP 443 → LAN IP домашнего ПК Host, порт 443
```

Закрепите LAN IP компьютера через DHCP reservation. В Windows Firewall разрешите Caddy входящие TCP 80/443 и Node.js в домашней/частной сети. Не отключайте Firewall целиком.

Прямой проброс `TCP 47821 → Host:47821` позволяет проверить HTTP-соединение, но не является нормальной production-схемой: удалённый `getUserMedia()` требует secure context. Для голоса используйте HTTPS на 443.

Если WAN-адрес роутера отличается от public IPv4, вероятен CGNAT. Обычный port forwarding тогда не заработает — запросите у провайдера белый IPv4 или используйте разрешённый VPN/tunnel. VPS приложению не обязателен.

## 6. Домен и HTTPS через Caddy

1. Создайте DNS `A`-record, например `watch.example.com`, указывающий на белый IPv4 Host.
2. Установите [Caddy](https://caddyserver.com/docs/install).
3. Скопируйте `Caddyfile.example` в `Caddyfile` и замените домен.
4. Добавьте в `.env`:

```env
WATCHTOGETHER_PUBLIC_URL=https://watch.example.com
ALLOWED_ORIGIN=https://watch.example.com
```

5. Запустите WatchTogether, затем Caddy:

```bash
npm start
caddy run --config Caddyfile
```

Caddy автоматически получает и обновляет публичный TLS certificate, если DNS и входящие 80/443 настроены правильно. `reverse_proxy 127.0.0.1:47821` поддерживает обычный HTTP, Range requests и WebSocket upgrade Socket.IO без специальных insecure browser flags.

## 7. Приглашение друга

Host открывает сайт, вводит имя и нажимает «Создать комнату». На странице комнаты появляются public IPv4, application port и готовое приглашение. Нажмите «Скопировать приглашение» и отправьте другу полную HTTPS-ссылку вместе с token в query string.

Друг открывает ссылку обычным браузером, вводит имя и подключается. При подключении он получает выбранный источник, актуальные playing/currentTime и историю чата. Секретную ссылку не публикуйте и не пересылайте посторонним.

## 8. Проверка голоса

1. Откройте приглашение на другом устройстве и другой сети.
2. Разрешите доступ к микрофону в браузере.
3. Убедитесь, что страница открыта по HTTPS.
4. Проверьте mute, speaking indicator и состояния connected/reconnecting.
5. С `NEXT_PUBLIC_WEBRTC_DEBUG=true` diagnostics показывает RTT, jitter, packet loss и P2P/TURN route.

STUN остаётся fallback. Для сложного NAT можно использовать существующий coturn через `TURN_URL`, `TURN_SECRET`, `TURN_TTL`; секрет выдаётся frontend только как временный HMAC credential.

## 9. Проверка фильма Host

1. Положите MP4 H.264/AAC или WebM в `WATCHTOGETHER_MEDIA_DIR`.
2. В комнате выберите «Фильм с компьютера Host» и нажмите «Обновить список».
3. Выберите фильм и запустите его.
4. В DevTools друга запрос `/api/rooms/{roomId}/stream` должен отвечать `206`, `Accept-Ranges: bytes`, корректными `Content-Range`, `Content-Length`, `Content-Type`.
5. Проверьте play/pause и перемотку в разные места большого файла.

Фильм читается через `createReadStream({start,end})` и не загружается целиком в RAM. Скорость и число одновременных просмотров ограничены upload-каналом домашнего интернета.

## Переменные окружения

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `WATCHTOGETHER_PORT` | application port | `47821` |
| `HOSTNAME` | интерфейс сервера | `0.0.0.0` |
| `WATCHTOGETHER_MEDIA_DIR` | абсолютная папка фильмов Host | не настроена |
| `WATCHTOGETHER_PUBLIC_URL` | публичный HTTPS origin Caddy | public IP + port |
| `ALLOWED_ORIGIN` | разрешённый Socket.IO origin | same-origin |
| `STUN_URL` | STUN fallback | Google STUN |
| `TURN_URL`, `TURN_SECRET`, `TURN_TTL` | optional coturn | только STUN |
| `NEXT_PUBLIC_WEBRTC_DEBUG` | WebRTC stats, build-time | `false` |

## Автоматические проверки

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Покрыты room token, invite parsing, failed-attempt limiter, public-IP fallback, media catalog isolation, Range `206/416`, stream authorization, Host leave cleanup, video sync, RUTUBE parsing, WebRTC negotiation/ICE/recovery, signaling authorization, TURN credentials и rate limits.

## Ограничения

- Комнаты и чат хранятся в RAM и исчезают после остановки Host.
- После выхода Host host-stream останавливается; новый Host должен выбрать источник заново.
- Нет транскодирования и автоматического определения всех кодеков до попытки воспроизведения.
- Public IP не означает, что порт доступен: окончательная проверка — подключение друга через мобильный интернет.
- Домашний upload должен выдерживать bitrate оригинального фильма.
- Для HTTPS нужен домен, белый IPv4 и доступные 80/443 либо альтернативная разрешённая tunnel/VPN-схема.

Проект предназначен только для контента, на просмотр которого у пользователей есть право.
