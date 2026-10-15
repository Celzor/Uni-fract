// Optional browser verification; the app itself has no Playwright dependency.
// Set PLAYWRIGHT_MODULE to an existing Playwright (or playwright-core) package or module file.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an already installed Chromium-based browser.
import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, 'artifacts');
const baseUrl = new URL(process.env.TEST_URL || 'http://127.0.0.1:4173/');
if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

async function loadPlaywright() {
  const configured = process.env.PLAYWRIGHT_MODULE;
  if (!configured) {
    try {
      return await import('playwright');
    } catch {
      throw new Error('Browser checks need an existing Playwright install. Set PLAYWRIGHT_MODULE to its package directory or index.mjs.');
    }
  }
  let path = resolve(configured);
  if ((await stat(path)).isDirectory()) path = join(path, 'index.mjs');
  return import(pathToFileURL(path).href);
}

async function eventually(description, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(60);
  }
  throw new Error(`Timed out: ${description}`);
}

const frame = (page, id) => page.frameLocator(`iframe[data-participant-id="${id}"]`);
const handNames = (view) => view.locator('#hand .card').evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label').replace(/, .*$/, '')).sort());

async function connected(view) {
  await eventually('Connected to Refract', async () => (await view.locator('#connection-label').textContent()) === 'Connected to Refract');
}

async function pickIfAsked(view) {
  await delay(100);
  if (await view.locator('#color-dialog[open]').count()) await view.locator('#color-dialog .color-option[data-color="b"]').click();
  if (await view.locator('#target-dialog[open]').count()) await view.locator('#target-list button').first().click();
}

/** Whoever can act does: jump in if possible, otherwise the player on turn plays or draws. */
async function takeAnyTurn(views) {
  for (const view of views) {
    if (await view.locator('#hand .card.jump').count()) {
      await view.locator('#hand .card.jump').first().click();
      await pickIfAsked(view);
      return 'jump';
    }
  }
  for (const view of views) {
    if (!(await view.locator('#felt.my-turn').count())) continue;
    if (await view.locator('#call-button:not([hidden])').count()) await view.locator('#call-button').click();
    if (await view.locator('#hand .card.playable').count()) {
      await view.locator('#hand .card.playable').first().click();
      await pickIfAsked(view);
      return 'play';
    }
    for (const button of ['#draw-button', '#keep-button']) {
      if (await view.locator(`${button}:not([hidden])`).count()) {
        await view.locator(button).click();
        return 'draw';
      }
    }
  }
  return 'wait';
}

async function noHorizontalOverflow(page) {
  const sizes = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(sizes.document <= sizes.viewport + 1, `Horizontal overflow: ${JSON.stringify(sizes)}`);
}

let browser;
let page;
let checks = 0;
const errors = [];
async function check(name, run) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

try {
  const { chromium } = await loadPlaywright();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir(artifacts, { recursive: true });

  await check('practice lobby, deal, and a played turn against bots', async () => {
    await page.goto(baseUrl.href);
    await page.selectOption('select[name="turnTimer"]', '0');
    assert.equal(await page.locator('#seat-list .seat-row:not(.empty)').count(), 4);
    await page.locator('#deal').click();
    await eventually('my hand of seven', async () => (await page.locator('#hand .card').count()) === 7);
    await eventually('a turn taken', async () => (await takeAnyTurn([page])) !== 'wait');
    await eventually('bots respond', async () => (await page.locator('#log li').count()) >= 4, 15000);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(artifacts, 'practice.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(artifacts, 'practice-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await page.setViewportSize({ width: 1900, height: 1100 });
  await page.goto(new URL('tools/preview.html', baseUrl).href);
  const [alex, sam, taylor] = [1, 2, 3].map((id) => frame(page, id));
  for (const view of [alex, sam, taylor]) await connected(view);

  await check('host rules reach guests, who cannot edit them', async () => {
    await alex.locator('select[name="turnTimer"]').selectOption('0');
    await alex.locator('select[name="stacking"]').selectOption('progressive');
    await eventually('guest sees the rule', async () => (await sam.locator('select[name="stacking"]').inputValue()) === 'progressive');
    assert.equal(await sam.locator('select[name="stacking"]').isDisabled(), true);
    assert.equal(await taylor.locator('#deal').isDisabled(), true);
  });

  await check('the host adds a computer player that everyone sees', async () => {
    await alex.locator('select[name="bots"]').selectOption('1');
    await eventually('guest sees the bot seat', async () => (await sam.locator('#seat-list').textContent()).includes('Al LunarBot'));
    assert.equal(await sam.locator('select[name="bots"]').isDisabled(), true);
    assert.equal(await sam.locator('#seat-list button').count(), 0, 'only the host can add bots');
    await alex.locator('#seat-list button', { hasText: 'Add a computer player' }).click();
    await eventually('guest sees the second bot', async () => (await sam.locator('#seat-list').textContent()).includes('Al GoreBot'));
    assert.equal(await alex.locator('select[name="bots"]').inputValue(), '2');
    await alex.locator('select[name="bots"]').selectOption('1');
    await eventually('back to one bot', async () => !(await sam.locator('#seat-list').textContent()).includes('Al GoreBot'));
  });

  await check('each player is dealt a private hand', async () => {
    await alex.locator('#deal').click();
    for (const view of [alex, sam, taylor]) await eventually('seven cards', async () => (await view.locator('#hand .card').count()) === 7);
    const hands = await Promise.all([alex, sam, taylor].map(handNames));
    assert.equal(new Set(hands.map((hand) => JSON.stringify(hand))).size, 3);
  });

  await check('turns pass around the table, bot included', async () => {
    const actions = [];
    for (let i = 0; i < 20; i += 1) {
      actions.push(await takeAnyTurn([alex, sam, taylor]));
      await delay(300);
    }
    assert.ok(actions.filter((action) => action !== 'wait').length >= 8, actions.join(','));
    await eventually('the bot has moved', async () => (await sam.locator('#log li').allTextContents()).some((line) => line.startsWith('Al Lunar ')), 15000);
  });

  const jordan = frame(page, 4);
  await check('a late joiner watches without a hand', async () => {
    await page.locator('#add-participant').click();
    await connected(jordan);
    await eventually('spectating', async () => (await jordan.locator('#my-label').textContent()) === 'Spectating');
  });

  await check('the host leaves; everyone keeps their exact cards and a watcher takes the seat', async () => {
    const before = await Promise.all([sam, taylor].map(handNames));
    await alex.locator('#refract-table-tools [data-action="leave"]').click();
    await page.locator('iframe[data-participant-id="1"]').waitFor({ state: 'detached' });
    for (const view of [sam, taylor, jordan]) await connected(view);
    assert.deepEqual(await Promise.all([sam, taylor].map(handNames)), before);
    await eventually('Jordan seated', async () => (await jordan.locator('#my-label').textContent()) === 'Your hand');
    for (let i = 0; i < 6; i += 1) {
      await takeAnyTurn([sam, taylor, jordan]);
      await delay(300);
    }
    await page.screenshot({ path: join(artifacts, 'shared-preview.png') });
  });

  await check('the new host keeps playing the bot', async () => {
    const botsTurn = async () => /^Al Lunar(’s turn| is facing| drew)/.test(await sam.locator('#status').textContent());
    await eventually('the bot’s turn comes round', async () => (await botsTurn()) || (await takeAnyTurn([sam, taylor, jordan]), false), 30000);
    await eventually('the bot moves on', async () => !(await botsTurn()), 10000);
  });

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log(`${checks} browser checks passed. Screenshots are in artifacts/.`);
} catch (error) {
  if (page) {
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, 'browser-failure.png'), fullPage: true }).catch(() => {});
  }
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
