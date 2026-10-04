import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createClients,
  createRoom,
  emitSocketEvent,
  getInvitation,
  joinRoom,
  openRoomTab,
  mediaState,
  participantSnapshot,
  videoState,
  waitForParticipant,
} from "./helpers";

test("Owner local media playlist streams original bytes, advances authoritatively, and survives late join and reconnect", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const clients = await createClients(browser, baseURL!, ["Owner", "Guest A", "Guest B", "Late Guest"]);
  const [owner, guestA, guestB, lateGuest] = clients.clients;
  const unauthorizedResponses: Promise<string>[] = [];
  lateGuest.page.on("response", (response) => {
    if (response.status() !== 401) return;
    const failedUrl = new URL(response.url());
    unauthorizedResponses.push(lateGuest.page.getByTestId("shared-video").getAttribute("src").then((currentSrc) => {
      const current = currentSrc ? new URL(currentSrc, baseURL) : null;
      return `${response.request().method()} ${failedUrl.pathname}; token=${failedUrl.searchParams.has("token") ? "present" : "missing"}; current=${current?.pathname ?? "none"}; sameToken=${current?.searchParams.get("token") === failedUrl.searchParams.get("token")}`;
    }).catch(() => `${response.request().method()} ${failedUrl.pathname}; no-current-video`));
  });
  const fixture = resolve(process.cwd(), "tests/e2e/fixtures/e2e-small.mp4");
  const mediaDirectory = await mkdtemp(join(tmpdir(), "watchtogether-playlist-e2e-"));
  const firstPath = join(mediaDirectory, "Film One.mp4");
  const secondPath = join(mediaDirectory, "Film Two.mp4");

  try {
    await Promise.all([copyFile(fixture, firstPath), copyFile(fixture, secondPath)]);
    await createRoom(owner.page, owner.name);
    const invitation = await getInvitation(owner.page);
    await joinRoom(guestA.page, invitation!, guestA.name);
    await joinRoom(guestB.page, invitation!, guestB.name);

    await owner.page.getByRole("button", { name: "Фильм с компьютера" }).click();
    await owner.page.getByLabel("Локальный путь к фильму").fill(firstPath);
    await owner.page.getByTestId("owner-local-media-controls").getByRole("button", { name: "Добавить", exact: true }).click();
    await expect(owner.page.getByTestId("playlist-item")).toHaveCount(1);
    await owner.page.getByLabel("Локальный путь к фильму").fill(secondPath);
    await owner.page.getByTestId("owner-local-media-controls").getByRole("button", { name: "Добавить", exact: true }).click();

    for (const client of [owner, guestA, guestB]) {
      await openRoomTab(client.page, "Очередь");
      await expect(client.page.getByTestId("playlist-item")).toHaveCount(2);
      await expect(client.page.getByText("Film One.mp4", { exact: true })).toBeVisible();
      await expect(client.page.getByText("Film Two.mp4", { exact: true })).toBeVisible();
      await expect(client.page.locator("body")).not.toContainText(mediaDirectory);
    }
    const firstItem = owner.page.getByTestId("playlist-item").filter({ hasText: "Film One.mp4" });
    const firstItemId = await firstItem.getAttribute("data-playlist-item-id");
    expect(firstItemId).toBeTruthy();
    await firstItem.getByLabel("Действия для Film One.mp4").click();
    await owner.page.getByRole("button", { name: "Запустить Film One.mp4" }).click();

    for (const client of [owner, guestA, guestB]) {
      await expect(client.page.getByTestId("video-state")).toHaveAttribute("data-current-item", firstItemId!);
      await expect.poll(async () => (await mediaState(client.page)).readyState).toBeGreaterThanOrEqual(2);
      await expect(client.page.getByTestId("local-media-ready")).toContainText(`${client.name} — готов`);
      const sourceUrl = await client.page.getByTestId("shared-video").getAttribute("src");
      expect(sourceUrl).toContain(`/api/rooms/`);
      expect(sourceUrl).toContain("/media/");
      expect(sourceUrl).toContain("/stream?token=");
      expect(sourceUrl).not.toContain(mediaDirectory);
    }

    const streamUrls = await Promise.all([owner, guestA, guestB].map((client) => client.page.getByTestId("shared-video").getAttribute("src")));
    expect(new Set(streamUrls).size).toBe(3);
    const statesAfterStart = await Promise.all([owner, guestA, guestB].map((client) => videoState(client.page)));
    expect(statesAfterStart.every((state) => state.revision === statesAfterStart[0]!.revision)).toBe(true);

    await emitSocketEvent(owner.page, "video:action", { action: "play", currentTime: 0 });
    await expect(owner.page.getByTestId("video-state")).toHaveAttribute("data-playing", "true");
    for (const client of [owner, guestA, guestB]) await expect(client.page.getByTestId("video-state")).toHaveAttribute("data-playing", "true");
    await emitSocketEvent(owner.page, "video:action", { action: "pause", currentTime: 1.25 });
    for (const client of [owner, guestA, guestB]) {
      await expect(client.page.getByTestId("video-state")).toHaveAttribute("data-playing", "false");
      await expect.poll(async () => Math.abs((await mediaState(client.page)).currentTime - 1.25)).toBeLessThanOrEqual(1);
    }
    await emitSocketEvent(owner.page, "video:action", { action: "seek", currentTime: 2.2 });
    const pausedStates = await Promise.all([owner, guestA, guestB].map((client) => videoState(client.page)));
    expect(pausedStates.every((state) => state.revision === pausedStates[0]!.revision && !state.playing)).toBe(true);
    for (const client of [owner, guestA, guestB]) {
      await expect.poll(async () => Math.abs((await mediaState(client.page)).currentTime - 2.2)).toBeLessThanOrEqual(1);
    }

    const firstPlaybackId = await owner.page.getByTestId("video-state").getAttribute("data-playback-id");
    const secondItem = owner.page.getByTestId("playlist-item").filter({ hasText: "Film Two.mp4" });
    const secondItemId = await secondItem.getAttribute("data-playlist-item-id");
    expect(firstPlaybackId).toBeTruthy();
    expect(secondItemId).toBeTruthy();
    await emitSocketEvent(owner.page, "playlist:ended", { itemId: firstItemId, playbackId: firstPlaybackId });
    for (const client of [owner, guestA, guestB]) {
      await expect(client.page.getByTestId("video-state")).toHaveAttribute("data-current-item", secondItemId!);
      await expect.poll(async () => (await mediaState(client.page)).readyState).toBeGreaterThanOrEqual(2);
    }
    const secondRevision = (await videoState(owner.page)).revision;
    await emitSocketEvent(owner.page, "playlist:ended", { itemId: firstItemId, playbackId: firstPlaybackId });
    await expect.poll(async () => videoState(owner.page)).toEqual(expect.objectContaining({ revision: secondRevision }));
    expect(await owner.page.getByTestId("video-state").getAttribute("data-current-item")).toBe(secondItemId);

    await joinRoom(lateGuest.page, invitation!, lateGuest.name);
    await waitForParticipant(lateGuest.page, lateGuest.name, 4);
    await expect(lateGuest.page.getByTestId("video-state")).toHaveAttribute("data-current-item", secondItemId!);
    await expect(lateGuest.page.getByTestId("video-state")).toHaveAttribute("data-revision", String(secondRevision));
    await expect(lateGuest.page.getByTestId("playlist-item")).toHaveCount(2);
    await expect.poll(async () => (await mediaState(lateGuest.page)).readyState).toBeGreaterThanOrEqual(2);
    await expect(lateGuest.page.locator("body")).not.toContainText(mediaDirectory);

    const guestAId = (await participantSnapshot(guestA.page)).find((participant) => participant.name === guestA.name)?.id;
    const guestStreamBeforeReload = await guestA.page.getByTestId("shared-video").getAttribute("src");
    await guestA.page.reload();
    await waitForParticipant(guestA.page, guestA.name, 4);
    await expect(guestA.page.getByTestId("video-state")).toHaveAttribute("data-current-item", secondItemId!);
    await expect(guestA.page.getByTestId("video-state")).toHaveAttribute("data-revision", String(secondRevision));
    await expect(guestA.page.getByTestId("playlist-item")).toHaveCount(2);
    await expect.poll(async () => (await mediaState(guestA.page)).readyState).toBeGreaterThanOrEqual(2);
    const afterReconnect = await participantSnapshot(guestA.page);
    expect(afterReconnect).toHaveLength(4);
    expect(afterReconnect.filter((participant) => participant.id === guestAId)).toHaveLength(1);
    expect(afterReconnect.find((participant) => participant.name === guestA.name)?.connected).toBe(true);
    expect(await guestA.page.getByTestId("shared-video").getAttribute("src")).not.toBe(guestStreamBeforeReload);

    for (const client of [owner, guestA, guestB, lateGuest]) {
      await expect(client.page.getByTestId("video-state")).toHaveAttribute("data-current-item", secondItemId!);
      await expect(client.page.getByTestId("video-state")).toHaveAttribute("data-revision", String(secondRevision));
      await expect(client.page.getByTestId("playlist-item")).toHaveCount(2);
    }
    expect(await Promise.all(unauthorizedResponses)).toEqual([]);
    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
    await rm(mediaDirectory, { recursive: true, force: true });
  }
});
