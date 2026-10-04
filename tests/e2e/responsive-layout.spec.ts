import { expect, test } from "@playwright/test";
import { createClients, createRoom } from "./helpers";

const widths = [375, 430, 768, 1024, 1440, 1920];

test("landing and cinema room fit supported widths and room drawer adapts to touch screens", async ({ browser, baseURL }) => {
  const clients = await createClients(browser, baseURL!, ["Responsive Host"]);
  const page = clients.clients[0]!.page;
  try {
    await page.goto("/");
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await createRoom(page, "Responsive Host");
    const drawer = page.getByRole("complementary", { name: "Люди" });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(drawer).toBeVisible();
      if (width < 768) await expect.poll(() => drawer.evaluate((node) => getComputedStyle(node).position)).toBe("fixed");
      else await expect.poll(() => drawer.evaluate((node) => getComputedStyle(node).position)).not.toBe("fixed");
      const target = await page.getByRole("button", { name: "Добавить", exact: true }).boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }
    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});
