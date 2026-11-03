/**
 * Classic ids 0..107 index FACES. Reverse ids 108..219 represent the light
 * faces of 112 physical cards; ids 220..331 represent their paired dark faces.
 * Duplicate faces have distinct ids. Face names match assets/cards filenames.
 */
export const COLORS = Object.freeze(['r', 'y', 'g', 'b']);
export const DARK_COLORS = Object.freeze(['p', 't', 'o', 'v']);
export const COLOR_NAMES = Object.freeze({ r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue', p: 'Pink', t: 'Teal', o: 'Orange', v: 'Purple' });
const RANK_NAMES = Object.freeze({ s: 'Skip', r: 'Reverse', d1: 'Draw One', d2: 'Draw Two', d5: 'Draw Five', f: 'Flip', sa: 'Skip Everyone', w: 'Wild', wd2: 'Wild Draw Two', wd4: 'Wild Draw Four', wdc: 'Wild Draw Colour' });
const RANK_ORDER = Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 's', 'sa', 'r', 'f', 'd1', 'd2', 'd5', 'w', 'wd2', 'wd4', 'wdc']);

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
export const REVERSE_DECK_SIZE = 112;
const LIGHT_START = DECK_SIZE;
const DARK_START = LIGHT_START + REVERSE_DECK_SIZE;

function reverseFaces(colors, actions, wilds) {
  const faces = [];
  for (const color of colors) {
    for (let number = 1; number <= 9; number += 1) faces.push(`${color}${number}`, `${color}${number}`);
    for (const action of actions) faces.push(color + action, color + action);
  }
  for (const wild of wilds) for (let copy = 0; copy < 4; copy += 1) faces.push(wild);
  return faces;
}

export const LIGHT_FACES = Object.freeze(reverseFaces(COLORS, ['d1', 'r', 's', 'f'], ['w', 'wd2']));
const darkFaces = reverseFaces(DARK_COLORS, ['d5', 'r', 'sa', 'f'], ['dw', 'dwc']);
// 37 is coprime to 112: this fixed permutation pairs every physical card once,
// without making the opposite side a trivial matching colour/rank.
export const DARK_FACES = Object.freeze(darkFaces.map((_, index) => darkFaces[(index * 37 + 17) % REVERSE_DECK_SIZE]));
export const cardSide = (card) => card >= DARK_START ? 'dark' : 'light';
export const flipCard = (card) => card < LIGHT_START ? card : card >= DARK_START ? card - REVERSE_DECK_SIZE : card + REVERSE_DECK_SIZE;
export const deckSize = (mode = 'classic') => mode === 'reverse' ? REVERSE_DECK_SIZE : DECK_SIZE;
export const deckFor = (mode = 'classic', side = 'light') => Array.from({ length: deckSize(mode) }, (_, index) => index + (mode === 'reverse' ? side === 'dark' ? DARK_START : LIGHT_START : 0));
export const colorsFor = (side = 'light') => side === 'dark' ? DARK_COLORS : COLORS;
export const isCard = (card) => Number.isInteger(card) && card >= 0 && card < DARK_START + REVERSE_DECK_SIZE;
export const faceOf = (card) => card < LIGHT_START ? FACES[card] : card < DARK_START ? LIGHT_FACES[card - LIGHT_START] : DARK_FACES[card - DARK_START];
export const isWild = (card) => ['w', 'wd2', 'wd4', 'dw', 'dwc'].includes(faceOf(card));
export const colorOf = (card) => (isWild(card) ? null : faceOf(card)?.[0]);
export const rankOf = (card) => faceOf(card) === 'dw' ? 'w' : faceOf(card) === 'dwc' ? 'wdc' : isWild(card) ? faceOf(card) : faceOf(card)?.slice(1);
export const isNumber = (card) => /^\d$/.test(rankOf(card));
export const drawAmount = (card) => ({ d1: 1, d2: 2, d5: 5, wd2: 2, wd4: 4 })[rankOf(card)] ?? 0;
export const cardImage = (card) => `assets/cards/${faceOf(card)}.svg`;

/** Score the visible face, using classic or Reverse values as appropriate. */
export function points(card) {
  const rank = rankOf(card);
  if (/^\d$/.test(rank)) return Number(rank);
  if (card >= LIGHT_START) return ({ d1: 10, sa: 30, w: 40, wd2: 50, wdc: 60 })[rank] ?? 20;
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
const sortKey = (card) => (isWild(card) ? 4 : colorsFor(cardSide(card)).indexOf(colorOf(card))) * 100
  + RANK_ORDER.indexOf(rankOf(card)) + card / 1000;

/** Hands are shown grouped by colour, then rank, with wilds last. */
export function sortHand(hand) {
  return [...hand].sort((a, b) => sortKey(a) - sortKey(b));
}
