import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
  },
  webServer: {
    command: "cross-env HOSTNAME=127.0.0.1 WATCHTOGETHER_PORT=4173 WATCHTOGETHER_E2E=true npm run dev",
    url: `${baseURL}/api/network-info`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
