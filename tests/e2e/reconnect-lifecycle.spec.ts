import { expect, test } from "@playwright/test";
import {
  createClients,
  createRoom,
  disconnectSocket,
  getInvitation,
  joinRoom,
  participantSnapshot,
  reconnectSocket,
} from "./helpers";

test("grace transfer, expired session rejection, and owner recovery after expiry and explicit leave", async ({ browser, baseURL }) => {
  test.setTimeout(100_000);
  const clients = await createClients(browser, baseURL!, ["Host", "Guest A", "Expired Guest"]);
  const [host, guestA, expiredGuest] = clients.clients;

  try {
    await createRoom(host.page, host.name);
    const invitation = await getInvitation(host.page);
    await joinRoom(guestA.page, invitation!, guestA.name);
    await joinRoom(expiredGuest.page, invitation!, expiredGuest.name);
    const initial = await participantSnapshot(host.page);
    expect(initial).toHaveLength(3);
    const originalHostId = initial.find((person) => person.name === host.name)?.id;
    const expiredGuestId = initial.find((person) => person.name === expiredGuest.name)?.id;
    expect(originalHostId).toBeTruthy();
    expect(expiredGuestId).toBeTruthy();

    await disconnectSocket(host.page);
    await disconnectSocket(expiredGuest.page);
    await expect.poll(async () => participantSnapshot(guestA.page), { timeout: 40_000, intervals: [250, 500, 1_000] }).toEqual([
      expect.objectContaining({ name: guestA.name, connected: true, isHost: true }),
    ]);

    await reconnectSocket(expiredGuest.page);
    await expect(expiredGuest.page.getByText("Неверное приглашение или комната недоступна", { exact: true })).toBeVisible();
    expect(await participantSnapshot(guestA.page)).toHaveLength(1);
    expect((await participantSnapshot(guestA.page))[0]?.id).not.toBe(expiredGuestId);

    await reconnectSocket(host.page);
    await expect(host.page.getByLabel("Кто управляет видео")).toBeVisible();
    await expect(host.page.getByTestId("participant-count")).toHaveText("2");
    await expect.poll(async () => participantSnapshot(guestA.page), { timeout: 10_000 }).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: host.name, connected: true, isHost: true }),
      expect.objectContaining({ name: guestA.name, connected: true, isHost: false }),
    ]));
    const recoveredHost = (await participantSnapshot(host.page)).find((person) => person.name === host.name);
    expect(recoveredHost?.id).toBeTruthy();
    expect(recoveredHost?.id).not.toBe(originalHostId);
    expect((await participantSnapshot(host.page)).filter((person) => person.name === host.name)).toHaveLength(1);

    await host.page.getByRole("button", { name: /Выйти/ }).click();
    await expect(host.page).toHaveURL(/\/$/);
    await expect.poll(async () => participantSnapshot(guestA.page), { timeout: 5_000 }).toEqual([
      expect.objectContaining({ name: guestA.name, connected: true, isHost: true }),
    ]);

    await joinRoom(host.page, invitation!, host.name);
    await expect(host.page.getByLabel("Кто управляет видео")).toBeVisible();
    await expect(host.page.getByTestId("participant-count")).toHaveText("2");
    await expect.poll(async () => participantSnapshot(guestA.page), { timeout: 10_000 }).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: host.name, connected: true, isHost: true }),
      expect.objectContaining({ name: guestA.name, connected: true, isHost: false }),
    ]));
    expect((await participantSnapshot(host.page)).filter((person) => person.name === host.name)).toHaveLength(1);

    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});
