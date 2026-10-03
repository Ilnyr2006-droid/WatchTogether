import { expect, test } from "@playwright/test";
import {
  createClients,
  createRoom,
  emitSocketEvent,
  expectForbidden,
  getInvitation,
  joinRoom,
  setPlaybackMode,
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
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "room:control-mode", { mode: "everyone" }));
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "video:action", { action: "pause", currentTime: 2 }));
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "video:set-source", { input: fixtureUrl }));
    await emitSocketEvent(host.page, "video:action", { action: "pause", currentTime: 2 });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "false");

    await setPlaybackMode(host.page, "approved");
    await guestB.page.getByRole("button", { name: "Запросить управление" }).click();
    await expect(host.page.getByText("Guest B просит управление")).toBeVisible();
    await host.page.getByRole("button", { name: "Отклонить" }).click();
    await expect(host.page.getByText("Запросов пока нет")).toBeVisible();
    await guestA.page.getByRole("button", { name: "Запросить управление" }).click();
    await expect(host.page.getByText("Guest A просит управление")).toBeVisible();
    await host.page.getByRole("button", { name: "Разрешить" }).click();
    await expect(guestA.page.getByRole("button", { name: "Управление разрешено" })).toBeDisabled();

    await emitSocketEvent(guestA.page, "video:set-source", { input: fixtureUrl });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", "5");
    await emitSocketEvent(guestA.page, "video:action", { action: "play", currentTime: 3 });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "true");
    await expectForbidden(guestB.page, () => emitSocketEvent(guestB.page, "video:action", { action: "pause", currentTime: 4 }));

    await host.page.getByRole("button", { name: "Отозвать" }).click();
    await expect(guestA.page.getByRole("button", { name: "Запросить управление" })).toBeEnabled();
    await expectForbidden(guestA.page, () => emitSocketEvent(guestA.page, "video:action", { action: "pause", currentTime: 4 }));
    await emitSocketEvent(host.page, "video:action", { action: "pause", currentTime: 4 });
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-playing", "false");

    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});
