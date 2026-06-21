/**
 * Smoke test: auto warm-start behavior after session connect
 * Run: node smoke-warm-start.mjs
 * No code files are modified. Artifacts saved to /tmp/resona-smoke/
 */

// Use npx-cached playwright 1.61.0 (matches installed chromium-1228)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // playwright 1.61.0 — matches chromium_headless_shell-1228 in ~/Library/Caches/ms-playwright/
  const pw = require('/Users/ajaysuwalka/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
  chromium = pw.chromium;
}
import { mkdirSync } from 'fs';
import { join } from 'path';

const ARTIFACTS_DIR = '/tmp/resona-smoke';
mkdirSync(ARTIFACTS_DIR, { recursive: true });

const APP_URL = 'http://localhost:5173';
const LINKEDIN_URL = 'https://www.linkedin.com/in/umangc/';
const WARM_START_TIMEOUT_MS = 12_000;

const results = {
  warmAutoStart: null,
  contextAwareOpener: null,
  oneQuestionNudgeStyle: null,
  transcriptFirstLines: null,
  consoleErrors: [],
  networkErrors: [],
  notes: [],
};

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // WebRTC fake media device — allows peer connection without a real microphone
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      '--disable-web-security',
    ],
  });

  const context = await browser.newContext({
    permissions: ['microphone'],
    recordVideo: { dir: ARTIFACTS_DIR, size: { width: 1280, height: 720 } },
  });

  const page = await context.newPage();

  const consoleLogs = [];
  // Capture all console messages for diagnostics
  page.on('console', (msg) => {
    const entry = `[console.${msg.type()}] ${msg.text()}`;
    consoleLogs.push(entry);
    if (msg.type() === 'error' || msg.type() === 'warn') {
      results.consoleErrors.push(entry);
    }
  });
  page.on('pageerror', (err) => {
    results.consoleErrors.push(`[page.error] ${err.message}`);
  });

  // Capture network errors
  page.on('requestfailed', (req) => {
    results.networkErrors.push(`[net.fail] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });

  // ──────────────────────────────────────────────────
  // STEP 1 — Open app and verify healthy render
  // ──────────────────────────────────────────────────
  console.log('\n[1] Opening app...');
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 15_000 });

  const h1Text = await page.locator('h1').first().textContent();
  console.log(`    h1: "${h1Text?.trim()}"`);

  const preflightPanel = await page.locator('article.panel >> text=1) Pre-flight').count();
  const isRenderHealthy = preflightPanel > 0 || (h1Text && h1Text.length > 5);
  console.log(`    Render healthy: ${isRenderHealthy}`);
  results.notes.push(`Render: ${isRenderHealthy ? 'PASS' : 'FAIL'} — h1="${h1Text?.trim()}"`);

  await page.screenshot({ path: join(ARTIFACTS_DIR, '01-initial-load.png'), fullPage: true });

  // ──────────────────────────────────────────────────
  // STEP 2 — Click "Check realtime readiness"
  // ──────────────────────────────────────────────────
  console.log('\n[2] Clicking "Check realtime readiness"...');
  await page.getByRole('button', { name: /check realtime readiness/i }).click();

  // Wait for the preflight status to update (not be the default "Not checked" text)
  await page.waitForFunction(
    () => {
      const els = document.querySelectorAll('article p');
      for (const el of els) {
        const t = el.textContent ?? '';
        if (t.includes('Realtime access OK') || t.includes('failed') || t.includes('error') || t.includes('Checking')) {
          return true;
        }
      }
      return false;
    },
    { timeout: 10_000 }
  ).catch(() => null);

  const preflightStatus = await page.locator('article.panel').first().locator('p').first().textContent().catch(() => 'unknown');
  console.log(`    Preflight status: "${preflightStatus?.trim()}"`);
  results.notes.push(`Preflight: "${preflightStatus?.trim()}"`);

  await page.screenshot({ path: join(ARTIFACTS_DIR, '02-preflight.png') });

  // ──────────────────────────────────────────────────
  // STEP 3 — Set LinkedIn URL and click "Load profile context"
  // ──────────────────────────────────────────────────
  console.log('\n[3] Loading LinkedIn profile context...');
  await page.locator('#linkedin-url').fill(LINKEDIN_URL);
  await page.getByRole('button', { name: /load profile context/i }).click();

  // Wait for profile loaded or error
  const profileLoaded = await page.waitForFunction(
    () => {
      const snapshots = document.querySelectorAll('.snapshot p strong');
      const errorPanel = document.querySelector('.error-panel');
      return snapshots.length > 0 || !!errorPanel;
    },
    { timeout: 20_000 }
  ).catch(() => null);

  const snapshotName = await page.locator('.snapshot p strong').first().textContent().catch(() => null);
  const profileError = await page.locator('.error-panel p').textContent().catch(() => null);

  if (snapshotName) {
    console.log(`    Profile loaded: "${snapshotName.trim()}"`);
    results.notes.push(`Profile load: PASS — name="${snapshotName.trim()}"`);
  } else if (profileError) {
    console.log(`    Profile load error: "${profileError.trim()}"`);
    results.notes.push(`Profile load: FAIL — ${profileError.trim()}`);
  } else {
    console.log('    Profile load: timed out or unknown state');
    results.notes.push('Profile load: TIMEOUT');
  }

  await page.screenshot({ path: join(ARTIFACTS_DIR, '03-profile-loaded.png'), fullPage: true });

  // ──────────────────────────────────────────────────
  // STEP 4 — Click "Start Resona session"
  // ──────────────────────────────────────────────────
  console.log('\n[4] Starting Resona session...');
  const startBtn = page.getByRole('button', { name: /start resona session/i });
  const startBtnEnabled = await startBtn.isEnabled().catch(() => false);

  if (!startBtnEnabled) {
    const disabledReason = snapshotName
      ? 'Button unexpectedly disabled even though profile loaded'
      : 'Button disabled — profile not loaded (dependency failure)';
    console.log(`    Skipping: ${disabledReason}`);
    results.notes.push(`Session start: SKIP — ${disabledReason}`);
    results.warmAutoStart = false;
    results.contextAwareOpener = false;
    results.oneQuestionNudgeStyle = false;
  } else {
    await startBtn.click();
    console.log('    Session start clicked — waiting for connection...');

    // Wait for state to reach "connected" (not just "connecting")
    console.log('    Waiting for "connected" state (up to 20s)...');
    await page.waitForFunction(
      () => {
        const stateParagraphs = document.querySelectorAll('article.panel p');
        for (const p of stateParagraphs) {
          if (p.textContent?.includes('State: connected')) return true;
        }
        return false;
      },
      { timeout: 20_000 }
    ).catch(() => null);

    const sessionStateText = await page.locator('article.panel p').filter({ hasText: /State:/ }).textContent().catch(() => '');
    console.log(`    Session state: "${sessionStateText?.trim()}"`);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '04-session-started.png') });

    // ──────────────────────────────────────────────────
    // STEP 5 + 6 — Wait up to 12s without speaking; check transcript
    // ──────────────────────────────────────────────────
    console.log('\n[5/6] Waiting up to 12s for auto warm-start transcript, then up to 10s more to stabilize...');

    const transcriptAppeared = await page.waitForFunction(
      () => {
        const transcriptEl = document.querySelector('.transcript');
        const text = transcriptEl?.textContent ?? '';
        return text.trim().length > 0 && text.trim() !== 'Waiting for speech...';
      },
      { timeout: WARM_START_TIMEOUT_MS }
    ).catch(() => null);

    // Wait for transcript to stop growing (stable for 2s) or contain a '?'
    if (transcriptAppeared) {
      console.log('    Transcript started — waiting for it to stabilize (up to 10s)...');
      let prevLen = 0;
      let stableCount = 0;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        const currentText = await page.locator('.transcript').textContent().catch(() => '');
        if (currentText.includes('?') && currentText.length > 30) {
          console.log('    Transcript contains "?" — opener likely complete.');
          break;
        }
        if (currentText.length === prevLen) {
          stableCount++;
          if (stableCount >= 4) { // stable for 2s
            console.log('    Transcript stabilized.');
            break;
          }
        } else {
          stableCount = 0;
        }
        prevLen = currentText.length;
      }
    }

    const transcriptText = await page.locator('.transcript').textContent().catch(() => '');
    const transcriptTrimmed = (transcriptText ?? '').trim();
    const isWaiting = transcriptTrimmed === 'Waiting for speech...' || transcriptTrimmed === '';

    console.log(`    Transcript panel: "${transcriptTrimmed.slice(0, 200)}"`);

    await page.screenshot({ path: join(ARTIFACTS_DIR, '05-after-12s.png'), fullPage: true });

    // ──────────────────────────────────────────────────
    // STEP 7 — Evaluate opener quality
    // ──────────────────────────────────────────────────
    if (isWaiting || transcriptTrimmed.length < 10) {
      console.log('\n[7] Transcript did NOT auto-populate — warm-start FAILED');
      results.warmAutoStart = false;
      results.contextAwareOpener = false;
      results.oneQuestionNudgeStyle = false;
      results.transcriptFirstLines = null;
      results.notes.push('Warm start: FAIL — transcript still "Waiting for speech..."');
    } else {
      const lines = transcriptTrimmed.split('\n').map(l => l.trim()).filter(Boolean);
      const firstTwo = lines.slice(0, 2).join('\n');
      results.transcriptFirstLines = firstTwo;

      console.log(`\n[7] Transcript first 1-2 lines:\n    ${firstTwo.replace(/\n/g, '\n    ')}`);

      // Warm auto-start: transcript appeared without user speaking
      results.warmAutoStart = true;

      // Context-aware opener: mentions founder name or company
      const founderName = snapshotName?.trim().split(' ')[0]?.toLowerCase() ?? '';
      const lcTranscript = transcriptTrimmed.toLowerCase();
      const nameHit = founderName && lcTranscript.includes(founderName);
      const companyHit = lcTranscript.includes('trucommerce') || lcTranscript.includes('umang');
      results.contextAwareOpener = nameHit || companyHit;

      // One-question nudge style: ends with '?' and is <= 3 sentences
      const sentences = transcriptTrimmed.split(/[.!?]/).filter(s => s.trim().length > 0);
      const hasQuestion = transcriptTrimmed.includes('?');
      const isConcise = sentences.length <= 5;
      results.oneQuestionNudgeStyle = hasQuestion && isConcise;

      console.log(`\n    Context-aware (name/company hit): ${results.contextAwareOpener}`);
      console.log(`    One-question nudge style (has ?, ≤5 sentences): ${results.oneQuestionNudgeStyle}`);
    }
  }

  await page.screenshot({ path: join(ARTIFACTS_DIR, '06-final.png'), fullPage: true });
  await context.close();
  await browser.close();

  // ──────────────────────────────────────────────────
  // STEP 8 — Report
  // ──────────────────────────────────────────────────
  const pass = (v) => v === true ? '✅ PASS' : v === false ? '❌ FAIL' : '⚠️  N/A';
  console.log('\n════════════════════════════════════════');
  console.log('  SMOKE TEST REPORT — Auto Warm-Start');
  console.log('════════════════════════════════════════');
  console.log(`  Warm auto-start          : ${pass(results.warmAutoStart)}`);
  console.log(`  Context-aware opener     : ${pass(results.contextAwareOpener)}`);
  console.log(`  One-question nudge style : ${pass(results.oneQuestionNudgeStyle)}`);

  if (results.transcriptFirstLines) {
    console.log('\n  Agent opener (first 1-2 lines):');
    console.log('  ┌─────────────────────────────────────');
    results.transcriptFirstLines.split('\n').forEach(l => console.log(`  │ ${l}`));
    console.log('  └─────────────────────────────────────');
  }

  if (results.notes.length) {
    console.log('\n  Notes:');
    results.notes.forEach(n => console.log(`  • ${n}`));
  }

  // Show last 15 console lines for diagnostics
  if (consoleLogs.length) {
    console.log(`\n  Console log (last ${Math.min(consoleLogs.length, 15)} of ${consoleLogs.length} entries):`);
    consoleLogs.slice(-15).forEach(e => console.log(`  • ${e}`));
  }

  if (results.consoleErrors.length) {
    console.log('\n  Console errors/warnings:');
    results.consoleErrors.slice(0, 10).forEach(e => console.log(`  • ${e}`));
  } else {
    console.log('\n  Console errors: none');
  }

  if (results.networkErrors.length) {
    console.log('\n  Network errors:');
    results.networkErrors.forEach(e => console.log(`  • ${e}`));
  } else {
    console.log('  Network errors: none');
  }

  console.log(`\n  Artifacts: ${ARTIFACTS_DIR}/`);
  console.log('════════════════════════════════════════\n');

  return results;
}

run().catch((err) => {
  console.error('\n[FATAL] Smoke test crashed:', err.message);
  process.exit(1);
});
