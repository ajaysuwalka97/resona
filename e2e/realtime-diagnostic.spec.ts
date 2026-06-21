/**
 * Diagnostic test: capture full console + network detail around the "Not supported" error
 * and confirm "Unknown realtime session error" is absent.
 */
import { test, expect, type Page } from "@playwright/test";

const LINKEDIN_URL = "https://www.linkedin.com/in/umangc/";

test("Diagnostic – capture all console + network events during session start", async ({
  browser,
}) => {
  const context = await browser.newContext({
    permissions: ["microphone"],
  });
  const page: Page = await context.newPage();

  const consoleMessages: { type: string; text: string }[] = [];
  const networkLog: { url: string; status: number; ok: boolean }[] = [];

  page.on("console", (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (err) => {
    consoleMessages.push({ type: "pageerror", text: err.message });
  });
  page.on("response", (response) => {
    if (response.url().includes("localhost")) {
      networkLog.push({
        url: response.url(),
        status: response.status(),
        ok: response.ok(),
      });
    }
  });

  // 1. Load app
  await page.goto("/");
  await expect(page.getByRole("button", { name: /start the demo/i })).toBeVisible({
    timeout: 8_000,
  });
  await page.getByRole("button", { name: /start the demo/i }).click();
  await expect(page.locator("#linkedin-url")).toBeVisible({ timeout: 8_000 });

  // 2. Load LinkedIn profile
  await page.locator("#linkedin-url").fill(LINKEDIN_URL);
  await page.getByRole("button", { name: /load profile/i }).click();
  await page.locator(".identity-card").waitFor({ state: "visible", timeout: 30_000 });
  const profileName = await page.locator(".identity-card h3").first().textContent();
  console.log("PROFILE:", profileName);

  // 3. Start session – capture what happens immediately
  await page.getByRole("button", { name: /continue to voice room/i }).click();
  await page
    .getByRole("button", { name: /allow and continue|retry connection/i })
    .click();

  // Wait for either room visibility or error panel (whichever comes first, 30 s max)
  const errorPanel = page.locator(".error-recovery");
  const roomHeading = page.getByRole("heading", { name: /talk to resona/i });

  await Promise.race([
    roomHeading.waitFor({ state: "visible", timeout: 30_000 }),
    errorPanel.waitFor({ state: "visible", timeout: 30_000 }),
  ]).catch(() => undefined);

  // 4. Wait 20 s silent
  await page.waitForTimeout(20_000);

  // Capture final UI state
  const roomVisible = await roomHeading.isVisible().catch(() => false);
  const errorVisible = await errorPanel.isVisible().catch(() => false);
  const errorText = errorVisible
    ? await errorPanel
      .locator(".microcopy")
      .first()
      .textContent()
      .catch(async () => errorPanel.textContent())
    : null;

  // Screenshot always
  await page.screenshot({
    path: "e2e/screenshots/diagnostic-final.png",
    fullPage: true,
  });

  // Print full report
  console.log("\n========= DIAGNOSTIC REPORT =========");
  console.log("Voice room visible:", roomVisible);
  console.log("Error panel visible:", errorVisible);
  console.log("Error panel text:", errorText);
  console.log("\n--- Console messages ---");
  consoleMessages.forEach((m) => console.log(`[${m.type}] ${m.text}`));
  console.log("\n--- Network log (localhost only) ---");
  networkLog.forEach((n) =>
    console.log(`${n.ok ? "OK" : "FAIL"} ${n.status} ${n.url}`),
  );
  console.log("=====================================\n");

  // Assertions
  const unknownError = consoleMessages.find((m) =>
    /unknown realtime session error/i.test(m.text),
  );
  expect(
    unknownError,
    `"Unknown realtime session error" found in console: ${unknownError?.text}`,
  ).toBeUndefined();

  // Classify the error
  if (errorVisible && errorText) {
    const isWebRTCNotSupported =
      /not supported|notallowederror|getusermedia|webrtc/i.test(errorText);
    console.log(
      isWebRTCNotSupported
        ? `[EXPECTED IN HEADLESS] WebRTC/audio limitation: "${errorText}"`
        : `[UNEXPECTED APP ERROR]: "${errorText}"`,
    );
    // Flag if it looks like an app-level error (not WebRTC)
    expect(
      isWebRTCNotSupported,
      `Unexpected app-level error in panel: "${errorText}"`,
    ).toBe(true);
  }
});
