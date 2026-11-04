// Optional end-to-end checks; no Playwright dependency is added to the app.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM_EXECUTABLE work like browser-check.mjs.
// Without TEST_URL this starts and closes its own local preview server.
import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { cardImage, cardSide, colorOf, colorsFor, deckFor, faceOf, flipCard, isWild, points } from '../src/cards.js';
import { createTable, isValidTable } from '../src/rules.js';
import { createServer } from './serve.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, 'artifacts');
const sessionId = 'reverse-browser-check';
const storageKey = `uni-refract/1:${JSON.stringify([sessionId, 1])}`;
const people = [1, 2, 3].map(id => ({ id, name: `Player ${id}`, avatarUrl: null }));
let server, browser, currentPage, baseUrl;
let checks = 0;
const errors = [];

async function loadPlaywright() {
  const configured = process.env.PLAYWRIGHT_MODULE;
  if (!configured) {
    try { return await import('playwright'); }
    catch { throw new Error('Set PLAYWRIGHT_MODULE to an existing Playwright package directory or index.mjs.'); }
  }
  let path = resolve(configured);
  if ((await stat(path)).isDirectory()) path = join(path, 'index.mjs');
  return import(pathToFileURL(path).href);
}

async function eventually(description, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error(`Timed out: ${description}`);
}

async function check(name, run) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

// Preserve all 112 physical cards while arranging useful hands and draw order.
function fixture({ side = 'light', hands, discard = [side === 'dark' ? 'p3' : 'r3'], draw = [] }) {
  const deck = deckFor('reverse', side);
  const used = new Set();
  const take = face => {
    const id = deck.find(card => !used.has(card) && (typeof face === 'number' ? card === face : faceOf(card) === face));
    assert.notEqual(id, undefined, `spare ${face}`);
    used.add(id);
    return id;
  };
  const handIds = hands.map(hand => hand.map(take));
  const discardIds = discard.map(take);
  const drawIds = draw.map(take);
  const table = createTable({ settings: { gameMode: 'reverse', turnTimer: 0, mustCall: false } });
  Object.assign(table, {
    phase: 'playing', round: 1, side, seats: [1, 2, 3], hands: handIds,
    discard: discardIds, drawPile: [...deck.filter(card => !used.has(card)), ...drawIds.reverse()],
    color: colorOf(discardIds.at(-1)) ?? colorsFor(side)[0], current: 1, turnSeq: 1, turnNo: 1,
  });
  assert.ok(isValidTable(table), 'valid fixture');
  return table;
}

async function scenario(table = null, allPlayers = false) {
  const page = currentPage = await browser.newPage({ viewport: { width: allPlayers ? 1500 : 1280, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  if (table) await page.addInitScript(({ table, people, storageKey }) => {
    sessionStorage.setItem(storageKey, JSON.stringify({ table, hostId: 1, members: people.map(person => person.id) }));
  }, { table, people, storageKey });
  const ids = allPlayers ? [1, 2, 3] : [1];
  const frameUrl = new URL('index.html?embedded=1', baseUrl).href;
  const wrapperUrl = new URL('reverse-browser-check.html', baseUrl).href;
  await page.route(wrapperUrl, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <style>html,body{margin:0;height:100%;background:#2c211b}body{display:flex}iframe{border:0;min-width:0;flex:1;height:100vh}</style>
    ${ids.map(id => `<iframe data-player="${id}" src="${frameUrl}"></iframe>`).join('')}
    <script>
      const protocol='refract-activity/1', people=${JSON.stringify(people)}, sessionId=${JSON.stringify(sessionId)};
      const frames=[...document.querySelectorAll('iframe')];
      const send=(frame,message)=>frame.contentWindow.postMessage({protocol,...message},location.origin);
      const init=frame=>send(frame,{type:'init',sessionId,channelId:1,self:people.find(person=>person.id===Number(frame.dataset.player)),participants:people,theme:'dark'});
      for(const frame of frames)frame.addEventListener('load',()=>init(frame));
      addEventListener('message',event=>{
        const sender=frames.find(frame=>frame.contentWindow===event.source), message=event.data;
        if(!sender||event.origin!==location.origin||message?.protocol!==protocol)return;
        if(message.type==='ready')init(sender);
        if(message.type==='broadcast')for(const frame of frames){
          if(frame!==sender&&(!message.to||message.to.includes(Number(frame.dataset.player))))send(frame,{type:'message',from:Number(sender.dataset.player),data:message.data});
        }
      });
    </script>` }));
  await page.goto(wrapperUrl);
  const views = ids.map(id => page.frameLocator(`iframe[data-player="${id}"]`));
  for (const view of views) await view.locator('#connection[data-state="connected"]').waitFor();
  if (table) await views[0].locator('#hand .card').first().waitFor();
  return { page, view: views[0], views };
}

const state = view => view.locator('body').evaluate((_, key) => {
  const saved = sessionStorage.getItem(key);
  if (!saved) throw new Error(`Missing host snapshot ${key}; storage keys: ${Object.keys(sessionStorage).join(', ')}`);
  return JSON.parse(saved).table;
}, storageKey);
const palette = view => view.locator('#color-dialog .color-option').evaluateAll(buttons => buttons.map(button => button.value));
const handIds = view => view.locator('#hand .card').evaluateAll(cards => cards.map(card => Number(card.dataset.card)).sort((a, b) => a - b));

async function play(view, face, color) {
  const before = await state(view);
  await view.locator(`#hand .card:has(img[src$="/${face}.svg"])`).first().click();
  if (color) {
    await view.locator('#color-dialog[open]').waitFor();
    await view.locator(`#color-dialog .color-option[value="${color}"]`).click();
  }
  await eventually(`${face} committed`, async () => (await state(view)).revision > before.revision);
  return state(view);
}

try {
  await mkdir(artifacts, { recursive: true });
  if (process.env.TEST_URL) baseUrl = new URL(process.env.TEST_URL);
  else {
    server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = new URL(`http://127.0.0.1:${server.address().port}/`);
  }
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });

  await check('host selects No-No Reverse; guest rules synchronize and classic controls are disabled', async () => {
    const { page, view, views } = await scenario(null, true);
    await view.locator('select[name="gameMode"]').selectOption('reverse');
    for (const player of views) {
      await eventually('Reverse selected', async () => (await player.locator('select[name="gameMode"]').inputValue()) === 'reverse');
      assert.equal(await player.locator('#reverse-rules').isVisible(), true);
      for (const name of ['stacking', 'jumpIn', 'sevenZero', 'wildFour']) assert.equal(await player.locator(`[name="${name}"]`).isDisabled(), true);
    }
    assert.equal(await views[1].locator('select[name="gameMode"]').isDisabled(), true);
    await view.locator('input[name="turnTimer"]').fill('0');
    await view.locator('input[name="turnTimer"]').blur();
    await view.locator('#deal').click();
    for (const player of views) {
      await player.locator('#hand .card').first().waitFor();
      assert.equal(await player.locator('#hand .card').count(), 7);
      assert.equal(await player.locator('#game-side').textContent(), 'Light side');
    }
    const dealt = await state(view);
    assert.equal(dealt.hands.flat().length + dealt.drawPile.length + dealt.discard.length, 112);
    await page.close();
  });

  for (const side of ['light', 'dark']) await check(`Flip from ${side} changes every hand, both piles, and the wild-colour palette`, async () => {
    const face = side === 'light' ? 'rf' : 'pf';
    const nextSide = side === 'light' ? 'dark' : 'light';
    const bottom = deckFor('reverse', side).find(card => isWild(flipCard(card)) && faceOf(card) !== face);
    const table = fixture({ side, hands: [[face, side === 'light' ? 'b2' : 't2'], [side === 'light' ? 'g5' : 'o5'], [side === 'light' ? 'y7' : 'v7']], discard: [bottom, side === 'light' ? 'r3' : 'p3'] });
    const { page, view } = await scenario(table);
    await view.locator(`#hand .card:has(img[src$="/${face}.svg"])`).click();
    await view.locator('#color-dialog[open]').waitFor();
    assert.deepEqual(await palette(view), colorsFor(nextSide));
    await view.locator(`#color-dialog .color-option[value="${colorsFor(nextSide)[0]}"]`).click();
    await eventually('new side committed', async () => (await state(view)).side === nextSide);
    const next = await state(view);
    const played = table.hands[0][0];
    assert.deepEqual(next.hands, [[flipCard(table.hands[0][1])], ...table.hands.slice(1).map(hand => hand.map(flipCard))]);
    assert.deepEqual(next.discard, [...table.discard, played].reverse().map(flipCard));
    assert.deepEqual(next.drawPile, [...table.drawPile].reverse().map(flipCard));
    assert.deepEqual(await handIds(view), [...next.hands[0]].sort((a, b) => a - b));
    assert.equal(await view.locator('#discard .pile-card:last-child img').getAttribute('src'), cardImage(next.discard.at(-1)));
    assert.equal(next.color, colorsFor(nextSide)[0]);
    assert.ok(isValidTable(next));
    await page.close();
  });

  await check('dark wild chooses a dark colour; Wild Draw Colour includes wilds and stops on the exact colour', async () => {
    const wild = await scenario(fixture({ side: 'dark', hands: [['dw', 't2'], ['o1'], ['v1']] }));
    await wild.view.locator('#hand .card:has(img[src$="/dw.svg"])').click();
    await wild.view.locator('#color-dialog[open]').waitFor();
    assert.deepEqual(await palette(wild.view), colorsFor('dark'));
    await wild.view.locator('#color-dialog .color-option[value="v"]').click();
    await eventually('purple chosen', async () => (await state(wild.view)).color === 'v');
    await wild.page.close();
    const { page, view } = await scenario(fixture({ side: 'dark', hands: [['dwc', 't2'], ['o1'], ['v1']], draw: ['dw', 't5', 'p2'] }));
    const next = await play(view, 'dwc', 'p');
    assert.deepEqual(next.hands[1].map(faceOf), ['o1', 'dw', 't5', 'p2']);
    assert.equal(next.current, 3);
    assert.equal(next.color, 'p');
    assert.equal(next.log.at(-1).n, 3);
    assert.equal(await view.locator('#active-color-label').textContent(), 'Pink');
    await page.close();
  });

  for (const [side, face, amount] of [['light', 'rd1', 1], ['dark', 'pd5', 5]]) await check(`${face} draws ${amount} and skips the next player`, async () => {
    const { page, view } = await scenario(fixture({ side, hands: [[face, side === 'light' ? 'b2' : 't2'], [side === 'light' ? 'g5' : 'o5'], [side === 'light' ? 'y7' : 'v7']] }));
    const next = await play(view, face);
    assert.equal(next.hands[1].length, 1 + amount);
    assert.equal(next.current, 3);
    assert.equal(next.pendingDraw, 0);
    await page.close();
  });

  await check('Skip Everyone leaves the player on turn', async () => {
    const { page, view } = await scenario(fixture({ side: 'dark', hands: [['psa', 'p2'], ['o1'], ['v1']] }));
    const next = await play(view, 'psa');
    assert.equal(next.current, 1);
    assert.equal(next.turnNo, 2);
    assert.equal(await view.locator('#felt').evaluate(element => element.classList.contains('my-turn')), true);
    await page.close();
  });

  await check('a final Flip scores the new side; the next round starts on Light', async () => {
    const table = fixture({ hands: [['rf'], ['g5'], ['y7']], discard: ['y1', 'r3'] });
    const { page, view } = await scenario(table);
    const next = await play(view, 'rf');
    assert.equal(next.phase, 'roundOver');
    assert.equal(next.side, 'dark');
    assert.equal(next.roundPoints, table.hands.slice(1).flat().reduce((sum, card) => sum + points(flipCard(card)), 0));
    await view.locator('#results').waitFor();
    assert.match(await view.locator('#results-detail').textContent(), /Scored on the dark side/);
    await view.locator('#next-round').click();
    await eventually('next round dealt', async () => (await state(view)).phase === 'playing');
    const dealt = await state(view);
    assert.equal(dealt.side, 'light');
    assert.ok(dealt.hands.flat().every(card => cardSide(card) === 'light'));
    assert.equal(await view.locator('#game-side').textContent(), 'Light side');
    await page.close();
  });

  await check('all 117 Classic and Reverse card faces load in the browser', async () => {
    const images = [...new Set([...deckFor(), ...deckFor('reverse'), ...deckFor('reverse', 'dark')].map(cardImage))];
    assert.equal(images.length, 117);
    const page = currentPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<style>body{margin:12px;background:#2c211b;display:grid;grid-template-columns:repeat(13,1fr);gap:8px}img{width:100%;display:block}</style>${images.map(path => `<img src="${new URL(path, baseUrl).href}" alt="">`).join('')}`);
    await page.locator('img').evaluateAll(nodes => Promise.all(nodes.map(image => image.decode())));
    await page.screenshot({ path: join(artifacts, 'reverse-card-faces.png'), fullPage: true });
    await page.close();
  });

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
  console.log(`${checks} Reverse browser checks passed.`);
} catch (error) {
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: join(artifacts, 'reverse-failure.png'), fullPage: true }).catch(() => {});
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
