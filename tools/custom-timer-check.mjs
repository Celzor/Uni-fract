// Focused browser regression for custom turn seconds. The app has no Playwright dependency.
// Configure PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM_EXECUTABLE and TEST_URL as in browser-check.mjs.
import assert from 'node:assert/strict';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { playing } from '../tests/helpers.js';
import { applyRoster, createTable, isValidTable } from '../src/rules.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, 'artifacts');
const baseUrl = new URL(process.env.TEST_URL || 'http://127.0.0.1:4173/');
if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
const errors = [];
const evidence = [];
let browser;
let activePage;

async function loadPlaywright() {
  if (!process.env.PLAYWRIGHT_MODULE) {
    try { return await import('playwright'); }
    catch { throw new Error('Set PLAYWRIGHT_MODULE to an existing Playwright package directory or index.mjs.'); }
  }
  let path = resolve(process.env.PLAYWRIGHT_MODULE);
  if ((await stat(path)).isDirectory()) path = join(path, 'index.mjs');
  return import(pathToFileURL(path).href);
}

async function eventually(description, predicate, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error(`Timed out: ${description}`);
}

const frame = (page, id) => page.frameLocator(`iframe[data-participant-id="${id}"]`);
const savedTable = (view) => view.locator('body').evaluate(() => {
  const init = window.__timerFixture.init;
  return JSON.parse(sessionStorage.getItem(`uni-refract/1:${JSON.stringify([init.sessionId, 1])}`)).table;
});
const snapshot = (view) => view.locator('body').evaluate(() => window.__timerFixture.lastState);
const input = (view) => view.locator('#turn-timer');
const connected = (view) => view.locator('#connection[data-state="connected"]').waitFor();

async function openFixture(table, name) {
  assert.ok(isValidTable(table), `${name}: valid fixture`);
  const context = await browser.newContext({ viewport: { width: 1900, height: 1200 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ table }) => {
    if (parent === window) return;
    window.__timerFixture = { init: null, initializedAt: null, lastState: null, firstTimeoutAt: null };
    addEventListener('message', (event) => {
      if (event.source !== parent || event.data?.protocol !== 'refract-activity/1') return;
      const message = event.data;
      const fixture = window.__timerFixture;
      if (message.type === 'init') {
        fixture.init = message;
        fixture.initializedAt ??= Date.now();
        if (message.self.id === 1) {
          const key = `uni-refract/1:${JSON.stringify([message.sessionId, 1])}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, JSON.stringify({ table, hostId: 1, members: [1, 2, 3] }));
          }
        }
      }
      if (message.type === 'message' && message.data?.kind === 'state') {
        fixture.lastState = message.data;
        if (message.data.view.log.some((entry) => entry.k === 'timeout')) fixture.firstTimeoutAt ??= Date.now();
      }
    });
  }, { table });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  await page.goto(new URL('tools/preview.html', baseUrl).href);
  const views = [1, 2, 3].map((id) => frame(page, id));
  for (const view of views) await connected(view);
  return { context, page, views };
}

async function setSeconds(host, guests, seconds) {
  await input(host).fill(String(seconds));
  await input(host).blur();
  await eventually(`host saves ${seconds} seconds`, async () => (await savedTable(host)).settings.turnTimer === seconds);
  for (const guest of guests) {
    await eventually(`guest receives ${seconds} seconds`, async () => (await input(guest).inputValue()) === String(seconds));
    assert.equal((await snapshot(guest)).view.settings.turnTimer, seconds);
  }
}

async function checkSettings() {
  const table = applyRoster(createTable(), [1, 2, 3]);
  const { context, page, views: [host, guest, other] } = await openFixture(table, 'custom settings');
  const accepted = [];
  assert.equal(await input(host).inputValue(), '30');
  assert.equal(await input(host).isEditable(), true);
  for (const view of [guest, other]) {
    assert.equal(await input(view).inputValue(), '30');
    assert.equal(await input(view).isDisabled(), true, 'only the host edits the timer');
  }

  for (const seconds of [3, 7]) {
    await setSeconds(host, [guest, other], seconds);
    await page.getByRole('button', { name: 'Refresh Alex', exact: true }).click();
    await connected(host);
    assert.equal(await input(host).inputValue(), String(seconds), 'host reload preserves custom seconds');
    await page.getByRole('button', { name: 'Refresh Sam', exact: true }).click();
    await connected(guest);
    assert.equal(await input(guest).inputValue(), String(seconds), 'guest reload receives custom seconds');
    accepted.push(seconds);
  }
  for (const seconds of [0, 1, 90, 121, 600]) {
    await setSeconds(host, [guest, other], seconds);
    accepted.push(seconds);
  }
  await setSeconds(host, [guest, other], 7);

  const invalid = ['', '-1', '1.5', '601'];
  for (const value of invalid) {
    const before = await savedTable(host);
    await input(host).fill(value);
    await input(host).blur();
    assert.equal(await input(host).evaluate((el) => el.checkValidity()), false, `${JSON.stringify(value)} is invalid`);
    assert.equal((await savedTable(host)).revision, before.revision, 'invalid input cannot commit settings');
    await host.locator('#deal').click();
    const after = await savedTable(host);
    assert.equal(after.phase, 'lobby', 'invalid timer prevents a deal');
    assert.equal(after.settings.turnTimer, 7, 'last valid value stays intact');
    assert.equal(after.revision, before.revision);
    assert.equal(await input(guest).inputValue(), '7');
    await setSeconds(host, [guest, other], 7);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await input(host).scrollIntoViewIfNeeded();
  const mobile = await input(host).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      width: rect.width, height: rect.height, left: rect.left, right: rect.right,
      viewport: innerWidth, hit: hit === el, overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  assert.ok(mobile.width >= 60 && mobile.height >= 28 && mobile.left >= 0 && mobile.right <= mobile.viewport);
  assert.ok(mobile.hit && !mobile.overflow, 'mobile timer input remains reachable without horizontal scrolling');
  await input(host).fill('3');
  await input(host).press('Enter');
  await eventually('Enter saves custom seconds', async () => (await savedTable(host)).settings.turnTimer === 3);
  await page.screenshot({ path: join(artifacts, 'custom-timer-mobile.png') });
  await input(host).fill('7');
  await host.locator('#deal').click();
  await host.locator('#hand .card').first().waitFor();
  assert.equal((await savedTable(host)).settings.turnTimer, 7, 'Deal applies a valid draft');
  evidence.push({ name: 'settings', initial: 30, accepted, rejected: invalid, mobile });
  console.log('PASS custom seconds: default 30, host-only editing, 3/7 survive reload, 0/1/90/121/600 synchronize, invalid values cannot save or deal, mobile and Enter work.');
  await context.close();
  activePage = null;
}

function timedTable(seconds) {
  return playing({
    seats: [1, 2], hands: [['r1', 'r2'], ['r3', 'g4']], discard: ['r0'], draw: ['g9'],
    current: 1, sittingOut: [3],
    settings: { turnTimer: seconds, jumpIn: false, mustCall: false, forcePlay: false },
  });
}

async function checkLiveClock(seconds) {
  const { context, page, views: [host, guest] } = await openFixture(timedTable(seconds), `${seconds}s clock`);
  assert.equal(await host.locator('#hand .card.playable').count(), 2, 'playable cards prevent automatic drawing before expiry');
  const initial = await savedTable(host);
  const initialWire = await snapshot(guest);
  if (seconds === 3) {
    const startedAt = await host.locator('body').evaluate(() => window.__timerFixture.initializedAt);
    await eventually('three-second turn expires', async () => (await savedTable(host)).log.some((entry) => entry.k === 'timeout'), 5500);
    await eventually('guest receives timed-out turn', async () => (await snapshot(guest)).view.log.some((entry) => entry.k === 'timeout'));
    const expiredAt = await guest.locator('body').evaluate(() => window.__timerFixture.firstTimeoutAt);
    const final = await savedTable(host);
    assert.ok(expiredAt - startedAt >= 3000 && expiredAt - startedAt < 5000, 'real turn expires at three seconds');
    assert.equal(final.current, 2);
    assert.equal(final.turnNo, initial.turnNo + 1);
    evidence.push({ name: '3s expiry', elapsedMs: expiredAt - startedAt, nextPlayer: final.current });
  } else if (seconds === 0) {
    assert.equal(initialWire.remainingMs, null);
    assert.equal(await host.locator('#timer').getAttribute('hidden'), '');
    assert.equal(await guest.locator('#timer').getAttribute('hidden'), '');
    await delay(3200);
    const final = await savedTable(host);
    assert.equal(final.revision, initial.revision, 'off produces no timeout or automatic action');
    evidence.push({ name: 'off', observedMs: 3200, current: final.current });
  } else {
    assert.ok(initialWire.remainingMs > 590000 && initialWire.remainingMs <= 600000, 'wire preserves a ten-minute turn');
    const shown = Number(await guest.locator('#timer-label').textContent());
    assert.ok(shown > 590 && shown <= 600, 'guest display is not clamped to the old two-minute limit');
    evidence.push({ name: '600s clock', remainingMs: initialWire.remainingMs, guestLabel: shown });
  }
  console.log(`PASS ${seconds}s live clock${seconds === 3 ? ': real timeout advances the turn' : seconds === 0 ? ': disabled for more than three seconds' : ': full deadline reaches the guest'}.`);
  await context.close();
  activePage = null;
}

try {
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  await mkdir(artifacts, { recursive: true });
  await checkSettings();
  for (const seconds of [3, 0, 600]) await checkLiveClock(seconds);
  assert.deepEqual(errors, [], 'no browser errors');
  await writeFile(join(artifacts, 'custom-timer-results.json'), JSON.stringify(evidence, null, 2));
  console.log('All custom timer browser checks passed. Evidence is in artifacts/custom-timer-results.json.');
} catch (error) {
  if (activePage) await activePage.screenshot({ path: join(artifacts, 'custom-timer-failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(artifacts, 'custom-timer-results.json'), JSON.stringify({ evidence, errors, failure: error.message }, null, 2)).catch(() => {});
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
