import { defineConfig } from "@playwright/test";

/// Assumes the API and web dev server are already running. Port 3000 is often
/// taken by another project, so the base URL is configurable.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
