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
  await expect(page.locator("h1")).toBeVisible({ timeout: 8_000 });

  // 2. Preflight
  await page.getByRole("button", { name: /check realtime readiness/i }).click();
  await page
    .locator("article")
    .filter({ hasText: /pre-flight/i })
    .locator("p")
    .first()
    .waitFor({ state: "visible" });
  await page.waitForTimeout(3_000);

  const preflightStatus = await page
    .locator("article")
    .filter({ hasText: /pre-flight/i })
    .locator("p")
    .first()
    .textContent();
  console.log("PREFLIGHT:", preflightStatus);

  // 3. Load LinkedIn profile
  await page.locator("#linkedin-url").fill(LINKEDIN_URL);
  await page.getByRole("button", { name: /load profile context/i }).click();
  await page.locator(".snapshot").waitFor({ state: "visible", timeout: 30_000 });
  const profileName = await page.locator(".snapshot strong").first().textContent();
  console.log("PROFILE:", profileName);

  // 4. Start session – capture what happens immediately
  await page.getByRole("button", { name: /start resona session/i }).click();

  // Wait for either "connected" state or error panel (whichever comes first, 30 s max)
  const errorPanel = page.locator(".error-panel");
  const sessionStateP = page
    .locator("section")
    .filter({ hasText: /realtime voice wall/i })
    .locator("p")
    .first();

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1_000);
    const stateText = await sessionStateP.textContent();
    const errVisible = await errorPanel.isVisible().catch(() => false);
    if (errVisible || (stateText ?? "").includes("connected")) {
      break;
    }
  }

  // 5. Wait 20 s silent
  await page.waitForTimeout(20_000);

  // Capture final UI state
  const finalState = await sessionStateP.textContent();
  const errorVisible = await errorPanel.isVisible().catch(() => false);
  const errorText = errorVisible
    ? await errorPanel.locator("p").textContent()
    : null;

  // Screenshot always
  await page.screenshot({
    path: "e2e/screenshots/diagnostic-final.png",
    fullPage: true,
  });

  // Print full report
  console.log("\n========= DIAGNOSTIC REPORT =========");
  console.log("Final session state:", finalState);
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
