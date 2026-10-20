// Optional focused browser regression, using the real multiplayer preview.
// PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM_EXECUTABLE and TEST_URL match browser-check.mjs.
import assert from 'node:assert/strict';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { playing } from '../tests/helpers.js';
import { applyRoster, createTable, isValidTable, NEXT_ROUND_DELAY_MS } from '../src/rules.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, 'artifacts');
const baseUrl = new URL(process.env.TEST_URL || 'http://127.0.0.1:4173/');
if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

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

const viewFor = (page, id) => page.frameLocator(`iframe[data-participant-id="${id}"]`);
const savedTable = (view) => view.locator('body').evaluate(() => {
  const init = window.__countdownFixture.init;
  return JSON.parse(sessionStorage.getItem(`uni-refract/1:${JSON.stringify([init.sessionId, init.self.id])}`)).table;
});
const label = (view) => view.locator('#next-round').textContent();
let browser;
let activePage;
const errors = [];
const evidence = [];

async function openFixture(table, name) {
  assert.ok(isValidTable(table), `${name}: valid persisted fixture`);
  const context = await browser.newContext({ viewport: { width: 1900, height: 1200 }, reducedMotion: 'reduce' });
  const trace = [];
  await context.exposeBinding('__recordCountdown', (_source, entry) => trace.push(entry));
  // This listener runs before the app's bridge. Only a new host session is seeded;
  // subsequent frame refreshes restore the real state written by the application.
  await context.addInitScript(({ table }) => {
    if (window.parent === window) return;
    window.__countdownFixture = { init: null, stateCount: 0 };
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || event.data?.protocol !== 'refract-activity/1') return;
      const message = event.data;
      if (message.type === 'init') {
        window.__countdownFixture.init = message;
        if (message.self.id === 1) {
          const key = `uni-refract/1:${JSON.stringify([message.sessionId, 1])}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, JSON.stringify({ table, hostId: 1, members: [1, 2, 3] }));
          }
        }
      }
      if (message.type === 'message' && message.data?.kind === 'state') window.__countdownFixture.stateCount += 1;
    });
    let previous = '';
    const sample = () => {
      const button = document.getElementById('next-round');
      const id = window.__countdownFixture.init?.self.id;
      if (!id || !button || !button.getClientRects().length) return;
      const label = button.textContent.trim();
      const signature = `${label}/${button.disabled}`;
      if (signature === previous) return;
      previous = signature;
      window.__recordCountdown({ id, at: Date.now(), label, disabled: button.disabled });
    };
    // Frame creation can replace its initial document before DOMContentLoaded.
    // Poll the rendered control so the first load and a refreshed frame agree.
    setInterval(sample, 25);
  }, { table });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  await page.goto(new URL('tools/preview.html', baseUrl).href);
  const views = [1, 2, 3].map((id) => viewFor(page, id));
  for (const view of views) await view.locator('#connection[data-state="connected"]').waitFor();
  return { context, page, views, trace };
}

function winningTable(match) {
  return playing({
    seats: [1, 2], hands: [['r1'], ['y2', 'b3']], discard: ['r0'], current: 1,
    sittingOut: [3], scores: { 1: match ? 198 : 0, 2: 0 },
    settings: { turnTimer: 0, jumpIn: false, mustCall: false, targetScore: match ? 200 : 0 },
  });
}

async function winAndRedeal(match) {
  const name = match ? 'new match' : 'next round';
  const { context, page, views: [host, guest, spectator], trace } = await openFixture(winningTable(match), name);
  const result = { name, trace };
  evidence.push(result);
  const winStartedAt = await host.locator('body').evaluate(() => Date.now());
  await host.locator('#hand .card.playable').click();
  for (const view of [host, guest, spectator]) {
    await eventually(`${name}: 3 second label`, async () => (await label(view)).includes('in 3s'));
    assert.equal(await view.locator('#next-round').isDisabled(), true);
  }
  const won = await savedTable(host);
  Object.assign(result, { deadline: won.nextRoundAt, winStartedAt });
  assert.equal(won.phase, 'roundOver');
  assert.equal(won.winner, 1);
  assert.equal(won.matchWinner, match ? 1 : null);
  assert.ok(won.nextRoundAt >= winStartedAt + NEXT_ROUND_DELAY_MS, 'three seconds start at the actual win');
  assert.ok((await label(host)).includes(match ? 'New match in 3s' : 'Next round in 3s'));

  // Bypass the disabled guest button and send a genuine protocol action through
  // the preview router. A fresh state response proves the host processed it.
  const stateCount = await guest.locator('body').evaluate(() => window.__countdownFixture.stateCount);
  await guest.locator('body').evaluate(() => {
    const init = window.__countdownFixture.init;
    parent.postMessage({
      protocol: 'refract-activity/1', type: 'broadcast', to: [1],
      data: { protocol: 'uni-refract/1', sessionId: init.sessionId, hostId: 1, kind: 'action', action: { type: 'deal' } },
    }, location.origin);
  });
  await eventually('host replied to the early deal request', async () =>
    await guest.locator('body').evaluate(() => window.__countdownFixture.stateCount) > stateCount);
  assert.equal((await savedTable(host)).revision, won.revision, 'the host rejects an early guest deal');
  await host.locator('#next-round').dispatchEvent('click');
  assert.equal((await savedTable(host)).revision, won.revision, 'the host also rejects its own early button event');

  if (!match) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await guest.locator('[data-action="sync"]').last().dispatchEvent('click');
    }
    await eventually('countdown reaches two seconds', async () => (await label(host)).includes('in 2s'));
    await page.getByRole('button', { name: 'Refresh Alex', exact: true }).click();
    await host.locator('#connection[data-state="connected"]').waitFor();
    assert.equal((await savedTable(host)).nextRoundAt, won.nextRoundAt, 'host refresh preserves the deadline');
    await page.getByRole('button', { name: 'Refresh Sam', exact: true }).click();
    await guest.locator('#connection[data-state="connected"]').waitFor();
    assert.ok(!(await label(guest)).includes('in 3s'), 'guest refresh does not restart the countdown');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await guest.locator('[data-action="sync"]').last().dispatchEvent('click');
    }
  }

  await eventually(`${name}: ready after countdown`, async () => !(await host.locator('#next-round').isDisabled()));
  await eventually(`${name}: guest also ready`, async () => !(await guest.locator('#next-round').isDisabled()));
  await eventually(`${name}: enabled timestamps recorded`, async () =>
    [1, 2].every((id) => trace.some((entry) => entry.id === id && !entry.disabled)));
  assert.equal(await spectator.locator('#next-round').isDisabled(), true, 'spectators stay disabled after zero');
  assert.ok((await label(host)).includes(match ? 'Start a new match' : 'Deal next round'));
  for (const id of [1, 2, 3]) {
    for (const seconds of [3, 2, 1]) {
      assert.ok(trace.some((entry) => entry.id === id && entry.disabled && entry.label.includes(`in ${seconds}s`)),
        `${name}: participant ${id} sees disabled ${seconds}s`);
    }
  }
  for (const id of [1, 2]) {
    const enabled = trace.find((entry) => entry.id === id && !entry.disabled);
    assert.ok(enabled && enabled.at >= won.nextRoundAt, `${name}: participant ${id} cannot deal before the deadline`);
  }
  await page.screenshot({ path: join(artifacts, `countdown-${match ? 'match' : 'round'}-ready.png`) });
  await guest.locator('#next-round').click();
  for (const view of [host, guest]) await view.locator('#results').waitFor({ state: 'hidden' });
  const next = await savedTable(host);
  assert.equal(next.phase, 'playing', 'a normal seated-player click deals after the delay');
  assert.equal(next.round, match ? 1 : 2);
  console.log(`PASS ${name}: synchronized 3/2/1, early actions rejected, seated guest deals after delay, spectator remains disabled${match ? '' : ', resync and host/guest refresh preserve deadline'}.`);
  await context.close();
  activePage = null;
}

try {
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  await mkdir(artifacts, { recursive: true });
  const lobby = applyRoster(createTable({ settings: { turnTimer: 0, bots: 0 } }), [1, 2, 3]);
  const initial = await openFixture(lobby, 'initial lobby');
  assert.equal(await initial.views[0].locator('#deal').isDisabled(), false);
  assert.ok(!(await initial.views[0].locator('#deal').textContent()).includes('in '));
  await initial.views[0].locator('#deal').click();
  await initial.views[0].locator('#hand .card').first().waitFor();
  assert.equal((await savedTable(initial.views[0])).round, 1);
  console.log('PASS initial lobby: the host can deal immediately.');
  await initial.context.close();
  activePage = null;
  await winAndRedeal(false);
  await winAndRedeal(true);
  assert.deepEqual(errors, [], 'no browser errors');
  await writeFile(join(artifacts, 'countdown-results.json'), JSON.stringify(evidence, null, 2));
  console.log('All countdown browser checks passed. Evidence is in artifacts/countdown-results.json.');
} catch (error) {
  if (activePage) await activePage.screenshot({ path: join(artifacts, 'countdown-failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(artifacts, 'countdown-results.json'), JSON.stringify({ evidence, errors, failure: error.message }, null, 2)).catch(() => {});
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
