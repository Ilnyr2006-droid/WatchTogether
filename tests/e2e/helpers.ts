import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export interface ParticipantClient {
  name: string;
  context: BrowserContext;
  page: Page;
}

export async function createClients(browser: Browser, baseURL: string, names: string[]) {
  const browserErrors: string[] = [];
  const externalRequests: string[] = [];
  const localOrigin = new URL(baseURL).origin;
  const clients: ParticipantClient[] = [];

  for (const name of names) {
    const context = await browser.newContext({ baseURL });
    context.on("page", (page) => {
      page.on("pageerror", (error) => browserErrors.push(`${name} pageerror: ${error.stack ?? error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(`${name} console.error: ${message.text()}`);
      });
    });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      try {
        if (new URL(url).origin === localOrigin) return route.continue();
      } catch { /* Non-HTTP requests are outside the local test origin. */ }
      externalRequests.push(url);
      return route.abort();
    });
    clients.push({ name, context, page: await context.newPage() });
  }

  return {
    clients,
    browserErrors,
    externalRequests,
    async assertNoBrowserErrors() {
      expect(browserErrors, browserErrors.join("\n")).toEqual([]);
      expect(externalRequests, externalRequests.join("\n")).toEqual([]);
    },
    async close() {
      await Promise.all(clients.map(({ context }) => context.close()));
    },
  };
}

export async function createRoom(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Ваше имя").fill(username);
  await page.getByRole("button", { name: "Создать комнату" }).click();
  await expect(page).toHaveURL(/\/room\/[a-z0-9]{10}\?token=/);
  await expect(page.getByLabel("Кто управляет видео")).toBeVisible();
  await expect(page.getByTestId("video-state")).toHaveAttribute("data-revision", "0");
  await waitForParticipant(page, username, 1);
  await expect(page.getByText("Вы управляете просмотром", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-watchtogether-e2e", "true");

  const testServices = await page.evaluate(async () => {
    const [network, ice] = await Promise.all([
      fetch("/api/network-info", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/ice-servers", { cache: "no-store" }).then((response) => response.json()),
    ]);
    return { network, ice };
  });
  expect(testServices.network.publicIp).toBeNull();
  expect(new URL(testServices.network.publicBaseUrl).hostname).toBe("127.0.0.1");
  expect(testServices.ice.iceServers).toHaveLength(1);
  expect(testServices.ice.iceServers[0]?.urls).toMatch(/^stun:127\.0\.0\.1:\d+$/);
}

export async function joinRoom(page: Page, invitation: string, username: string) {
  await page.goto("/");
  await page.getByLabel("Ваше имя").fill(username);
  await page.getByLabel("Ссылка-приглашение").fill(invitation);
  await page.getByRole("button", { name: "Подключиться" }).click();
  await expect(page).toHaveURL(/\/room\/[a-z0-9]{10}\?token=/);
  await expect(page.getByTestId("participant-count")).toBeVisible();
}

export async function getInvitation(page: Page) {
  const roomId = await page.evaluate(() => location.pathname.split("/").at(-1));
  if (!roomId) throw new Error("Room ID was not found in the URL");
  return page.evaluate((id) => sessionStorage.getItem(`watchtogether:invitation:${id}`), roomId);
}

export async function waitForParticipant(page: Page, username: string, count?: number) {
  await expect(page.getByTestId("participant").filter({ has: page.getByText(username, { exact: true }) })).toBeVisible();
  if (count !== undefined) await expect(page.getByTestId("participant-count")).toHaveText(String(count));
}

export async function participantSnapshot(page: Page) {
  return page.getByTestId("participant").evaluateAll((nodes) => nodes.map((node) => ({
    id: node.getAttribute("data-participant-id"),
    name: node.getAttribute("data-participant-name"),
    connected: node.getAttribute("data-connected") === "true",
    isHost: node.getAttribute("data-is-host") === "true",
  })).sort((left, right) => (left.name ?? "").localeCompare(right.name ?? "")));
}

export async function setPlaybackMode(page: Page, mode: "everyone" | "host-only" | "approved") {
  await page.getByLabel("Кто управляет видео").selectOption(mode);
  await expect(page.getByLabel("Кто управляет видео")).toHaveValue(mode);
}

export async function emitSocketEvent(page: Page, event: string, payload?: unknown) {
  await page.evaluate(({ name, data }) => {
    const socket = (window as Window & { __watchTogetherSocket?: { emit: (event: string, payload?: unknown) => void } }).__watchTogetherSocket;
    if (!socket) throw new Error("E2E socket hook is unavailable");
    socket.emit(name, data);
  }, { name: event, data: payload });
}

export async function watchRoomErrors(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __watchTogetherSocket?: { on: (event: string, listener: (payload: { code: string }) => void) => void };
      __roomErrors?: string[];
    };
    testWindow.__roomErrors = [];
    testWindow.__watchTogetherSocket?.on("room:error", (error) => testWindow.__roomErrors?.push(error.code));
  });
}

export async function expectForbidden(page: Page, action: () => Promise<void>) {
  const previousCount = await page.evaluate(() => (window as Window & { __roomErrors?: string[] }).__roomErrors?.length ?? 0);
  await action();
  await expect.poll(() => page.evaluate(() => (window as Window & { __roomErrors?: string[] }).__roomErrors?.length ?? 0)).toBe(previousCount + 1);
  await expect.poll(() => page.evaluate(() => (window as Window & { __roomErrors?: string[] }).__roomErrors?.at(-1))).toBe("FORBIDDEN");
}

export async function videoState(page: Page) {
  return page.getByTestId("video-state").evaluate((node) => ({
    revision: Number(node.getAttribute("data-revision")),
    playing: node.getAttribute("data-playing") === "true",
    time: Number(node.getAttribute("data-time")),
  }));
}

export async function mediaState(page: Page) {
  return page.getByTestId("shared-video").evaluate((node: HTMLVideoElement) => ({
    paused: node.paused,
    currentTime: node.currentTime,
    duration: node.duration,
    readyState: node.readyState,
  }));
}

export async function injectStaleVideoState(page: Page, revision: number) {
  await page.evaluate((staleRevision) => {
    const socket = (window as Window & { __watchTogetherSocket?: { emitReserved?: (event: string, payload: unknown) => void } }).__watchTogetherSocket;
    if (!socket?.emitReserved) throw new Error("E2E local socket event hook is unavailable");
    socket.emitReserved("video:state", {
      source: null,
      currentTime: 0,
      playing: true,
      updatedAt: Date.now() + 60_000,
      revision: staleRevision,
      updatedBy: null,
    });
  }, revision);
}

export async function trackVideoActionEmits(page: Page) {
  await page.evaluate(() => {
    const target = window as Window & {
      __watchTogetherSocket?: { emit: (event: string, ...args: unknown[]) => unknown };
      __videoActionEmits?: number;
    };
    const socket = target.__watchTogetherSocket;
    if (!socket) throw new Error("E2E socket hook is unavailable");
    const originalEmit = socket.emit.bind(socket);
    target.__videoActionEmits = 0;
    socket.emit = (event, ...args) => {
      if (event === "video:action") target.__videoActionEmits = (target.__videoActionEmits ?? 0) + 1;
      return originalEmit(event, ...args);
    };
  });
}

export async function videoActionEmitCount(page: Page) {
  return page.evaluate(() => (window as Window & { __videoActionEmits?: number }).__videoActionEmits ?? 0);
}
