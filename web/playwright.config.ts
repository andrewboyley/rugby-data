import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 2,
  use: {
    baseURL: "http://localhost:5173",
    browserName: "chromium",
    launchOptions: { executablePath: "/usr/bin/chromium" },
  },
});
