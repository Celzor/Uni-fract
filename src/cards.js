/**
 * The 108-card deck. A card is an integer id that indexes FACES, so the two
 * copies of "Red 7" stay distinguishable on the wire. Faces match the artwork
 * file names in assets/cards.
 */
export const COLORS = Object.freeze(['r', 'y', 'g', 'b']);
export const COLOR_NAMES = Object.freeze({ r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' });
const RANK_NAMES = Object.freeze({ s: 'Skip', r: 'Reverse', d2: 'Draw Two', w: 'Wild', wd4: 'Wild Draw Four' });
const RANK_ORDER = Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 's', 'r', 'd2', 'w', 'wd4']);

export const FACES = Object.freeze((() => {
  const faces = [];
  for (const color of COLORS) {
    faces.push(`${color}0`);
    for (let number = 1; number <= 9; number += 1) faces.push(`${color}${number}`, `${color}${number}`);
    for (const action of ['s', 'r', 'd2']) faces.push(color + action, color + action);
  }
  for (let copy = 0; copy < 4; copy += 1) faces.push('w');
  for (let copy = 0; copy < 4; copy += 1) faces.push('wd4');
  return faces;
})());

export const DECK_SIZE = FACES.length;

export const isCard = (card) => Number.isInteger(card) && card >= 0 && card < DECK_SIZE;
export const faceOf = (card) => FACES[card];
export const isWild = (card) => FACES[card][0] === 'w';
export const colorOf = (card) => (isWild(card) ? null : FACES[card][0]);
export const rankOf = (card) => (isWild(card) ? FACES[card] : FACES[card].slice(1));
export const isNumber = (card) => /^\d$/.test(rankOf(card));
export const drawAmount = (card) => ({ d2: 2, wd4: 4 })[rankOf(card)] ?? 0;
export const cardImage = (card) => `assets/cards/${FACES[card]}.png`;

/** Classic scoring: face value for numbers, 20 for actions, 50 for wilds. */
export function points(card) {
  const rank = rankOf(card);
  if (/^\d$/.test(rank)) return Number(rank);
  return isWild(card) ? 50 : 20;
}

export function rankName(card) {
  const rank = rankOf(card);
  return RANK_NAMES[rank] ?? rank;
}

export function cardName(card) {
  return isWild(card) ? rankName(card) : `${COLOR_NAMES[colorOf(card)]} ${rankName(card)}`;
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Colour group, then rank, then id so duplicate faces keep a stable order.
const sortKey = (card) => (isWild(card) ? COLORS.length : COLORS.indexOf(colorOf(card))) * 100
  + RANK_ORDER.indexOf(rankOf(card)) + card / 1000;

/** Hands are shown grouped by colour, then rank, with wilds last. */
export function sortHand(hand) {
  return [...hand].sort((a, b) => sortKey(a) - sortKey(b));
}
