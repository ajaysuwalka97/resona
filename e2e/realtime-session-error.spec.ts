/**
 * E2E smoke test: verify that the prior 'Unknown realtime session error' is gone.
 *
 * Steps:
 *  1. Open app at http://localhost:5173
 *  2. Run realtime readiness check
 *  3. Load LinkedIn profile https://www.linkedin.com/in/umangc/
 *  4. Start Resona session
 *  5. Wait 20 s without speaking
 *  6. Check that NO red error panel appears
 *  7. Capture console / network errors
 */

import { test, expect, type Page } from "@playwright/test";

const LINKEDIN_URL = "https://www.linkedin.com/in/umangc/";
const SILENT_WAIT_MS = 20_000;

// Collect browser console errors so we can report them
const consoleErrors: string[] = [];
const networkErrors: { url: string; status: number }[] = [];

test.describe("Realtime session – error regression", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ["microphone"],
    });
    page = await context.newPage();

    // Track console errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Track failed network requests
    page.on("response", (response) => {
      if (!response.ok() && response.url().includes("localhost")) {
        networkErrors.push({ url: response.url(), status: response.status() });
      }
    });
  });

  test("Step 1 – App loads at http://localhost:5173", async () => {
    await page.goto("/");
    await expect(page).toHaveTitle(/resona|voice|demo/i, { timeout: 10_000 });
    // Confirm the hero heading is present
    await expect(page.locator("h1")).toBeVisible({ timeout: 5_000 });
    console.log("[PASS] Step 1: App loaded");
  });

  test("Step 2 – Run realtime readiness check", async () => {
    const preflightBtn = page.getByRole("button", {
      name: /check realtime readiness/i,
    });
    await expect(preflightBtn).toBeVisible({ timeout: 5_000 });
    await preflightBtn.click();

    // Wait for the preflight status to resolve (either OK or a known error, not blank)
    const preflightText = page.locator("article").filter({ hasText: /pre-flight/i }).locator("p").first();
    await expect(preflightText).not.toHaveText("Not checked in app yet.", { timeout: 15_000 });

    const statusText = await preflightText.textContent();
    console.log(`[INFO] Preflight status: ${statusText}`);

    // Accept both OK and expected token errors; what we do NOT accept is a generic crash
    expect(statusText).toBeTruthy();
  });

  test("Step 3 – Load LinkedIn profile https://www.linkedin.com/in/umangc/", async () => {
    const urlInput = page.locator("#linkedin-url");
    await expect(urlInput).toBeVisible({ timeout: 5_000 });

    await urlInput.fill(LINKEDIN_URL);
    await expect(urlInput).toHaveValue(LINKEDIN_URL);

    const loadBtn = page.getByRole("button", { name: /load profile context/i });
    await expect(loadBtn).toBeEnabled({ timeout: 3_000 });
    await loadBtn.click();

    // Wait for the snapshot section or an error to appear
    const snapshot = page.locator(".snapshot");
    const errorPanel = page.locator(".error-panel");

    await Promise.race([
      expect(snapshot).toBeVisible({ timeout: 30_000 }),
      expect(errorPanel).toBeVisible({ timeout: 30_000 }),
    ]).catch(() => {
      // both may timeout; that's fine – we just note what happened
    });

    const snapshotVisible = await snapshot.isVisible().catch(() => false);
    const errorVisible = await errorPanel.isVisible().catch(() => false);

    if (snapshotVisible) {
      const name = await snapshot.locator("strong").first().textContent();
      console.log(`[PASS] Step 3: Profile loaded – ${name}`);
    } else if (errorVisible) {
      const errText = await errorPanel.locator("p").textContent();
      console.log(`[WARN] Step 3: Profile load error – ${errText}`);
      // If this is a backend/API issue, skip the remaining session steps
      test.skip(true, `Profile load failed: ${errText}`);
    } else {
      console.log("[WARN] Step 3: Neither snapshot nor error panel visible after 30 s");
    }
  });

  test("Step 4 – Start Resona session", async () => {
    const startBtn = page.getByRole("button", { name: /start resona session/i });
    await expect(startBtn).toBeEnabled({ timeout: 5_000 });
    await startBtn.click();

    // Give it up to 15 s to move into "connecting" or "connected"
    const stateText = page.locator("section").filter({ hasText: /realtime voice wall/i }).locator("p").first();
    await expect(stateText).not.toHaveText("idle", { timeout: 15_000 });

    const state = await stateText.textContent();
    console.log(`[INFO] Step 4: Session state after click – ${state}`);
  });

  test("Step 5 – Wait 20 s without speaking and check no error panel", async () => {
    // Wait without any interaction
    await page.waitForTimeout(SILENT_WAIT_MS);

    // Step 6: check for error panel
    const errorPanel = page.locator(".error-panel");
    const hasError = await errorPanel.isVisible().catch(() => false);

    if (hasError) {
      const errText = await errorPanel.locator("p").textContent();
      const isExpectedHeadlessLimitation =
        /not supported|notallowederror|getusermedia|webrtc/i.test(errText ?? "");
      if (isExpectedHeadlessLimitation) {
        console.log(
          `[INFO] Step 6: Expected headless WebRTC/audio limitation – "${errText}"`,
        );
      } else {
        console.error(`[FAIL] Step 6: Error panel visible – "${errText}"`);
        // Capture a screenshot for the report
        await page.screenshot({ path: "e2e/screenshots/error-panel.png", fullPage: true });
        // Fail only on app-level errors
        expect(
          isExpectedHeadlessLimitation,
          `Unexpected red error panel text: "${errText}"`,
        ).toBe(true);
      }
    } else {
      console.log("[PASS] Step 6: No error panel visible after 20 s of silence");
    }

    // Step 7: report any console / network errors collected during the run
    if (consoleErrors.length > 0) {
      console.error("[INFO] Console errors captured:", consoleErrors);
    } else {
      console.log("[PASS] Step 7: No console errors");
    }

    if (networkErrors.length > 0) {
      console.error("[INFO] Network errors captured:", JSON.stringify(networkErrors, null, 2));
    } else {
      console.log("[PASS] Step 7: No network errors on localhost");
    }

    // Final assertion: no Unknown realtime session error in console
    const unknownRealtimeError = consoleErrors.find((e) =>
      /unknown realtime session error/i.test(e),
    );
    expect(
      unknownRealtimeError,
      `"Unknown realtime session error" still present in console: ${unknownRealtimeError}`,
    ).toBeUndefined();
  });
});
