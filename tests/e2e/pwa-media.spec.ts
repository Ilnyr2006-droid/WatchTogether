import { expect, test, type Page } from "@playwright/test";
import {
  createClients,
  createRoom,
  getInvitation,
  joinRoom,
  mediaState,
  setPlaybackMode,
  videoState,
} from "./helpers";

async function chooseLocalUrlFixture(page: Page, baseURL: string) {
  await page.getByRole("button", { name: "URL / RUTUBE" }).click();
  await page.getByLabel("URL / RUTUBE").fill(`${baseURL}/api/e2e/fixture/e2e-small.mp4`);
  await page.getByRole("button", { name: "Сменить сейчас" }).click();
  await expect(page.getByTestId("video-state")).toHaveAttribute("data-revision", "1");
  await expect.poll(async () => (await mediaState(page)).readyState).toBeGreaterThanOrEqual(1);
}

async function expectTouchTarget(page: Page, name: string) {
  const bounds = await page.getByRole("button", { name }).boundingBox();
  expect(bounds?.width, `${name} width`).toBeGreaterThanOrEqual(44);
  expect(bounds?.height, `${name} height`).toBeGreaterThanOrEqual(44);
}

async function installPipMock(page: Page, supported: boolean) {
  await page.addInitScript((enablePip) => {
    let activeVideo: HTMLVideoElement | null = null;
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: enablePip });
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => activeVideo });
    Object.defineProperty(HTMLVideoElement.prototype, "requestPictureInPicture", {
      configurable: true,
      value: function (this: HTMLVideoElement) {
        this.dispatchEvent(new Event("watchtogether-pip-enter", { bubbles: true }));
        return Promise.resolve({} as PictureInPictureWindow);
      },
    });
    document.addEventListener("watchtogether-pip-enter", (event) => {
      activeVideo = event.target as HTMLVideoElement;
      activeVideo.dispatchEvent(new Event("enterpictureinpicture"));
    });
    Object.defineProperty(document, "exitPictureInPicture", {
      configurable: true,
      value: async () => {
        const leaving = activeVideo;
        activeVideo = null;
        leaving?.dispatchEvent(new Event("leavepictureinpicture"));
      },
    });
  }, supported);
}

async function installMediaSessionMock(page: Page) {
  await page.addInitScript(() => {
    const handlers: Record<string, ((details?: unknown) => void) | null> = {};
    const mediaSession = {
      metadata: null as unknown,
      playbackState: "none",
      positionState: null as unknown,
      setActionHandler(action: string, handler: ((details?: unknown) => void) | null) { handlers[action] = handler; },
      setPositionState(position: unknown) { this.positionState = position; },
    };
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: mediaSession });
    Object.defineProperty(window, "MediaMetadata", {
      configurable: true,
      value: class TestMediaMetadata {
        title: string;
        artist: string;
        album: string;
        constructor(init: { title: string; artist: string; album: string }) { Object.assign(this, init); this.title = init.title; this.artist = init.artist; this.album = init.album; }
      },
    });
    Object.defineProperty(window, "__watchTogetherTestMediaSession", {
      configurable: true,
      value: {
        dispatch: (action: string, details?: unknown) => handlers[action]?.(details),
        hasHandler: (action: string) => typeof handlers[action] === "function",
        state: () => ({ metadata: mediaSession.metadata, playbackState: mediaSession.playbackState, positionState: mediaSession.positionState }),
      },
    });
  });
}

test("manifest, static-only service worker cache, and offline shell", async ({ browser, baseURL }) => {
  const clients = await createClients(browser, baseURL!, ["PWA user"]);
  const page = clients.clients[0]!.page;
  try {
    await page.goto("/");
    const manifest = await page.evaluate(async () => {
      const response = await fetch("/manifest.webmanifest");
      return { status: response.status, value: await response.json() as { display: string; start_url: string; theme_color: string; background_color: string; icons: { src: string }[] } };
    });
    expect(manifest.status).toBe(200);
    expect(manifest.value.display).toBe("standalone");
    expect(manifest.value.start_url).toBe("/");
    expect(manifest.value.theme_color).toBe("#08090a");
    expect(manifest.value.background_color).toBe("#08090a");
    expect(manifest.value.icons.map((icon) => icon.src)).toContain("/icons/watchtogether-192.png");

    const activeWorkerExists = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return Boolean(ready.active);
    });
    expect(activeWorkerExists).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe("activated");
    const workerUpdateReload = page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      sessionStorage.setItem("watchtogether:pwa-reload-probe", String(performance.timeOrigin));
      window.setTimeout(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")), 0);
    });
    await workerUpdateReload;
    await expect.poll(() => page.evaluate(() => performance.timeOrigin !== Number(sessionStorage.getItem("watchtogether:pwa-reload-probe")))).toBe(true);

    const cacheAudit = await page.evaluate(async () => {
      await Promise.all([
        fetch("/api/network-info", { cache: "no-store" }),
        fetch("/api/ice-servers", { cache: "no-store" }),
      ]);
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => new URL(request.url).pathname + new URL(request.url).search));
      }
      return urls;
    });
    expect(cacheAudit.some((url) => url.startsWith("/api/") || url.includes("token=") || url.startsWith("/room/"))).toBe(false);
    await clients.assertNoBrowserErrors();

    await clients.clients[0]!.context.setOffline(true);
    await page.goto(`${baseURL}/room/abc123def4?token=e2e-only-value`);
    await expect(page.getByRole("heading", { name: "Нет соединения с сервером" })).toBeVisible();
    await expect(page.getByText("Для совместного просмотра требуется сеть", { exact: true })).toBeVisible();
    const expectedOfflineErrors = clients.browserErrors.filter((error) =>
      (error.includes("/_next/hmr") && error.includes("ERR_INTERNET_DISCONNECTED")) ||
      (error.includes("/socket.io/") && error.includes("ERR_INTERNET_DISCONNECTED")) ||
      error.includes("Failed to load resource: net::ERR_FAILED"),
    );
    const unexpectedBrowserErrors = clients.browserErrors.filter((error) => !expectedOfflineErrors.includes(error));
    expect(unexpectedBrowserErrors, unexpectedBrowserErrors.join("\n")).toEqual([]);
    expect(clients.externalRequests).toEqual([]);
    const offlineCacheAudit = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => new URL(request.url).pathname + new URL(request.url).search));
      }
      return urls;
    });
    expect(offlineCacheAudit.some((url) => url.startsWith("/room/") || url.includes("token="))).toBe(false);
  } finally {
    await clients.close();
  }
});

test("PiP button follows API support and enters/exits through the browser API", async ({ browser, baseURL }) => {
  const clients = await createClients(browser, baseURL!, ["Unsupported PiP"]);
  const page = clients.clients[0]!.page;
  try {
    await installPipMock(page, false);
    await createRoom(page, "Unsupported PiP");
    await chooseLocalUrlFixture(page, baseURL!);
    await expect(page.getByRole("button", { name: "Картинка в картинке" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Полный экран" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Выключить звук" })).toBeVisible();
    await expectTouchTarget(page, "Полный экран");
    await expectTouchTarget(page, "Выключить звук");
    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }

  const pipClients = await createClients(browser, baseURL!, ["PiP Host"]);
  const pipPage = pipClients.clients[0]!.page;
  try {
    await installPipMock(pipPage, true);
    await createRoom(pipPage, "PiP Host");
    await chooseLocalUrlFixture(pipPage, baseURL!);
    const enter = pipPage.getByRole("button", { name: "Картинка в картинке" });
    await expect(enter).toBeVisible();
    await expectTouchTarget(pipPage, "Картинка в картинке");
    await expectTouchTarget(pipPage, "Полный экран");
    await expectTouchTarget(pipPage, "Выключить звук");
    await enter.click();
    await expect(pipPage.getByRole("button", { name: "Выйти из PiP" })).toBeVisible();
    await pipPage.getByRole("button", { name: "Выйти из PiP" }).click();
    await expect(pipPage.getByRole("button", { name: "Картинка в картинке" })).toBeVisible();
    await pipClients.assertNoBrowserErrors();
  } finally {
    await pipClients.close();
  }
});

test("Media Session actions honor room permission and reuse normal playback events", async ({ browser, baseURL }) => {
  const clients = await createClients(browser, baseURL!, ["Media Host", "Media Guest"]);
  const [host, guest] = clients.clients;
  try {
    await installMediaSessionMock(guest.page);
    await createRoom(host.page, host.name);
    const invitation = await getInvitation(host.page);
    await joinRoom(guest.page, invitation!, guest.name);
    await chooseLocalUrlFixture(host.page, baseURL!);
    await expect.poll(async () => (await mediaState(guest.page)).readyState).toBeGreaterThanOrEqual(1);
    await Promise.all([host.page, guest.page].map((page) => page.getByTestId("shared-video").evaluate((video: HTMLVideoElement) => { video.muted = true; })));
    await expect.poll(() => guest.page.evaluate(() => (window as Window & { __watchTogetherTestMediaSession?: { hasHandler: (action: string) => boolean } }).__watchTogetherTestMediaSession?.hasHandler("play"))).toBe(true);

    await setPlaybackMode(host.page, "host-only");
    const beforeDenied = await videoState(host.page);
    await guest.page.evaluate(() => (window as Window & { __watchTogetherTestMediaSession?: { dispatch: (action: string) => void } }).__watchTogetherTestMediaSession?.dispatch("play"));
    await expect.poll(async () => videoState(host.page)).toEqual(beforeDenied);
    expect((await mediaState(guest.page)).paused).toBe(true);

    await setPlaybackMode(host.page, "everyone");
    await guest.page.evaluate(() => (window as Window & { __watchTogetherTestMediaSession?: { dispatch: (action: string) => void } }).__watchTogetherTestMediaSession?.dispatch("play"));
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "true");
    await expect.poll(async () => videoState(guest.page)).toEqual(await videoState(host.page));

    await guest.page.evaluate(() => (window as Window & { __watchTogetherTestMediaSession?: { dispatch: (action: string, details?: unknown) => void } }).__watchTogetherTestMediaSession?.dispatch("pause"));
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "false");
    await expect.poll(async () => videoState(guest.page)).toEqual(await videoState(host.page));
    const metadata = await guest.page.evaluate(() => (window as Window & { __watchTogetherTestMediaSession?: { state: () => { metadata: { title: string; artist: string; album: string } | null } } }).__watchTogetherTestMediaSession?.state().metadata);
    expect(metadata?.artist).toBe("WatchTogether");
    expect(metadata?.album).toMatch(/^Комната /);
    expect(metadata?.title).not.toContain("token");
    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});
