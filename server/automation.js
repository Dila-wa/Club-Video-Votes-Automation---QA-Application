const path = require('path');
const { chromium } = require('playwright');
const config = require('./config');

const SUCCESS_PATTERNS = [
  /thank you/i,
  /thanks for/i,
  /submission (has been|was) received/i,
  /your response has been recorded/i,
  /vote has been (recorded|submitted)/i,
];

// NOTE: "only one vote per 24-hour period" is NOT a failure signal here - it's
// static disclaimer copy that appears on both the voting page and the
// thank-you page, so it must not be matched as a rejection.
const FAILURE_PATTERNS = [
  /already (submitted|voted|responded)/i,
  /you('?| ha)ve already (submitted|voted|responded)/i,
  /multiple submissions are not allowed/i,
  /something went wrong/i,
  /please (complete|fill)/i,
  /this field is required/i,
  /invalid email/i,
];

function sanitizeForFilename(value) {
  return value.replace(/[^a-z0-9]/gi, '_').slice(0, 60);
}

async function submitVote(email, settings, logger) {
  const browser = await chromium.launch({ headless: settings.headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    logger.info(`Opening form for ${email}...`);
    await page.goto(config.FORM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    logger.info(`Selecting "${settings.videoLabel}"...`);
    const radio = page.getByLabel(settings.videoLabel, { exact: true });
    await radio.scrollIntoViewIfNeeded();

    // Jotform wraps the real <input> in a decorative <span class="form-radio-item">
    // that sits on top of it, so a direct click on the input is intercepted.
    // Click the visible label text first (how a real visitor selects it); if
    // anything still intercepts that, fall back to setting the native
    // `checked` state and firing the events Jotform listens for.
    try {
      await page.getByText(settings.videoLabel, { exact: true }).first().click({ timeout: 5000 });
    } catch (err) {
      logger.warn(`Label click was intercepted, falling back to a direct check: ${err.message.split('\n')[0]}`);
    }

    const alreadyChecked = await radio.isChecked().catch(() => false);
    if (!alreadyChecked) {
      await radio.evaluate((el) => {
        el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click', { bubbles: true }));
      });
    }

    logger.info(`Filling email field with ${email}...`);
    const emailField = page.getByLabel(/email/i).first();
    await emailField.fill(email);

    logger.info('Clicking submit...');
    const submitButton = page.getByRole('button', { name: /submit/i }).first();
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
      submitButton.click(),
    ]);

    await page.waitForTimeout(1500);

    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    const url = page.url();

    const success = SUCCESS_PATTERNS.some((p) => p.test(bodyText)) || /thank[-_]?you/i.test(url);
    const failureMatch = FAILURE_PATTERNS.find((p) => p.test(bodyText));

    let message;
    let ok;

    if (success && !failureMatch) {
      ok = true;
      message = 'Submission confirmed (thank-you detected).';
    } else if (failureMatch) {
      ok = false;
      message = `Rejected by form (matched pattern: ${failureMatch}).`;
    } else {
      ok = false;
      message = 'Unclear result - no explicit thank-you or error text detected.';
    }

    if (!ok) {
      const shotFile = `${Date.now()}-${sanitizeForFilename(email)}.png`;
      const shotPath = path.join(config.SCREENSHOT_DIR, shotFile);
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      message += ` Screenshot saved: /screenshots/${shotFile}`;
    }

    return { success: ok, message };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { submitVote };
