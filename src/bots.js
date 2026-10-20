import { colorOf, drawAmount, isWild, rankOf } from './cards.js';
import { bestColor, isBotId, playCheck, smallestHand, viewFor } from './rules.js';

/** Bots decide from their own view, so they never see another player's hand. */
function botView(table, botId) {
  return viewFor(table, botId);
}

export function playAction(view, botId, card, random = Math.random) {
  const rest = view.hand.filter((other) => other !== card);
  const action = { type: 'play', card, seq: view.turnSeq };
  if (isWild(card)) action.color = bestColor(rest, random);
  if (view.settings.sevenZero && rankOf(card) === '7' && rest.length) action.target = smallestHand(view, botId, view.counts);
  return action;
}

function score(view, botId, card, random) {
  const nextSeat = (view.seats.indexOf(botId) + view.direction + view.seats.length) % view.seats.length;
  const threatened = view.counts[nextSeat] <= 2;
  const rank = rankOf(card);
  let value = random() * 2;
  if (view.pendingDraw > 0) return value + (rank === 'd2' ? 10 : 5);
  if (isWild(card)) value -= rank === 'wd4' ? 30 : 20;
  else if (colorOf(card) === view.color) value += 8;
  if (/^\d$/.test(rank)) value += Number(rank) / 2;
  if (rank === 's' || rank === 'r' || drawAmount(card)) value += threatened ? 15 : 3;
  // Save the 7 for when someone is close to winning.
  if (view.settings.sevenZero && rank === '7') value += threatened ? 6 : -4;
  return value;
}

/** The bot's move on its own turn, or null when it is not the bot's turn. */
export function chooseTurnAction(table, botId, random = Math.random) {
  const view = botView(table, botId);
  if (view.phase !== 'playing' || view.current !== botId || !view.hand) return null;
  if (view.stage === 'drawn') {
    if (playCheck(view, botId, view.hand, view.drawnCard)) return playAction(view, botId, view.drawnCard, random);
    return { type: 'keep', seq: view.turnSeq };
  }
  const options = view.hand.filter((card) => playCheck(view, botId, view.hand, card)?.jumpIn === false);
  if (!options.length) return { type: 'draw', seq: view.turnSeq };
  let best = options[0];
  let bestScore = -Infinity;
  for (const card of options) {
    const value = score(view, botId, card, random);
    if (value > bestScore) {
      best = card;
      bestScore = value;
    }
  }
  return playAction(view, botId, best, random);
}

/** A card this bot could jump in with right now, if any. */
export function jumpInCard(table, botId) {
  const view = botView(table, botId);
  if (view.phase !== 'playing' || view.current === botId || !view.hand) return null;
  return view.hand.find((card) => playCheck(view, botId, view.hand, card)?.jumpIn) ?? null;
}

export function handSize(table, botId) {
  return botView(table, botId).hand?.length ?? 0;
}

/**
 * Plays the computer players for whichever copy coordinates the table: the
 * host's browser in a call, or the practice table offline. It only schedules
 * moves; each one goes through the normal rules via act(id, action).
 * Call schedule() after every change to the table.
 */
export function createBotDriver({ getTable, act, random = Math.random, timers = globalThis, pace = 1 }) {
  const scheduled = new Set();

  function later(ms, task) {
    const handle = timers.setTimeout(() => {
      scheduled.delete(handle);
      task();
    }, ms * pace);
    scheduled.add(handle);
  }

  function stop() {
    for (const handle of scheduled) timers.clearTimeout(handle);
    scheduled.clear();
  }

  function takeTurn(id) {
    const table = getTable();
    if (table?.phase !== 'playing' || table.current !== id) return;
    const action = chooseTurnAction(table, id, random);
    if (!action) return;
    // Bots usually remember to shout before playing their second-to-last card.
    if (action.type === 'play' && handSize(table, id) === 2 && random() < 0.85) act(id, { type: 'call' });
    act(id, { ...action, seq: getTable()?.turnSeq });
  }

  function schedule() {
    stop();
    const table = getTable();
    if (table?.phase !== 'playing') return;
    const bots = table.seats.filter(isBotId);
    if (!bots.length) return;
    const { exposed } = table;
    if (exposed !== null) {
      if (isBotId(exposed) && random() < 0.6) later(400 + random() * 1200, () => act(exposed, { type: 'call' }));
      const catchers = bots.filter((id) => id !== exposed);
      if (catchers.length) {
        const catcher = catchers[Math.floor(random() * catchers.length)];
        later(1500 + random() * 1700, () => act(catcher, { type: 'catch' }));
      }
    }
    for (const id of bots) {
      if (id === table.current || jumpInCard(table, id) === null || random() >= 0.45) continue;
      later(450 + random() * 700, () => {
        const latest = getTable();
        const card = latest ? jumpInCard(latest, id) : null;
        if (card !== null) act(id, playAction(viewFor(latest, id), id, card, random));
      });
    }
    if (bots.includes(table.current)) {
      // Leave a beat to catch a missed shout before the next bot moves on.
      const delay = (table.stage === 'drawn' ? 600 : 900) + random() * 700 + (exposed !== null ? 1500 : 0);
      const id = table.current;
      later(delay, () => takeTurn(id));
    }
  }

  return { schedule, stop };
}
