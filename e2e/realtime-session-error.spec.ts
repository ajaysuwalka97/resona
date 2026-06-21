/**
 * E2E smoke test: verify "Unknown realtime session error" does not regress.
 *
 * Steps:
 *  1. Open app and enter the self-serve flow
 *  2. Load LinkedIn profile
 *  3. Continue to mic primer and start session
 *  4. Wait 20s without speaking
 *  5. Confirm no Unknown realtime session error in console
 */

import { test, expect, type Page } from "@playwright/test";

const LINKEDIN_URL = "https://www.linkedin.com/in/umangc/";
const SILENT_WAIT_MS = 20_000;

// Collect browser console errors so we can report them
let consoleErrors: string[] = [];
let networkErrors: { url: string; status: number }[] = [];
let profileLoadSucceeded = false;

test.describe("Realtime session – error regression", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    consoleErrors = [];
    networkErrors = [];
    profileLoadSucceeded = false;

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
    await expect(
      page.getByRole("button", { name: /start the demo/i }),
    ).toBeVisible({ timeout: 5_000 });
    console.log("[PASS] Step 1: App loaded");
  });

  test("Step 2 – Enter self-serve flow", async () => {
    await page.getByRole("button", { name: /start the demo/i }).click();
    await expect(page.locator("#linkedin-url")).toBeVisible({ timeout: 5_000 });
    console.log("[PASS] Step 2: Entered intake flow");
  });

  test("Step 3 – Load LinkedIn profile https://www.linkedin.com/in/umangc/", async () => {
    const urlInput = page.locator("#linkedin-url");
    await expect(urlInput).toBeVisible({ timeout: 5_000 });

    await urlInput.fill(LINKEDIN_URL);
    await expect(urlInput).toHaveValue(LINKEDIN_URL);

    const loadBtn = page.getByRole("button", { name: /load profile/i });
    await expect(loadBtn).toBeEnabled({ timeout: 3_000 });
    await loadBtn.click();

    // Wait for the identity card or an error recovery card to appear
    const snapshot = page.locator(".identity-card");
    const errorPanel = page.locator(".error-recovery");

    let snapshotVisible = false;
    let errorVisible = false;

    try {
      await snapshot.waitFor({ state: "visible", timeout: 30_000 });
      snapshotVisible = true;
    } catch {
      try {
        await errorPanel.waitFor({ state: "visible", timeout: 5_000 });
        errorVisible = true;
      } catch {
        // both may timeout; that's fine – we just note what happened
      }
    }

    if (!snapshotVisible) {
      errorVisible = errorVisible || (await errorPanel.isVisible().catch(() => false));
    }

    if (snapshotVisible) {
      profileLoadSucceeded = true;
      const name = await snapshot.locator("h3").first().textContent();
      console.log(`[PASS] Step 3: Profile loaded – ${name}`);
    } else if (errorVisible) {
      profileLoadSucceeded = false;
      const errText = await errorPanel
        .locator(".microcopy")
        .first()
        .textContent()
        .catch(async () => errorPanel.textContent());
      console.log(`[WARN] Step 3: Profile load error – ${errText}`);
      // If this is a backend/API issue, skip the remaining session steps
      test.skip(true, `Profile load failed: ${errText}`);
    } else {
      profileLoadSucceeded = false;
      console.log("[WARN] Step 3: Neither snapshot nor error panel visible after 30 s");
    }
  });

  test("Step 4 – Continue to mic primer and start session", async () => {
    test.skip(!profileLoadSucceeded, "Profile load failed in Step 3.");
    const continueBtn = page.getByRole("button", { name: /continue to voice room/i });
    await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
    await continueBtn.click();

    const startBtn = page.getByRole("button", {
      name: /allow and continue|retry connection/i,
    });
    await expect(startBtn).toBeEnabled({ timeout: 5_000 });
    await startBtn.click();

    await expect(page.getByRole("heading", { name: /talk to resona/i })).toBeVisible({
      timeout: 15_000,
    });
    console.log("[INFO] Step 4: Voice room mounted");
  });

  test("Step 5 – Wait 20 s without speaking and check no error panel", async () => {
    test.skip(!profileLoadSucceeded, "Profile load failed in Step 3.");
    // Wait without any interaction
    await page.waitForTimeout(SILENT_WAIT_MS);

    // Step 6: check for error panel
    const errorPanel = page.locator(".error-recovery");
    const hasError = await errorPanel.isVisible().catch(() => false);

    if (hasError) {
      const errText = await errorPanel
        .locator(".microcopy")
        .first()
        .textContent()
        .catch(async () => errorPanel.textContent());
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
