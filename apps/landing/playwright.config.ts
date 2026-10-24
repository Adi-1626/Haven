import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 3,
  outputDir: "../../output/landing-premium-20261024/playwright-artifacts",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          "../../output/landing-premium-20261024/playwright-results.json",
      },
    ],
  ],
  use: {
    actionTimeout: 10000,
    baseURL: "http://127.0.0.1:4184",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    // Firefox needs its native Windows runtime. Opt in on a configured host.
    ...(process.env.HAVEN_INCLUDE_FIREFOX
      ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] } }]
      : []),
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4184 --strictPort",
    url: "http://127.0.0.1:4184",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
