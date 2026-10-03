import { expect, test } from "@playwright/test";
import {
  createClients,
  createRoom,
  emitSocketEvent,
  getInvitation,
  joinRoom,
  injectStaleVideoState,
  mediaState,
  trackVideoActionEmits,
  videoState,
  videoActionEmitCount,
} from "./helpers";

async function chooseLocalFixture(page: import("@playwright/test").Page, baseURL: string) {
  await page.getByRole("button", { name: "Видео по URL" }).click();
  await page.getByPlaceholder("https://cdn.example.com/movie.mp4").fill(`${baseURL}/api/e2e/fixture/e2e-small.mp4`);
  await page.getByRole("button", { name: "Открыть" }).click();
  await expect(page.getByTestId("video-state")).toHaveAttribute("data-revision", "1");
  await expect.poll(async () => (await mediaState(page)).readyState).toBeGreaterThanOrEqual(1);
  await page.getByTestId("shared-video").evaluate((video: HTMLVideoElement) => { video.muted = true; });
}

async function expectSameFinalVideoState(pages: import("@playwright/test").Page[]) {
  await expect.poll(async () => {
    const states = await Promise.all(pages.map(videoState));
    return states.every((state) => state.revision === states[0]?.revision);
  }).toBe(true);
  const states = await Promise.all(pages.map(videoState));
  expect(states.every((state) => state.playing === states[0]?.playing)).toBe(true);
  for (const state of states) expect(Math.abs(state.time - states[0]!.time)).toBeLessThanOrEqual(1);
  return states[0]!;
}

test("local playback, revision ordering, stale-state rejection, and concurrent controls converge", async ({ browser, baseURL }) => {
  const clients = await createClients(browser, baseURL!, ["Host", "Guest A", "Guest B"]);
  const [host, guestA, guestB] = clients.clients;
  const pages = clients.clients.map((client) => client.page);

  try {
    await createRoom(host.page, host.name);
    const invitation = await getInvitation(host.page);
    await joinRoom(guestA.page, invitation!, guestA.name);
    await chooseLocalFixture(host.page, baseURL!);
    await joinRoom(guestB.page, invitation!, guestB.name);
    for (const page of [guestA.page, guestB.page]) {
      await expect(page.getByTestId("video-state")).toHaveAttribute("data-revision", "1");
      await expect.poll(async () => (await mediaState(page)).readyState).toBeGreaterThanOrEqual(1);
      await page.getByTestId("shared-video").evaluate((video: HTMLVideoElement) => { video.muted = true; });
    }
    await Promise.all(pages.map(trackVideoActionEmits));

    await emitSocketEvent(guestA.page, "video:action", { action: "play", currentTime: 0 });
    await expect.poll(async () => (await videoState(host.page)).playing).toBe(true);
    await expectSameFinalVideoState(pages);
    await expect.poll(async () => (await mediaState(host.page)).paused).toBe(false);
    expect(await Promise.all(pages.map(videoActionEmitCount))).toEqual([0, 1, 0]);

    await emitSocketEvent(host.page, "video:action", { action: "pause", currentTime: 1.2 });
    await expect.poll(async () => (await videoState(guestB.page)).playing).toBe(false);
    await expectSameFinalVideoState(pages);
    await expect.poll(async () => (await mediaState(guestA.page)).paused).toBe(true);
    expect(await Promise.all(pages.map(videoActionEmitCount))).toEqual([1, 1, 0]);

    await emitSocketEvent(guestB.page, "video:action", { action: "seek", currentTime: 2.2 });
    await expect.poll(async () => Math.abs((await mediaState(host.page)).currentTime - 2.2)).toBeLessThanOrEqual(1);
    const latest = await expectSameFinalVideoState(pages);
    expect(await Promise.all(pages.map(videoActionEmitCount))).toEqual([1, 1, 1]);
    expect(latest.revision).toBeGreaterThanOrEqual(4);

    await injectStaleVideoState(host.page, latest.revision - 1);
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", String(latest.revision));
    expect(await videoState(host.page)).toEqual(latest);

    const revisionBeforeConcurrentActions = latest.revision;
    await Promise.all([
      emitSocketEvent(host.page, "video:action", { action: "seek", currentTime: 1.25 }),
      emitSocketEvent(guestA.page, "video:action", { action: "play", currentTime: 3.1 }),
      emitSocketEvent(guestB.page, "video:action", { action: "pause", currentTime: 4.4 }),
    ]);
    await expect.poll(async () => (await videoState(host.page)).revision).toBeGreaterThan(revisionBeforeConcurrentActions);
    const finalState = await expectSameFinalVideoState(pages);
    expect(finalState.revision).toBeGreaterThan(revisionBeforeConcurrentActions);
    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});
