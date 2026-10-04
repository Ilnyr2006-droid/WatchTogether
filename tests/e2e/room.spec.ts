import { expect, test } from "@playwright/test";
import {
  createClients,
  createRoom,
  getInvitation,
  joinRoom,
  openRoomTab,
  participantSnapshot,
  waitForParticipant,
} from "./helpers";

test("Host and two Guests join, share chat, and reconnect without losing identity or role", async ({ browser, baseURL }) => {
  const clients = await createClients(browser, baseURL!, ["Host", "Guest A", "Guest B"]);
  const [host, guestA, guestB] = clients.clients;

  try {
    await createRoom(host.page, host.name);
    await expect(host.page.getByTestId("participant").filter({ hasText: "Host" })).toHaveAttribute("data-is-host", "true");
    await expect(host.page.getByTestId("participant-count")).toHaveText("1");
    const invitation = await getInvitation(host.page);
    expect(invitation).toContain("127.0.0.1:4173");

    await joinRoom(guestA.page, invitation!, guestA.name);
    await waitForParticipant(host.page, guestA.name, 2);
    await joinRoom(guestB.page, invitation!, guestB.name);

    for (const client of [host, guestA, guestB]) {
      await waitForParticipant(client.page, "Host", 3);
      await waitForParticipant(client.page, "Guest A", 3);
      await waitForParticipant(client.page, "Guest B", 3);
    }
    const expectedParticipants = await participantSnapshot(host.page);
    expect(expectedParticipants).toHaveLength(3);
    const hostId = expectedParticipants.find((participant) => participant.name === "Host")?.id;
    expect(await participantSnapshot(guestA.page)).toEqual(expectedParticipants);
    expect(await participantSnapshot(guestB.page)).toEqual(expectedParticipants);

    for (const client of [host, guestA, guestB]) await openRoomTab(client.page, "Чат");

    await host.page.getByLabel("Сообщение в чате").fill("Привет, комната!");
    await host.page.getByRole("button", { name: "Отправить" }).click();
    for (const client of [host, guestA, guestB]) {
      await expect(client.page.getByText("Привет, комната!", { exact: true })).toHaveCount(1);
    }

    await guestA.page.getByLabel("Сообщение в чате").fill("Ответ Guest A");
    await guestA.page.getByRole("button", { name: "Отправить" }).click();
    for (const client of [host, guestA, guestB]) {
      await expect(client.page.getByText("Ответ Guest A", { exact: true })).toHaveCount(1);
    }

    await openRoomTab(host.page, "Люди");
    await host.page.getByLabel("Кто управляет видео").selectOption("approved");
    await openRoomTab(guestB.page, "Люди");
    await expect(guestB.page.getByRole("button", { name: "Запросить управление" })).toBeEnabled();
    await guestB.page.getByRole("button", { name: "Запросить управление" }).click();
    await expect(host.page.getByText("Guest B просит управление")).toBeVisible();
    await host.page.getByRole("button", { name: "Отклонить" }).click();
    await expect(host.page.getByText("Запросов пока нет")).toBeVisible();
    await openRoomTab(guestA.page, "Люди");
    await guestA.page.getByRole("button", { name: "Запросить управление" }).click();
    await expect(host.page.getByText("Guest A просит управление")).toBeVisible();
    await host.page.getByRole("button", { name: "Разрешить" }).click();
    await expect(guestA.page.getByRole("button", { name: "Управление разрешено" })).toBeDisabled();

    const guestAId = (await participantSnapshot(guestA.page)).find((participant) => participant.name === "Guest A")?.id;
    const guestBId = (await participantSnapshot(guestB.page)).find((participant) => participant.name === "Guest B")?.id;
    expect(guestAId).toBeTruthy();
    expect(guestBId).toBeTruthy();

    await guestA.page.reload();
    await waitForParticipant(guestA.page, "Guest A", 3);
    await openRoomTab(guestA.page, "Люди");
    await expect(guestA.page.getByRole("button", { name: "Управление разрешено" })).toBeDisabled();
    expect((await participantSnapshot(guestA.page)).find((participant) => participant.name === "Guest A")?.id).toBe(guestAId);
    for (const client of [host, guestA, guestB]) {
      await waitForParticipant(client.page, "Guest A", 3);
      await expect(client.page.getByText("Привет, комната!", { exact: true })).toHaveCount(1);
      await expect(client.page.getByText("Ответ Guest A", { exact: true })).toHaveCount(1);
    }

    await host.page.reload();
    await openRoomTab(host.page, "Люди");
    await expect(host.page.getByLabel("Кто управляет видео")).toHaveValue("approved");
    await expect(host.page.getByTestId("participant").filter({ hasText: "Host" })).toHaveAttribute("data-is-host", "true");
    await waitForParticipant(host.page, "Host", 3);
    for (const client of [host, guestA, guestB]) {
      await waitForParticipant(client.page, "Guest A", 3);
      await waitForParticipant(client.page, "Guest B", 3);
    }
    const afterHostReload = await participantSnapshot(host.page);
    expect(afterHostReload).toHaveLength(3);
    expect(afterHostReload.find((participant) => participant.name === "Host")?.id).toBe(hostId);
    expect(afterHostReload.find((participant) => participant.name === "Guest B")?.id).toBe(guestBId);
    expect(await participantSnapshot(guestA.page)).toEqual(afterHostReload);
    expect(await participantSnapshot(guestB.page)).toEqual(afterHostReload);
    await expect(host.page.getByText("Привет, комната!", { exact: true })).toHaveCount(1);
    await expect(host.page.getByText("Ответ Guest A", { exact: true })).toHaveCount(1);
    await expect(guestA.page.getByRole("button", { name: "Управление разрешено" })).toBeDisabled();

    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});
