import {
  COLORS, DECK_SIZE, colorOf, drawAmount, faceOf, isCard, isNumber, isWild, points, rankOf, shuffle,
} from './cards.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const LOG_LIMIT = 12;
export const VISIBLE_DISCARD = 6;
const PHASES = Object.freeze(['lobby', 'playing', 'roundOver']);

export const SETTING_OPTIONS = Object.freeze({
  turnTimer: Object.freeze([0, 10, 15, 20, 30, 45, 60]),
  stacking: Object.freeze(['off', 'same', 'progressive']),
  jumpIn: Object.freeze([true, false]),
  sevenZero: Object.freeze([true, false]),
  drawToMatch: Object.freeze([true, false]),
  forcePlay: Object.freeze([true, false]),
  wildFour: Object.freeze(['challenge', 'anytime', 'strict']),
  mustCall: Object.freeze([true, false]),
  handSize: Object.freeze([5, 7, 10]),
  targetScore: Object.freeze([0, 200, 500]),
});

export const DEFAULT_SETTINGS = Object.freeze({
  turnTimer: 30,
  stacking: 'same',
  jumpIn: true,
  sevenZero: false,
  drawToMatch: false,
  forcePlay: false,
  wildFour: 'challenge',
  mustCall: true,
  handSize: 7,
  targetScore: 0,
});

const clone = (value) => structuredClone(value);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => Number.isSafeInteger(value) && value > 0;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isIdList = (value, max = Infinity) => Array.isArray(value) && value.length <= max
  && value.every(isId) && new Set(value).size === value.length;
const isCardList = (value) => Array.isArray(value) && value.every(isCard) && new Set(value).size === value.length;

export function normalizeSettings(input, base = DEFAULT_SETTINGS) {
  const settings = {};
  for (const [key, options] of Object.entries(SETTING_OPTIONS)) {
    const wanted = isRecord(input) && Object.hasOwn(input, key) ? input[key] : base?.[key];
    settings[key] = options.includes(wanted) ? wanted : DEFAULT_SETTINGS[key];
  }
  return settings;
}

const validSettings = (settings) => isRecord(settings)
  && Object.entries(SETTING_OPTIONS).every(([key, options]) => options.includes(settings[key]));

export function createTable({ settings } = {}) {
  return {
    phase: 'lobby',
    round: 0,
    revision: 0,
    settings: normalizeSettings(settings),
    seats: [],
    sittingOut: [],
    scores: {},
    hands: [],
    drawPile: [],
    discard: [],
    color: null,
    direction: 1,
    current: null,
    stage: 'play',
    turnSeq: 0,
    turnNo: 0,
    pendingDraw: 0,
    drawnCard: null,
    wd4: null,
    called: [],
    exposed: null,
    lastPlay: null,
    winner: null,
    matchWinner: null,
    roundPoints: 0,
    reveal: [],
    log: [],
    logSeq: 0,
  };
}

// ---------------------------------------------------------------------------
// Queries shared by the authoritative table and the per-player view
// ---------------------------------------------------------------------------

export const topCard = (table) => (table.discard.length ? table.discard[table.discard.length - 1] : null);

function stackable(settings, top, card) {
  if (settings.stacking === 'off' || top === null) return false;
  const rank = rankOf(card);
  const topRank = rankOf(top);
  if ((rank === 'd2' || rank === 'wd4') && rank === topRank) return true;
  return settings.stacking === 'progressive' && topRank === 'd2' && rank === 'wd4';
}

/**
 * Whether a player may play a card right now. Works on the full table and on
 * a player's view, which carry the same public fields. Returns null when the
 * play is illegal, otherwise whether it is an out-of-turn jump-in.
 */
export function playCheck(table, playerId, hand, card) {
  if (table.phase !== 'playing' || !Array.isArray(hand) || !hand.includes(card)) return null;
  const top = topCard(table);
  if (playerId === table.current) {
    if (table.stage === 'drawn' && card !== table.drawnCard) return null;
    if (table.pendingDraw > 0) return stackable(table.settings, top, card) ? { jumpIn: false } : null;
    if (!isWild(card) && colorOf(card) !== table.color && rankOf(card) !== rankOf(top)) return null;
    if (rankOf(card) === 'wd4' && table.settings.wildFour === 'strict'
      && hand.some((other) => other !== card && colorOf(other) === table.color)) return null;
    return { jumpIn: false };
  }
  // Jump-in: an identical coloured card, out of turn, never onto your own play.
  if (!table.settings.jumpIn || top === null || isWild(card) || faceOf(card) !== faceOf(top)) return null;
  if (!table.seats.includes(playerId) || table.lastPlay?.by === playerId) return null;
  return { jumpIn: true };
}

export function canChallenge(table, playerId) {
  const top = topCard(table);
  return table.phase === 'playing' && table.current === playerId && table.stage === 'play'
    && table.pendingDraw > 0 && table.settings.wildFour === 'challenge'
    && table.wd4 !== null && top !== null && rankOf(top) === 'wd4';
}

export function canCall(table, playerId, hand) {
  if (table.phase !== 'playing' || !Array.isArray(hand) || table.called.includes(playerId)) return false;
  if (hand.length === 1) return table.exposed === playerId;
  return hand.length === 2 && table.current === playerId;
}

/** Everything a seated player could do at this moment. */
export function choicesFor(table, playerId, hand) {
  const playing = table.phase === 'playing';
  const mine = playing && table.current === playerId;
  const playable = [];
  const jumpIns = [];
  if (playing && Array.isArray(hand)) {
    for (const card of hand) {
      const check = playCheck(table, playerId, hand, card);
      if (!check) continue;
      playable.push(card);
      if (check.jumpIn) jumpIns.push(card);
    }
  }
  return {
    playable,
    jumpIns,
    draw: mine && table.stage === 'play',
    keep: mine && table.stage === 'drawn' && !(table.settings.forcePlay && playable.includes(table.drawnCard)),
    challenge: canChallenge(table, playerId),
    call: canCall(table, playerId, hand),
    catch: playing && table.seats.includes(playerId) && table.exposed !== null && table.exposed !== playerId,
  };
}

export function bestColor(hand, random = Math.random) {
  const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
  for (const card of hand) if (!isWild(card)) counts[colorOf(card)] += 1;
  const most = Math.max(...Object.values(counts));
  const options = COLORS.filter((color) => counts[color] === most);
  return options[Math.floor(random() * options.length)];
}

/** The opponent holding the fewest cards: the obvious 7-swap target. */
export function smallestHand(table, playerId, counts = table.hands.map((hand) => hand.length)) {
  let best = null;
  table.seats.forEach((id, index) => {
    if (id !== playerId && (best === null || counts[index] < counts[best])) best = index;
  });
  return best === null ? null : table.seats[best];
}

// ---------------------------------------------------------------------------
// Internal mutations. Each works on a private clone.
// ---------------------------------------------------------------------------

function addLog(s, entry) {
  s.logSeq += 1;
  s.log = [...s.log, { n: s.logSeq, ...entry }].slice(-LOG_LIMIT);
}

function step(s, index, steps) {
  const count = s.seats.length;
  return (((index + s.direction * steps) % count) + count) % count;
}

function pass(s, index, steps) {
  s.current = s.seats[step(s, index, steps)];
  s.stage = 'play';
  s.drawnCard = null;
  s.turnSeq += 1;
  s.turnNo += 1;
  return true;
}

// Any action by someone else closes the window for catching a missed call.
function closeCatchWindow(s, actorId) {
  if (s.exposed !== null && s.exposed !== actorId) s.exposed = null;
}

function drawCards(s, index, count, random) {
  const hand = s.hands[index];
  const drawn = [];
  for (let i = 0; i < count; i += 1) {
    if (!s.drawPile.length && s.discard.length > 1) {
      const top = s.discard.pop();
      s.drawPile = shuffle(s.discard, random);
      s.discard = [top];
      addLog(s, { k: 'reshuffle' });
    }
    if (!s.drawPile.length) break;
    const card = s.drawPile.pop();
    hand.push(card);
    drawn.push(card);
  }
  const id = s.seats[index];
  if (hand.length > 1) {
    s.called = s.called.filter((other) => other !== id);
    if (s.exposed === id) s.exposed = null;
  }
  return drawn;
}

function resetCallsAfterShuffle(s) {
  s.called = s.seats.filter((_, index) => s.hands[index].length === 1);
  s.exposed = null;
}

function seatMembers(s, memberIds) {
  s.sittingOut = s.sittingOut.filter((id) => memberIds.includes(id));
  s.seats = s.seats.filter((id) => memberIds.includes(id) && !s.sittingOut.includes(id));
  for (const id of memberIds) {
    if (s.seats.length >= MAX_PLAYERS) break;
    if (!s.seats.includes(id) && !s.sittingOut.includes(id)) s.seats.push(id);
  }
}

function clearRound(s) {
  s.hands = [];
  s.drawPile = [];
  s.current = null;
  s.stage = 'play';
  s.pendingDraw = 0;
  s.drawnCard = null;
  s.wd4 = null;
  s.called = [];
  s.exposed = null;
  s.turnSeq += 1;
}

function startRound(s, random) {
  if (s.matchWinner !== null) {
    s.scores = {};
    s.matchWinner = null;
    s.round = 0;
  }
  for (const id of s.seats) if (!isCount(s.scores[id])) s.scores[id] = 0;
  s.round += 1;
  const deck = shuffle([...Array(DECK_SIZE).keys()], random);
  s.hands = s.seats.map(() => []);
  for (let i = 0; i < s.settings.handSize; i += 1) {
    for (const hand of s.hands) hand.push(deck.pop());
  }
  // The round always opens on a number card, so nobody is hit before playing.
  const opener = deck.findIndex((card) => isNumber(card));
  s.discard = deck.splice(opener, 1);
  s.drawPile = deck;
  s.color = colorOf(s.discard[0]);
  s.direction = 1;
  s.current = s.seats[(s.round - 1) % s.seats.length];
  s.stage = 'play';
  s.pendingDraw = 0;
  s.drawnCard = null;
  s.wd4 = null;
  s.called = [];
  s.exposed = null;
  s.lastPlay = null;
  s.winner = null;
  s.roundPoints = 0;
  s.reveal = [];
  s.phase = 'playing';
  s.turnSeq += 1;
  s.turnNo += 1;
  addLog(s, { k: 'deal', round: s.round, by: s.current });
}

function finishRound(s, winnerId) {
  let total = 0;
  s.reveal = s.seats.map((id, index) => {
    const value = s.hands[index].reduce((sum, card) => sum + points(card), 0);
    if (id !== winnerId) total += value;
    return { id, cards: [...s.hands[index]], points: value };
  });
  s.scores[winnerId] = (s.scores[winnerId] ?? 0) + total;
  s.roundPoints = total;
  s.winner = winnerId;
  if (s.settings.targetScore > 0 && s.scores[winnerId] >= s.settings.targetScore) s.matchWinner = winnerId;
  s.phase = 'roundOver';
  clearRound(s);
  addLog(s, { k: 'win', by: winnerId, points: total });
}

function abandon(s) {
  s.phase = 'lobby';
  s.winner = null;
  s.reveal = [];
  clearRound(s);
  addLog(s, { k: 'abandon' });
}

function doPlay(s, playerId, action, random) {
  if (s.phase !== 'playing') return false;
  const index = s.seats.indexOf(playerId);
  if (index < 0) return false;
  const hand = s.hands[index];
  const { card, color, target } = action;
  const check = playCheck(s, playerId, hand, card);
  if (!check || (!check.jumpIn && action.seq !== s.turnSeq)) return false;
  const rank = rankOf(card);
  const wild = isWild(card);
  if (wild && !COLORS.includes(color)) return false;
  const finishing = hand.length === 1;
  const swapping = s.settings.sevenZero && rank === '7' && !finishing;
  if (swapping && (!s.seats.includes(target) || target === playerId)) return false;

  closeCatchWindow(s, playerId);
  // Stacking onto a pending draw is never a bluff: no colour card was allowed then.
  const bluff = rank === 'wd4' && s.pendingDraw === 0 && hand.some((other) => other !== card && colorOf(other) === s.color);
  hand.splice(hand.indexOf(card), 1);
  s.discard.push(card);
  s.color = wild ? color : colorOf(card);
  s.drawnCard = null;
  s.lastPlay = { by: playerId, card, ...(wild ? { color } : {}), ...(check.jumpIn ? { jumpIn: true } : {}), ...(swapping ? { target } : {}) };
  addLog(s, { k: 'play', by: playerId, card, ...(wild ? { color } : {}), ...(check.jumpIn ? { jump: true } : {}) });
  if (rank !== 'wd4') s.wd4 = null;

  if (hand.length === 1) {
    if (!s.called.includes(playerId)) {
      if (s.settings.mustCall) s.exposed = playerId;
      else s.called.push(playerId);
    }
  } else {
    s.called = s.called.filter((id) => id !== playerId);
  }

  const amount = drawAmount(card);
  if (finishing) {
    // A final draw card still lands before the round is scored.
    if (amount) {
      const victimIndex = step(s, index, 1);
      const got = drawCards(s, victimIndex, s.pendingDraw + amount, random);
      addLog(s, { k: 'take', by: s.seats[victimIndex], n: got.length });
    }
    s.pendingDraw = 0;
    finishRound(s, playerId);
    return true;
  }

  if (rank === 'r') {
    s.direction *= -1;
    return pass(s, index, s.seats.length === 2 ? 2 : 1);
  }
  if (rank === 's') return pass(s, index, 2);
  if (amount) {
    s.pendingDraw += amount;
    if (rank === 'wd4') s.wd4 = { by: playerId, bluff };
    const canRespond = s.settings.stacking !== 'off' || (rank === 'wd4' && s.settings.wildFour === 'challenge');
    if (canRespond) return pass(s, index, 1);
    const victimIndex = step(s, index, 1);
    const got = drawCards(s, victimIndex, s.pendingDraw, random);
    addLog(s, { k: 'take', by: s.seats[victimIndex], n: got.length });
    s.pendingDraw = 0;
    s.wd4 = null;
    return pass(s, index, 2);
  }
  if (swapping) {
    const targetIndex = s.seats.indexOf(target);
    [s.hands[index], s.hands[targetIndex]] = [s.hands[targetIndex], s.hands[index]];
    addLog(s, { k: 'swap', by: playerId, target });
    resetCallsAfterShuffle(s);
  } else if (s.settings.sevenZero && rank === '0') {
    const previous = s.hands;
    s.hands = s.seats.map((_, seat) => previous[step(s, seat, -1)]);
    addLog(s, { k: 'rotate', direction: s.direction });
    resetCallsAfterShuffle(s);
  }
  return pass(s, index, 1);
}

function doDraw(s, playerId, random) {
  if (s.phase !== 'playing' || s.current !== playerId || s.stage !== 'play') return false;
  const index = s.seats.indexOf(playerId);
  closeCatchWindow(s, playerId);
  if (s.pendingDraw > 0) {
    const got = drawCards(s, index, s.pendingDraw, random);
    addLog(s, { k: 'take', by: playerId, n: got.length });
    s.pendingDraw = 0;
    s.wd4 = null;
    return pass(s, index, 1);
  }
  const drawn = [];
  for (;;) {
    const [card] = drawCards(s, index, 1, random);
    if (card === undefined) break;
    drawn.push(card);
    if (!s.settings.drawToMatch || playCheck(s, playerId, s.hands[index], card)) break;
  }
  addLog(s, { k: 'draw', by: playerId, n: drawn.length });
  const last = drawn.at(-1);
  if (last !== undefined && playCheck(s, playerId, s.hands[index], last)) {
    s.stage = 'drawn';
    s.drawnCard = last;
    s.turnSeq += 1;
    return true;
  }
  return pass(s, index, 1);
}

// Forced play cannot apply once the drawn card stopped being legal (a penalty
// draw can bring in the active colour under the "only when stuck" +4 rule).
const mustPlayDrawn = (s, playerId, hand) => s.settings.forcePlay && playCheck(s, playerId, hand, s.drawnCard) !== null;

function doKeep(s, playerId) {
  if (s.phase !== 'playing' || s.current !== playerId || s.stage !== 'drawn') return false;
  if (mustPlayDrawn(s, playerId, s.hands[s.seats.indexOf(playerId)])) return false;
  addLog(s, { k: 'keep', by: playerId });
  return pass(s, s.seats.indexOf(playerId), 1);
}

function doChallenge(s, playerId, random) {
  if (!canChallenge(s, playerId)) return false;
  const index = s.seats.indexOf(playerId);
  const amount = s.pendingDraw;
  const { by, bluff } = s.wd4;
  s.pendingDraw = 0;
  s.wd4 = null;
  closeCatchWindow(s, playerId);
  if (bluff) {
    // Caught bluffing: the cards go back to the player who bluffed, and the
    // challenger plays on as normal.
    const offender = s.seats.indexOf(by);
    const got = offender >= 0 ? drawCards(s, offender, amount, random).length : 0;
    addLog(s, { k: 'challenge', by: playerId, target: by, won: true, n: got });
    s.turnSeq += 1;
    return true;
  }
  const got = drawCards(s, index, amount + 2, random);
  addLog(s, { k: 'challenge', by: playerId, target: by, won: false, n: got.length });
  return pass(s, index, 1);
}

function doCall(s, playerId) {
  const index = s.seats.indexOf(playerId);
  if (index < 0 || !canCall(s, playerId, s.hands[index])) return false;
  s.called.push(playerId);
  if (s.exposed === playerId) s.exposed = null;
  addLog(s, { k: 'call', by: playerId });
  return true;
}

function doCatch(s, playerId, random) {
  if (s.phase !== 'playing' || !s.seats.includes(playerId) || s.exposed === null || s.exposed === playerId) return false;
  const target = s.exposed;
  s.exposed = null;
  const got = drawCards(s, s.seats.indexOf(target), 2, random);
  addLog(s, { k: 'catch', by: playerId, target, n: got.length });
  return true;
}

function doDeal(s, playerId, hostId, memberIds, random) {
  if (s.phase === 'playing') return false;
  if (playerId !== hostId && !(s.phase === 'roundOver' && s.seats.includes(playerId))) return false;
  seatMembers(s, memberIds);
  if (s.seats.length < MIN_PLAYERS) return false;
  startRound(s, random);
  return true;
}

function doSeat(s, playerId, watch, memberIds) {
  if (typeof watch !== 'boolean') return false;
  const watching = s.sittingOut.includes(playerId);
  if (watch === watching) return false;
  // Mid-round, only spectators can change whether they would take a free seat.
  if (s.phase === 'playing' && s.seats.includes(playerId)) return false;
  s.sittingOut = watch ? [...s.sittingOut, playerId] : s.sittingOut.filter((id) => id !== playerId);
  if (s.phase !== 'playing') seatMembers(s, memberIds);
  return true;
}

function replaceDeparted(s, memberIds, random) {
  for (const id of s.seats.filter((seated) => !memberIds.includes(seated))) {
    const index = s.seats.indexOf(id);
    const substitute = memberIds.find((member) => !s.seats.includes(member) && !s.sittingOut.includes(member));
    addLog(s, { k: 'left', by: id });
    s.called = s.called.filter((other) => other !== id);
    if (s.exposed === id) s.exposed = null;
    if (substitute !== undefined) {
      // A waiting spectator picks up the departed player's hand in place.
      s.seats[index] = substitute;
      if (!isCount(s.scores[substitute])) s.scores[substitute] = 0;
      if (s.hands[index].length === 1) s.called.push(substitute);
      if (s.current === id) {
        s.current = substitute;
        s.turnSeq += 1;
        s.turnNo += 1;
      }
      addLog(s, { k: 'sub', by: substitute });
      continue;
    }
    if (s.current === id) {
      // Pending draws were aimed at the departed player and leave with them.
      s.pendingDraw = 0;
      s.wd4 = null;
      pass(s, index, 1);
    }
    s.drawPile = shuffle([...s.drawPile, ...s.hands[index]], random);
    s.seats.splice(index, 1);
    s.hands.splice(index, 1);
    if (s.seats.length < MIN_PLAYERS) {
      abandon(s);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Public transitions. Each returns a new table, or null when not allowed.
// ---------------------------------------------------------------------------

/**
 * Apply a participant's action. Turn actions carry the turnSeq they were
 * chosen against, so a click made before someone jumped in is rejected.
 */
export function applyAction(state, playerId, action, { hostId = null, memberIds = null, random = Math.random } = {}) {
  if (!isRecord(action) || !isId(playerId)) return null;
  const s = clone(state);
  const members = Array.isArray(memberIds) ? memberIds : [...s.seats];
  const onTurn = () => s.phase === 'playing' && s.current === playerId && action.seq === s.turnSeq;
  let ok = false;
  switch (action.type) {
    case 'play': ok = doPlay(s, playerId, action, random); break;
    case 'draw': ok = onTurn() && doDraw(s, playerId, random); break;
    case 'keep': ok = onTurn() && doKeep(s, playerId); break;
    case 'challenge': ok = onTurn() && doChallenge(s, playerId, random); break;
    case 'call': ok = doCall(s, playerId); break;
    case 'catch': ok = doCatch(s, playerId, random); break;
    case 'deal': ok = members.includes(playerId) && doDeal(s, playerId, hostId, members, random); break;
    case 'seat': ok = members.includes(playerId) && doSeat(s, playerId, action.watch, members); break;
    case 'settings': {
      if (playerId !== hostId || s.phase === 'playing' || !isRecord(action.settings)) break;
      const next = normalizeSettings(action.settings, s.settings);
      ok = JSON.stringify(next) !== JSON.stringify(s.settings);
      s.settings = next;
      break;
    }
    case 'lobby':
      ok = playerId === hostId && s.phase === 'roundOver';
      if (ok) {
        s.phase = 'lobby';
        s.winner = null;
        s.reveal = [];
        seatMembers(s, members);
      }
      break;
    default: return null;
  }
  if (!ok) return null;
  s.revision = state.revision + 1;
  return s;
}

/** The turn timer ran out: draw (or take the stack), then keep or force the play. */
export function expireTurn(state, random = Math.random) {
  if (state.phase !== 'playing' || state.current === null) return null;
  const s = clone(state);
  const id = s.current;
  const turn = s.turnNo;
  addLog(s, { k: 'timeout', by: id });
  if (s.stage === 'play') doDraw(s, id, random);
  if (s.phase === 'playing' && s.turnNo === turn && s.stage === 'drawn' && s.settings.forcePlay) {
    const card = s.drawnCard;
    const rest = s.hands[s.seats.indexOf(id)].filter((other) => other !== card);
    doPlay(s, id, {
      card,
      seq: s.turnSeq,
      color: isWild(card) ? bestColor(rest, random) : undefined,
      target: smallestHand(s, id),
    }, random);
  }
  // Whatever happened above, an expired turn always moves on.
  if (s.phase === 'playing' && s.turnNo === turn) {
    if (s.stage === 'drawn') addLog(s, { k: 'keep', by: id });
    pass(s, s.seats.indexOf(id), 1);
  }
  s.revision = state.revision + 1;
  return s;
}

/** Keep seats in step with who is in the activity. */
export function applyRoster(state, memberIds, random = Math.random) {
  const s = clone(state);
  if (s.phase === 'playing') replaceDeparted(s, memberIds, random);
  if (s.phase !== 'playing') seatMembers(s, memberIds);
  if (JSON.stringify(s) === JSON.stringify(state)) return state;
  s.revision = state.revision + 1;
  return s;
}

/** End the current round without a winner and return to the lobby. */
export function abandonRound(state) {
  if (state.phase !== 'playing') return state;
  const s = clone(state);
  abandon(s);
  s.revision = state.revision + 1;
  return s;
}

/** What one participant may see. Other hands and the draw order never leave the host. */
export function viewFor(table, viewerId) {
  const seat = table.seats.indexOf(viewerId);
  const playing = table.phase === 'playing';
  return {
    phase: table.phase,
    round: table.round,
    revision: table.revision,
    settings: { ...table.settings },
    seats: [...table.seats],
    sittingOut: [...table.sittingOut],
    scores: { ...table.scores },
    counts: playing ? table.hands.map((hand) => hand.length) : [],
    drawCount: table.drawPile.length,
    discard: table.discard.slice(-VISIBLE_DISCARD),
    discardCount: table.discard.length,
    color: table.color,
    direction: table.direction,
    current: table.current,
    stage: table.stage,
    turnSeq: table.turnSeq,
    turnNo: table.turnNo,
    pendingDraw: table.pendingDraw,
    wd4: table.wd4 && { by: table.wd4.by },
    called: [...table.called],
    exposed: table.exposed,
    lastPlay: table.lastPlay && { ...table.lastPlay },
    winner: table.winner,
    matchWinner: table.matchWinner,
    roundPoints: table.roundPoints,
    reveal: clone(table.reveal),
    log: clone(table.log),
    hand: playing && seat >= 0 ? [...table.hands[seat]] : null,
    drawnCard: playing && viewerId === table.current ? table.drawnCard : null,
  };
}

/**
 * Rebuild an authoritative table from a player's view after the host left.
 * Seated players report their own hands; anything missing or inconsistent is
 * re-dealt from the unseen cards, which also become a freshly shuffled pile.
 */
export function rebuildTable(view, reports = new Map(), random = Math.random) {
  const t = createTable({ settings: view.settings });
  Object.assign(t, {
    phase: view.phase,
    round: view.round,
    revision: view.revision + 1,
    seats: [...view.seats],
    sittingOut: [...view.sittingOut],
    scores: { ...view.scores },
    discard: [...view.discard],
    color: view.color,
    direction: view.direction,
    current: view.current,
    turnSeq: view.turnSeq + 1,
    turnNo: view.turnNo + 1,
    pendingDraw: view.pendingDraw,
    // Whether the last +4 was a bluff left with the old host, so it cannot be challenged.
    wd4: null,
    called: [...view.called],
    exposed: view.exposed,
    lastPlay: view.lastPlay && { ...view.lastPlay },
    winner: view.winner,
    matchWinner: view.matchWinner,
    roundPoints: view.roundPoints,
    reveal: clone(view.reveal),
    log: clone(view.log),
    logSeq: Math.max(0, ...view.log.map((entry) => entry.n).filter(isCount)),
  });
  if (t.phase !== 'playing') return t;

  // A card claimed twice (a stale report, or a fib) is trusted for nobody.
  const claims = t.seats.map((id, index) => {
    const claim = reports.get(id)?.hand;
    return isCardList(claim) && claim.length === view.counts[index] ? claim : null;
  });
  const claimCount = new Map();
  for (const card of [...t.discard, ...claims.flatMap((claim) => claim ?? [])]) claimCount.set(card, (claimCount.get(card) ?? 0) + 1);
  const used = new Set(t.discard);
  const missing = [];
  t.hands = claims.map((claim, index) => {
    if (claim && claim.every((card) => claimCount.get(card) === 1)) {
      for (const card of claim) used.add(card);
      return [...claim];
    }
    missing.push(index);
    return [];
  });
  const pool = shuffle([...Array(DECK_SIZE).keys()].filter((card) => !used.has(card)), random);
  for (const index of missing) t.hands[index] = pool.splice(0, view.counts[index]);
  t.drawPile = pool;
  const drawn = reports.get(view.current)?.drawnCard;
  const currentHand = t.hands[t.seats.indexOf(view.current)];
  if (view.stage === 'drawn' && currentHand?.includes(drawn) && playCheck({ ...t, stage: 'drawn', drawnCard: drawn }, view.current, currentHand, drawn)) {
    t.stage = 'drawn';
    t.drawnCard = drawn;
  }
  addLog(t, { k: 'recover' });
  return t;
}

// ---------------------------------------------------------------------------
// Validation of untrusted state (storage and network)
// ---------------------------------------------------------------------------

const validLog = (log) => Array.isArray(log) && log.length <= LOG_LIMIT
  && log.every((entry) => isRecord(entry) && isCount(entry.n) && typeof entry.k === 'string');
const validScores = (scores) => isRecord(scores)
  && Object.entries(scores).every(([key, value]) => /^[1-9]\d*$/.test(key) && isCount(value));
const validReveal = (reveal) => Array.isArray(reveal) && reveal.length <= MAX_PLAYERS
  && reveal.every((entry) => isRecord(entry) && isId(entry.id) && isCardList(entry.cards) && isCount(entry.points));
const validLastPlay = (play) => play === null || (isRecord(play) && isId(play.by) && isCard(play.card));
const optionalId = (value) => value === null || isId(value);

function validCommon(t) {
  return isRecord(t) && PHASES.includes(t.phase)
    && ['round', 'revision', 'turnSeq', 'turnNo', 'pendingDraw', 'roundPoints'].every((key) => isCount(t[key]))
    && validSettings(t.settings)
    && isIdList(t.seats, MAX_PLAYERS) && isIdList(t.sittingOut)
    && validScores(t.scores) && Array.isArray(t.discard) && t.discard.every(isCard)
    && (t.direction === 1 || t.direction === -1) && (t.stage === 'play' || t.stage === 'drawn')
    && isIdList(t.called) && optionalId(t.exposed) && optionalId(t.winner) && optionalId(t.matchWinner)
    && validLastPlay(t.lastPlay) && validReveal(t.reveal) && validLog(t.log)
    && (t.wd4 === null || (isRecord(t.wd4) && isId(t.wd4.by)));
}

function validPlaying(t, counts) {
  if (t.seats.length < MIN_PLAYERS || counts.length !== t.seats.length || !counts.every(isCount)) return false;
  if (!t.discard.length || !COLORS.includes(t.color) || !t.seats.includes(t.current)) return false;
  if (!t.called.every((id) => t.seats.includes(id)) || (t.exposed !== null && !t.seats.includes(t.exposed))) return false;
  return t.stage === 'play' || t.pendingDraw === 0;
}

function validResting(t) {
  return t.current === null && t.pendingDraw === 0 && t.stage === 'play' && t.called.length === 0 && t.exposed === null;
}

export function isValidTable(t) {
  try {
    if (!validCommon(t) || !isCount(t.logSeq) || !Array.isArray(t.hands) || !Array.isArray(t.drawPile)) return false;
    if (t.wd4 !== null && typeof t.wd4.bluff !== 'boolean') return false;
    if (t.phase !== 'playing') return validResting(t) && t.hands.length === 0 && t.drawPile.length === 0 && t.drawnCard === null;
    if (!t.hands.every(Array.isArray) || !validPlaying(t, t.hands.map((hand) => hand.length))) return false;
    const everyCard = [...t.hands.flat(), ...t.drawPile, ...t.discard];
    if (everyCard.length !== DECK_SIZE || !everyCard.every(isCard) || new Set(everyCard).size !== DECK_SIZE) return false;
    const currentHand = t.hands[t.seats.indexOf(t.current)];
    return t.stage === 'drawn' ? currentHand.includes(t.drawnCard) : t.drawnCard === null;
  } catch {
    return false;
  }
}

/** Structural checks for a snapshot received from the host or a peer. */
export function isValidView(v, memberIds = null, viewerId = null) {
  try {
    if (!validCommon(v) || !isCount(v.drawCount) || !isCount(v.discardCount)) return false;
    if (v.discard.length > VISIBLE_DISCARD || v.discardCount < v.discard.length) return false;
    if (v.drawCount + v.discardCount > DECK_SIZE || !Array.isArray(v.counts)) return false;
    if (memberIds && !v.seats.every((id) => memberIds.includes(id))) return false;
    const seat = viewerId === null ? -1 : v.seats.indexOf(viewerId);
    if (v.phase !== 'playing') {
      return validResting(v) && v.counts.length === 0 && v.hand === null && v.drawnCard === null;
    }
    if (!validPlaying(v, v.counts)) return false;
    if (v.counts.reduce((sum, count) => sum + count, 0) + v.drawCount + v.discardCount !== DECK_SIZE) return false;
    if (seat < 0) return v.hand === null && v.drawnCard === null;
    if (!isCardList(v.hand) || v.hand.length !== v.counts[seat]) return false;
    if (v.drawnCard !== null && (v.current !== viewerId || v.stage !== 'drawn' || !v.hand.includes(v.drawnCard))) return false;
    return v.drawnCard !== null || v.current !== viewerId || v.stage === 'play';
  } catch {
    return false;
  }
}
