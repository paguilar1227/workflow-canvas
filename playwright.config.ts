import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = path.dirname(fileURLToPath(import.meta.url));
process.env.EVIDENCE_DIR ||= path.join(root, 'test-results', 'evidence');

const viewport = { width: 1440, height: 900 };
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 14'];

/**
 * Human user-journey suite. Every test records a video and explicit screenshots.
 * Tests run one at a time: theme and panel visibility are server-global session settings
 * (theme is broadcast live to every open tab), so parallel journeys would leak into each other's evidence.
 *
 * Projects: `chromium` runs the desktop journeys (e2e/*.spec.ts) with mouse and keyboard; `phone` runs the same
 * user stories the way a phone user does them (e2e/phone/*.spec.ts): iPhone 14 viewport, user agent and touch on
 * Chromium, so CDP Input.dispatchTouchEvent can drive long-press, pinch and one-finger drags.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'test-results/artifacts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['./e2e/support/evidence-reporter.ts'],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8792',
    viewport,
    video: { mode: 'on', size: viewport },
    screenshot: 'on',
    trace: 'retain-on-failure',
    acceptDownloads: true,
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'chromium', testIgnore: /phone\//, use: { ...devices['Desktop Chrome'], viewport, deviceScaleFactor: 1 } },
    {
      name: 'phone',
      testMatch: /phone\/.*\.spec\.ts/,
      use: { ...iPhone, browserName: 'chromium', video: { mode: 'on', size: iPhone.viewport } },
    },
  ],
});
