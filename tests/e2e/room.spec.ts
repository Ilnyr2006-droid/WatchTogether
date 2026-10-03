import { expect, test, type Page } from "@playwright/test";

async function createHost(page: Page) {
  await page.goto("/");
  await page.getByLabel("Ваше имя").fill("Host");
  await page.getByRole("button", { name: "Создать комнату" }).click();
  await expect(page).toHaveURL(/\/room\/[a-z0-9]{10}\?token=/);
  await expect(page.getByLabel("Кто управляет видео")).toBeVisible();
}

async function joinGuest(page: Page, invitation: string) {
  await page.goto("/");
  await page.getByLabel("Ваше имя").fill("Guest");
  await page.getByLabel("Ссылка-приглашение").fill(invitation);
  await page.getByRole("button", { name: "Подключиться" }).click();
  await expect(page).toHaveURL(/\/room\/[a-z0-9]{10}\?token=/);
  await expect(page.getByTestId("participant-count")).toHaveText("2");
}

async function emit(page: Page, event: string, payload?: unknown) {
  await page.evaluate(({ name, data }) => {
    const socket = (window as Window & { __watchTogetherSocket?: { emit: (event: string, payload?: unknown) => void } }).__watchTogetherSocket;
    if (!socket) throw new Error("E2E socket hook is unavailable");
    socket.emit(name, data);
  }, { name: event, data: payload });
}

async function videoState(page: Page) {
  return page.getByTestId("video-state").evaluate((node) => ({
    revision: Number(node.getAttribute("data-revision")),
    playing: node.getAttribute("data-playing"),
    time: Number(node.getAttribute("data-time")),
  }));
}

async function expectForbidden(page: Page, action: () => Promise<void>) {
  const previousCount = await page.evaluate(() => (window as unknown as { __roomErrors?: string[] }).__roomErrors?.length ?? 0);
  await action();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __roomErrors?: string[] }).__roomErrors?.length ?? 0)).toBe(previousCount + 1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __roomErrors?: string[] }).__roomErrors?.at(-1))).toBe("FORBIDDEN");
}

test("creates room, joins/reconnects both roles, keeps chat and synchronizes revisioned playback", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext({ baseURL });
  const guestContext = await browser.newContext({ baseURL });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const externalRequests: string[] = [];
  for (const page of [host, guest]) {
    await page.route("**/*", (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === baseURL) return route.continue();
      externalRequests.push(requestUrl.origin);
      return route.abort();
    });
  }

  await createHost(host);
  const roomInvitation = await host.evaluate(() => sessionStorage.getItem(`watchtogether:invitation:${location.pathname.split("/").at(-1)}`));
  expect(roomInvitation).toContain("127.0.0.1:4173");
  await joinGuest(guest, roomInvitation!);
  await expect(host.getByTestId("participant-count")).toHaveText("2");

  await guest.getByPlaceholder("Сообщение…").fill("Чат сохраняется");
  await guest.getByRole("button", { name: "Отправить" }).click();
  await expect(host.getByText("Чат сохраняется")).toBeVisible();

  await guest.reload();
  await expect(guest.getByTestId("participant-count")).toHaveText("2");
  await host.reload();
  await expect(host.getByLabel("Кто управляет видео")).toBeVisible();
  await expect(host.getByTestId("participant-count")).toHaveText("2");
  await expect(host.getByText("Чат сохраняется")).toBeVisible();

  await emit(host, "video:set-source", { input: `${baseURL}/test.mp4` });
  await expect(host.getByTestId("video-state")).toHaveAttribute("data-revision", "1");
  await emit(guest, "video:action", { action: "play", currentTime: 0 });
  await expect(host.getByTestId("video-state")).toHaveAttribute("data-playing", "true");
  await emit(host, "video:action", { action: "pause", currentTime: 8 });
  await expect(guest.getByTestId("video-state")).toHaveAttribute("data-playing", "false");
  await emit(guest, "video:action", { action: "seek", currentTime: 37 });
  await expect(host.getByTestId("video-state")).toHaveAttribute("data-time", "37");

  await guest.evaluate(() => {
    const browserWindow = window as unknown as {
      __watchTogetherSocket?: { emit: (...args: unknown[]) => unknown };
      __videoActionEmits?: number;
    };
    const socket = browserWindow.__watchTogetherSocket;
    if (!socket) throw new Error("E2E socket hook is unavailable");
    const originalEmit = socket.emit.bind(socket);
    browserWindow.__videoActionEmits = 0;
    socket.emit = (...args: unknown[]) => {
      if (args[0] === "video:action") browserWindow.__videoActionEmits! += 1;
      return originalEmit(...args);
    };
  });
  await emit(host, "video:action", { action: "play", currentTime: 38 });
  await expect(guest.getByTestId("video-state")).toHaveAttribute("data-playing", "true");
  await emit(host, "video:action", { action: "pause", currentTime: 39 });
  await expect(guest.getByTestId("video-state")).toHaveAttribute("data-playing", "false");
  await guest.waitForTimeout(600);
  expect(await guest.evaluate(() => (window as unknown as { __videoActionEmits?: number }).__videoActionEmits)).toBe(0);

  await Promise.all([
    emit(host, "video:action", { action: "play", currentTime: 39 }),
    emit(guest, "video:action", { action: "pause", currentTime: 40 }),
  ]);
  await expect.poll(async () => (await videoState(host)).revision).toBeGreaterThan(5);
  await expect.poll(async () => videoState(host)).toEqual(await videoState(guest));
  expect(externalRequests).toEqual([]);
  await hostContext.close();
  await guestContext.close();
});

test("enforces host-only and approved control on the server", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext({ baseURL });
  const guestContext = await browser.newContext({ baseURL });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await createHost(host);
  const invitation = await host.evaluate(() => sessionStorage.getItem(`watchtogether:invitation:${location.pathname.split("/").at(-1)}`));
  await joinGuest(guest, invitation!);
  await guest.evaluate(() => {
    const browserWindow = window as unknown as {
      __watchTogetherSocket?: { on: (event: string, listener: (payload: { code: string }) => void) => void };
      __roomErrors?: string[];
    };
    browserWindow.__roomErrors = [];
    browserWindow.__watchTogetherSocket?.on("room:error", (error) => browserWindow.__roomErrors?.push(error.code));
  });
  await emit(host, "video:set-source", { input: `${baseURL}/test.mp4` });
  await expect(host.getByTestId("video-state")).toHaveAttribute("data-revision", "1");

  await host.getByLabel("Кто управляет видео").selectOption("host-only");
  await expect(guest.getByText("Только Host", { exact: true })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Фильм с компьютера Host" })).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Фильм с компьютера Host" })).toBeVisible();
  await expectForbidden(guest, () => emit(guest, "room:control-mode", { mode: "everyone" }));
  await expect(guest.getByText("Только Host", { exact: true })).toBeVisible();
  await expectForbidden(guest, () => emit(guest, "video:action", { action: "pause", currentTime: 12 }));
  await expect(host.getByTestId("video-state")).toHaveAttribute("data-revision", "1");
  await expectForbidden(guest, () => emit(guest, "video:set-source", { input: `${baseURL}/test.mp4` }));
  await expect(host.getByTestId("video-state")).toHaveAttribute("data-revision", "1");

  await host.getByLabel("Кто управляет видео").selectOption("approved");
  await guest.getByRole("button", { name: "Запросить управление" }).click();
  await expect(host.getByText("Guest просит управление")).toBeVisible();
  await host.getByRole("button", { name: "Разрешить" }).click();
  await expect(guest.getByRole("button", { name: "Управление разрешено" })).toBeDisabled();
  await emit(guest, "video:action", { action: "play", currentTime: 20 });
  await expect(host.getByTestId("video-state")).toHaveAttribute("data-revision", "2");
  await host.getByRole("button", { name: "Отозвать" }).click();
  await expect(guest.getByRole("button", { name: "Запросить управление" })).toBeEnabled();
  await expectForbidden(guest, () => emit(guest, "video:action", { action: "pause", currentTime: 21 }));
  await expect(host.getByTestId("video-state")).toHaveAttribute("data-revision", "2");
  await guest.getByRole("button", { name: "Запросить управление" }).click();
  await expect(host.getByText("Guest просит управление")).toBeVisible();
  await host.getByRole("button", { name: "Отклонить" }).click();
  await expect(host.getByText("Запросов пока нет")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Запросить управление" })).toBeEnabled();

  await hostContext.close();
  await guestContext.close();
});
