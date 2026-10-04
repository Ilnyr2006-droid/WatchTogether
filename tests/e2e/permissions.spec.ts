import { expect, test } from "@playwright/test";
import {
  createClients,
  createRoom,
  delayVideoActionTransport,
  emitSocketEvent,
  expectForbidden,
  getInvitation,
  joinRoom,
  mediaState,
  setPlaybackMode,
  trackVideoActionEmits,
  videoActionEmitCount,
  videoActionQueuedCount,
  videoState,
  watchRoomErrors,
} from "./helpers";

test("Everyone, Host only, and Ask control permissions are enforced by the server", async ({ browser, baseURL }) => {
  const clients = await createClients(browser, baseURL!, ["Host", "Guest A", "Guest B"]);
  const [host, guestA, guestB] = clients.clients;

  try {
    await createRoom(host.page, host.name);
    const invitation = await getInvitation(host.page);
    await joinRoom(guestA.page, invitation!, guestA.name);
    await joinRoom(guestB.page, invitation!, guestB.name);
    await expect(guestA.page.getByTestId("control-settings")).toContainText("Все могут управлять");
    await Promise.all([watchRoomErrors(guestA.page), watchRoomErrors(guestB.page)]);

    const fixtureUrl = `${baseURL}/api/e2e/fixture/e2e-small.mp4`;
    await emitSocketEvent(host.page, "video:set-source", { input: fixtureUrl });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", "1");

    // Everyone grants Guests both playback and shared URL source controls.
    await emitSocketEvent(guestA.page, "video:set-source", { input: fixtureUrl });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", "2");
    await emitSocketEvent(guestA.page, "video:action", { action: "play", currentTime: 1 });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "true");

    // File and P2P inputs remain Host-only even while playback control is Everyone.
    await expect(guestA.page.getByRole("button", { name: "Фильм с компьютера Host" })).toHaveCount(0);
    await expect(guestA.page.getByRole("button", { name: "P2P фильм с компьютера" })).toHaveCount(0);
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "video:set-source", { localFileName: "private.mp4" }));
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", "3");

    await setPlaybackMode(host.page, "host-only");
    await expect(guestA.page.getByTestId("control-settings")).toContainText("Только Host");
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "room:control-mode", { mode: "everyone" }));
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "video:action", { action: "pause", currentTime: 2 }));
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "video:set-source", { input: fixtureUrl }));
    await emitSocketEvent(host.page, "video:action", { action: "pause", currentTime: 2 });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "false");

    await setPlaybackMode(host.page, "approved");
    await expect(guestA.page.getByTestId("control-settings")).toContainText("По разрешению Host");
    await guestB.page.getByRole("button", { name: "Запросить управление" }).click();
    await expect(host.page.getByText("Guest B просит управление")).toBeVisible();
    await host.page.getByRole("button", { name: "Отклонить" }).click();
    await expect(host.page.getByText("Запросов пока нет")).toBeVisible();
    await guestA.page.getByRole("button", { name: "Запросить управление" }).click();
    await expect(host.page.getByText("Guest A просит управление")).toBeVisible();
    await host.page.getByRole("button", { name: "Разрешить" }).click();
    await expect(guestA.page.getByRole("button", { name: "Управление разрешено" })).toBeDisabled();
    await expect(guestA.page.getByTestId("control-settings")).toContainText("Управление разрешено");

    await setPlaybackMode(host.page, "host-only");
    await expect(guestA.page.getByTestId("control-settings")).toContainText("Только Host");
    await setPlaybackMode(host.page, "approved");
    await expect(guestA.page.getByTestId("control-settings")).toContainText("По разрешению Host");

    await emitSocketEvent(guestA.page, "video:set-source", { input: fixtureUrl });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", "5");
    await emitSocketEvent(guestA.page, "video:action", { action: "play", currentTime: 3 });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "true");
    await expectForbidden(guestB.page, () => emitSocketEvent(guestB.page, "video:action", { action: "pause", currentTime: 4 }));

    await host.page.getByRole("button", { name: "Отозвать" }).click();
    await expect(guestA.page.getByRole("button", { name: "Запросить управление" })).toBeEnabled();
    await expect(guestA.page.getByTestId("control-settings")).toContainText("По разрешению Host");
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "video:action", { action: "pause", currentTime: 4 }));
    await emitSocketEvent(host.page, "video:action", { action: "pause", currentTime: 4 });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "false");

    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});

test("a revoked Guest is resynced when a delayed local play is rejected", async ({ browser, baseURL }) => {
  const clients = await createClients(browser, baseURL!, ["Host", "Guest"]);
  const [host, guest] = clients.clients;

  try {
    await createRoom(host.page, host.name);
    const invitation = await getInvitation(host.page);
    await joinRoom(guest.page, invitation!, guest.name);
    await watchRoomErrors(guest.page);
    await setPlaybackMode(host.page, "approved");

    const fixtureUrl = `${baseURL}/api/e2e/fixture/e2e-small.mp4`;
    await emitSocketEvent(host.page, "video:set-source", { input: fixtureUrl });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", "1");
    await expect(guest.page.getByTestId("video-state")).toHaveAttribute("data-revision", "1");
    await expect.poll(async () => (await mediaState(guest.page)).readyState).toBeGreaterThanOrEqual(1);
    await host.page.getByTestId("shared-video").evaluate((video: HTMLVideoElement) => { video.muted = true; });
    await guest.page.getByTestId("shared-video").evaluate((video: HTMLVideoElement) => { video.muted = true; });

    const authoritativeTime = Math.min(0.5, (await mediaState(guest.page)).duration * 0.1);
    await emitSocketEvent(host.page, "video:action", { action: "pause", currentTime: authoritativeTime });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", "2");
    await expect(guest.page.getByTestId("video-state")).toHaveAttribute("data-playing", "false");

    const divergedTime = await guest.page.getByTestId("shared-video").evaluate((video: HTMLVideoElement, canonicalTime) => new Promise<number>((resolve) => {
      const target = Math.max(canonicalTime + 1.25, video.duration * 0.75);
      const clampedTarget = Math.min(target, video.duration - 0.1);
      video.addEventListener("seeked", () => resolve(video.currentTime), { once: true });
      video.currentTime = clampedTarget;
    }), authoritativeTime);
    expect(divergedTime).toBeGreaterThan(authoritativeTime + 0.75);

    await guest.page.getByRole("button", { name: "Запросить управление" }).click();
    await expect(host.page.getByText("Guest просит управление")).toBeVisible();
    await host.page.getByRole("button", { name: "Разрешить" }).click();
    await expect(guest.page.getByRole("button", { name: "Управление разрешено" })).toBeDisabled();
    const canonicalBeforeRace = await videoState(host.page);

    await trackVideoActionEmits(guest.page);
    await delayVideoActionTransport(guest.page, 2_000);
    await guest.page.getByTestId("shared-video").evaluate(async (video: HTMLVideoElement) => {
      await video.play();
    });
    await expect.poll(() => videoActionQueuedCount(guest.page)).toBe(1);

    await host.page.getByRole("button", { name: "Отозвать" }).click();
    await expect(guest.page.getByRole("button", { name: "Запросить управление" })).toBeEnabled();
    await expect.poll(async () => (await mediaState(guest.page)).paused).toBe(true);
    await expect.poll(async () => Math.abs((await mediaState(guest.page)).currentTime - authoritativeTime)).toBeLessThanOrEqual(0.5);

    await expectForbidden(guest.page, () => expect.poll(() => videoActionEmitCount(guest.page), { timeout: 5_000 }).toBe(1));
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", String(canonicalBeforeRace.revision));
    await expect(guest.page.getByTestId("video-state")).toHaveAttribute("data-revision", String(canonicalBeforeRace.revision));
    const finalGuestState = await videoState(guest.page);
    expect(finalGuestState.playing).toBe(canonicalBeforeRace.playing);
    expect(finalGuestState.revision).toBe(canonicalBeforeRace.revision);
    expect(Math.abs(finalGuestState.time - canonicalBeforeRace.time)).toBeLessThanOrEqual(0.5);
    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});
