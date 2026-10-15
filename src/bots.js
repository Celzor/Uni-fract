import { colorOf, drawAmount, isWild, rankOf } from './cards.js';
import { bestColor, canChallenge, playCheck, smallestHand, viewFor } from './rules.js';

export const BOT_NAMES = Object.freeze(['Prism', 'Lumen', 'Halo', 'Glint', 'Spectra']);

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
  // Without a stackable answer, a Wild Draw Four is worth a gamble now and then.
  if (canChallenge(view, botId) && !options.length && random() < 0.35) return { type: 'challenge', seq: view.turnSeq };
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
