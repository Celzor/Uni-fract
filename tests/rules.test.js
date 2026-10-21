import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, DECK_SIZE, FACES, cardName, colorOf, isNumber, points, rankOf, sortHand } from '../src/cards.js';
import {
  BOT_NAMES, DEFAULT_SETTINGS, MAX_PLAYERS, NEXT_ROUND_DELAY_MS, abandonRound, applyAction, applyRoster, botName, choicesFor, createTable,
  expireTurn, isBotId, isValidTable, isValidView, normalizeSettings, rebuildTable, topCard, viewFor,
} from '../src/rules.js';
import { chooseTurnAction } from '../src/bots.js';
import { cardPicker, faces, handOf, playing, seeded } from './helpers.js';

const HOST = 1;
const act = (table, id, action, members, now = () => 1000) => applyAction(table, id, { seq: table.turnSeq, ...action }, {
  hostId: HOST, memberIds: members ?? table.seats, random: seeded(7), now,
});
const cardIn = (table, id, face) => {
  const card = handOf(table, id).find((value) => FACES[value] === face);
  assert.notEqual(card, undefined, `${id} holds ${face}`);
  return card;
};
const play = (table, id, face, extra = {}, members) => act(table, id, { type: 'play', card: cardIn(table, id, face), ...extra }, members);

test('the deck has 108 cards with classic counts and scoring', () => {
  assert.equal(DECK_SIZE, 108);
  for (const color of COLORS) {
    const mine = FACES.filter((face) => face[0] === color);
    assert.equal(mine.length, 25);
    assert.equal(mine.filter((face) => face === `${color}0`).length, 1);
    for (const rank of ['1', '9', 's', 'r', 'd2']) assert.equal(mine.filter((face) => face === color + rank).length, 2);
  }
  assert.equal(FACES.filter((face) => face === 'w').length, 4);
  assert.equal(FACES.filter((face) => face === 'wd4').length, 4);
  const { take } = cardPicker();
  assert.deepEqual([take('r7'), take('bs'), take('w'), take('wd4')].map(points), [7, 20, 50, 50]);
  assert.equal(cardName(take('gd2')), 'Green Draw Two');
  assert.deepEqual(faces(sortHand([take('wd4'), take('b2'), take('r9'), take('r1'), take('y5')])), ['r1', 'r9', 'y5', 'b2', 'wd4']);
});

test('settings are normalized to known options', () => {
  assert.deepEqual(normalizeSettings({ turnTimer: 11, stacking: 'progressive', jumpIn: 'yes', extra: true }), {
    ...DEFAULT_SETTINGS, turnTimer: 11, stacking: 'progressive',
  });
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ wildFour: 'challenge' }).wildFour, 'anytime');
  assert.equal(normalizeSettings({}, { ...DEFAULT_SETTINGS, wildFour: 'challenge' }).wildFour, 'anytime');
});

test('custom turn timers accept whole seconds across the range and reject invalid settings', () => {
  for (const turnTimer of [0, 1, 3, 7, 11, 90, 600]) {
    const table = createTable({ settings: { turnTimer } });
    assert.equal(table.settings.turnTimer, turnTimer);
    assert.equal(normalizeSettings({ stacking: 'off' }, table.settings).turnTimer, turnTimer,
      'changing another rule preserves a custom timer');
    assert.ok(isValidTable(table));
    assert.ok(isValidView(viewFor(table, 1), [1], 1));
  }
  const table = createTable();
  const view = viewFor(table, 1);
  for (const turnTimer of [-1, 601, 0.5, 7.1, Infinity, NaN, '7', null, true]) {
    assert.equal(normalizeSettings({ turnTimer }).turnTimer, DEFAULT_SETTINGS.turnTimer);
    assert.equal(isValidTable({ ...table, settings: { ...table.settings, turnTimer } }), false);
    assert.equal(isValidView({ ...view, settings: { ...view.settings, turnTimer } }, [1], 1), false);
  }
});

test('the lobby seats up to six in arrival order and the host deals a fair opening', () => {
  const members = [1, 2, 3, 4, 5, 6, 7];
  let table = applyRoster(createTable(), members);
  assert.deepEqual(table.seats, [1, 2, 3, 4, 5, 6]);
  assert.equal(act(table, 2, { type: 'deal' }, members), null, 'only the host deals from the lobby');
  table = act(table, 3, { type: 'seat', watch: true }, members);
  assert.deepEqual(table.seats, [1, 2, 4, 5, 6, 7]);
  table = act(table, HOST, { type: 'settings', settings: { handSize: 5, turnTimer: 0 } }, members);
  assert.equal(act(table, 2, { type: 'settings', settings: { handSize: 10 } }, members), null);
  table = act(table, HOST, { type: 'deal' }, members);
  assert.ok(isValidTable(table));
  assert.equal(table.phase, 'playing');
  assert.equal(table.seats.length, MAX_PLAYERS);
  assert.ok(table.hands.every((hand) => hand.length === 5));
  assert.ok(isNumber(topCard(table)), 'rounds open on a number card');
  assert.equal(table.color, colorOf(topCard(table)));
  assert.equal(table.current, 1);

  const seen = viewFor(table, 2);
  assert.ok(isValidView(seen, members, 2));
  assert.deepEqual(seen.hand, handOf(table, 2));
  assert.equal('hands' in seen, false);
  assert.equal('drawPile' in seen, false);
  assert.equal(JSON.stringify(seen).includes(JSON.stringify(handOf(table, 4))), false);
  const watcher = viewFor(table, 3);
  assert.equal(watcher.hand, null);
  assert.ok(isValidView(watcher, members, 3));
});

test('cards match by colour or rank, wilds need a colour, and stale clicks are refused', () => {
  const table = playing({ hands: [['r7', 'b3', 'g9', 'w'], ['y1'], ['y2']], discard: ['r3'] });
  assert.deepEqual(faces(choicesFor(table, 1, handOf(table, 1)).playable), ['r7', 'b3', 'w']);
  assert.equal(play(table, 1, 'g9'), null);
  assert.equal(play(table, 1, 'w'), null, 'a wild needs a chosen colour');
  assert.equal(play(table, 1, 'r7', { seq: table.turnSeq - 1 }), null);
  assert.equal(play(table, 2, 'y1'), null, 'not your turn');
  const next = play(table, 1, 'w', { color: 'g' });
  assert.equal(next.color, 'g');
  assert.equal(next.current, 2);
  assert.equal(next.revision, table.revision + 1);
});

test('skips jump a player and reverses flip direction (acting as a skip with two players)', () => {
  let table = playing({ seats: [1, 2, 3, 4], hands: [['rs', 'r1'], ['rr', 'r2'], ['g1'], ['b1']], discard: ['r3'] });
  table = play(table, 1, 'rs');
  assert.equal(table.current, 3);
  table = playing({ seats: [1, 2, 3, 4], hands: [['rr', 'r1'], ['r2'], ['g1'], ['b1']], discard: ['r3'] });
  table = play(table, 1, 'rr');
  assert.equal(table.direction, -1);
  assert.equal(table.current, 4);
  table = playing({ seats: [1, 2], hands: [['rr', 'r1'], ['g2']], discard: ['r3'] });
  table = play(table, 1, 'rr');
  assert.equal(table.current, 1, 'two-player reverse returns the turn');
});

test('without stacking a Draw Two lands immediately and skips the victim', () => {
  const table = play(playing({ hands: [['rd2', 'r1'], ['g5'], ['b5']], discard: ['r3'], settings: { stacking: 'off' } }), 1, 'rd2');
  assert.equal(handOf(table, 2).length, 3);
  assert.equal(table.current, 3);
  assert.equal(table.pendingDraw, 0);
});

test('stacking passes draw penalties along until someone takes them', () => {
  let table = playing({ hands: [['rd2', 'r1'], ['bd2', 'wd4', 'g1'], ['y5', 'y6']], discard: ['r3'] });
  table = play(table, 1, 'rd2');
  assert.equal(table.pendingDraw, 2);
  assert.equal(table.current, 2);
  assert.deepEqual(faces(choicesFor(table, 2, handOf(table, 2)).playable), ['bd2'], '+4 cannot answer +2 in "same" mode');
  table = play(table, 2, 'bd2');
  assert.equal(table.pendingDraw, 4);
  assert.equal(table.current, 3);
  assert.equal(act(table, 3, { type: 'play', card: cardIn(table, 3, 'y5') }), null, 'only a draw card answers a stack');
  table = act(table, 3, { type: 'draw' });
  assert.equal(handOf(table, 3).length, 6);
  assert.equal(table.pendingDraw, 0);
  assert.equal(table.current, 1, 'taking the stack ends your turn');

  let progressive = playing({ hands: [['rd2', 'r1'], ['wd4', 'gd2', 'g1'], ['y5']], discard: ['r3'], settings: { stacking: 'progressive' } });
  progressive = play(progressive, 1, 'rd2');
  assert.deepEqual(faces(choicesFor(progressive, 2, handOf(progressive, 2)).playable).sort(), ['gd2', 'wd4']);
  progressive = play(progressive, 2, 'wd4', { color: 'y' });
  assert.equal(progressive.pendingDraw, 6);
  const afterFour = playing({ hands: [['wd4', 'r1'], ['gd2', 'g1'], ['y5']], discard: ['r3'], settings: { stacking: 'progressive', wildFour: 'anytime' } });
  const four = play(afterFour, 1, 'wd4', { color: 'g' });
  assert.deepEqual(choicesFor(four, 2, handOf(four, 2)).playable, [], 'a +2 never answers a +4');
});

test('Wild Draw Four applies penalties without bluff challenges and retains the strict option', () => {
  const settings = { stacking: 'off' };
  for (const hand of [['wd4', 'r1', 'g2'], ['wd4', 'g2']]) {
    const table = play(playing({ hands: [hand, ['b5', 'b6'], ['y5']], settings }), 1, 'wd4', { color: 'b' });
    assert.equal(table.current, 3);
    assert.equal(table.pendingDraw, 0);
    assert.equal(handOf(table, 2).length, 6);
    assert.equal(table.wd4, null);
    assert.equal(choicesFor(table, 2, handOf(table, 2)).challenge, false);
    assert.equal(act(table, 2, { type: 'challenge' }), null);
  }

  let stacked = playing({ hands: [['wd4', 'g2'], ['wd4', 'b5', 'b6'], ['y5']], discard: ['r3'], settings: { stacking: 'same' } });
  stacked = play(stacked, 1, 'wd4', { color: 'b' });
  stacked = play(stacked, 2, 'wd4', { color: 'y' });
  assert.equal(stacked.pendingDraw, 8);
  assert.equal(act(stacked, 3, { type: 'challenge' }), null);
  const taken = act(stacked, 3, { type: 'draw' });
  assert.equal(handOf(taken, 3).length, 9);

  const strict = playing({ hands: [['wd4', 'r1'], ['b5'], ['y5']], discard: ['r3'], settings: { wildFour: 'strict' } });
  assert.deepEqual(faces(choicesFor(strict, 1, handOf(strict, 1)).playable), ['r1']);
  const anytime = play(playing({ hands: [['wd4', 'r1'], ['b5'], ['y5']], discard: ['r3'], settings: { wildFour: 'anytime', stacking: 'off' } }), 1, 'wd4', { color: 'y' });
  assert.equal(handOf(anytime, 2).length, 5);
  assert.equal(anytime.current, 3);
  assert.equal(choicesFor(anytime, 3, handOf(anytime, 3)).challenge, false);
});

test('legacy snapshots cannot reenable challenges through choices, actions or bots', () => {
  const table = playing({
    seats: [1, -1, 3], hands: [['g2'], ['b5', 'b6'], ['y5']], discard: ['wd4'],
    current: -1, pendingDraw: 4, wd4: { by: 1, bluff: true }, settings: { bots: 1 },
  });
  table.settings.wildFour = 'challenge';
  assert.equal(choicesFor(table, -1, handOf(table, -1)).challenge, false);
  assert.equal(act(table, -1, { type: 'challenge' }), null);
  assert.equal(chooseTurnAction(table, -1, () => 0).type, 'draw');
  const taken = act(table, -1, { type: 'draw' });
  assert.equal(taken.settings.wildFour, 'anytime');
  assert.equal(handOf(taken, -1).length, 6);
  assert.equal(taken.current, 3);
  assert.ok(isValidTable(taken));
});

test('jump-in lets an identical card play out of turn and steals the turn order', () => {
  let table = playing({ seats: [1, 2, 3, 4], hands: [['g7', 'r1'], ['b2'], ['y4'], ['g7', 'g1', 'w']], discard: ['g3'] });
  table = play(table, 1, 'g7');
  assert.equal(table.current, 2);
  assert.deepEqual(faces(choicesFor(table, 4, handOf(table, 4)).jumpIns), ['g7']);
  assert.equal(act(table, 4, { type: 'play', card: cardIn(table, 4, 'g1'), seq: -1 }), null, 'only identical cards can jump in');
  const jumped = act(table, 4, { type: 'play', card: cardIn(table, 4, 'g7'), seq: -1 });
  assert.equal(jumped.current, 1, 'play continues from the jumper');
  assert.equal(jumped.lastPlay.jumpIn, true);
  assert.equal(act(jumped, 2, { type: 'draw', seq: table.turnSeq }), null, 'the skipped player’s stale click is refused');

  const off = play(playing({ hands: [['g7', 'r1'], ['b2'], ['g7']], discard: ['g3'], settings: { jumpIn: false } }), 1, 'g7');
  assert.equal(choicesFor(off, 3, handOf(off, 3)).jumpIns.length, 0);

  let stack = playing({ seats: [1, 2, 3, 4], hands: [['rd2', 'r1'], ['b2'], ['y4'], ['rd2', 'g1']], discard: ['r3'] });
  stack = play(stack, 1, 'rd2');
  stack = act(stack, 4, { type: 'play', card: cardIn(stack, 4, 'rd2'), seq: -1 });
  assert.equal(stack.pendingDraw, 4);
  assert.equal(stack.current, 1, 'a jump-in on a +2 passes the growing stack along');
});

test('a player can jump in on their own identical card before the next play', () => {
  const table = playing({ hands: [['g7', 'g7', 'g1', 'b7'], ['g2', 'b2'], ['y4']], discard: ['g3'] });
  const first = cardIn(table, 1, 'g7');
  const afterOwn = play(table, 1, 'g7');
  const duplicate = cardIn(afterOwn, 1, 'g7');
  assert.deepEqual(choicesFor(afterOwn, 1, handOf(afterOwn, 1)).jumpIns, [duplicate]);
  assert.deepEqual(choicesFor(viewFor(afterOwn, 1), 1, handOf(afterOwn, 1)).playable, [duplicate]);
  assert.equal(play(afterOwn, 1, 'g1'), null, 'matching only colour is insufficient');
  assert.equal(play(afterOwn, 1, 'b7'), null, 'matching only rank is insufficient');
  assert.equal(act(afterOwn, 1, { type: 'play', card: first }), null, 'the first physical card cannot be reused');

  const jumped = play(afterOwn, 1, 'g7', { seq: table.turnSeq });
  assert.ok(isValidTable(jumped));
  assert.deepEqual(faces(handOf(jumped, 1)), ['g1', 'b7']);
  assert.deepEqual(jumped.discard.slice(-2), [first, duplicate]);
  assert.equal(jumped.lastPlay.jumpIn, true);
  assert.equal(jumped.log.at(-1).jump, true);
  assert.equal(jumped.current, 2, 'play continues from the player who jumped in');
  assert.equal(act(jumped, 2, { type: 'draw', seq: afterOwn.turnSeq }), null, 'self jump-in invalidates stale turn actions');

  const movedOn = play(afterOwn, 2, 'g2');
  assert.equal(play(movedOn, 1, 'g7'), null, 'a changed top card closes the opportunity');
  const disabled = { ...afterOwn, settings: { ...afterOwn.settings, jumpIn: false } };
  assert.equal(play(disabled, 1, 'g7'), null, 'self jump-in respects the house rule');
});

test('self jump-ins add identical Draw Twos to the stack and respect stacking settings', () => {
  for (const stacking of ['same', 'progressive', 'off']) {
    const table = playing({ hands: [['rd2', 'rd2', 'r1'], ['b2'], ['y4']], discard: ['r3'], settings: { stacking } });
    const afterOwn = play(table, 1, 'rd2');
    const jumped = play(afterOwn, 1, 'rd2');
    assert.ok(isValidTable(jumped));
    assert.equal(jumped.lastPlay.jumpIn, true);
    assert.deepEqual(faces(handOf(jumped, 1)), ['r1']);
    if (stacking === 'off') {
      assert.equal(jumped.pendingDraw, 0, 'each +2 settles immediately when stacking is disabled');
      assert.equal(handOf(jumped, 2).length, 5);
      assert.equal(jumped.current, 3);
    } else {
      assert.equal(jumped.pendingDraw, 4);
      assert.equal(jumped.current, 2, 'the next player still faces the combined stack');
      const taken = act(jumped, 2, { type: 'draw' });
      assert.equal(handOf(taken, 2).length, 5);
      assert.equal(taken.pendingDraw, 0);
      assert.equal(taken.current, 3);
    }
  }
});

test('7-0 swaps a chosen hand on 7 and passes every hand along on 0', () => {
  const settings = { sevenZero: true };
  let table = playing({ hands: [['r7', 'r1', 'r2'], ['b2'], ['y4', 'y5', 'y6']], discard: ['r3'], settings });
  assert.equal(play(table, 1, 'r7'), null, 'a 7 needs a target');
  assert.equal(play(table, 1, 'r7', { target: 1 }), null);
  table = play(table, 1, 'r7', { target: 2 });
  assert.deepEqual(faces(handOf(table, 1)), ['b2']);
  assert.deepEqual(faces(handOf(table, 2)), ['r1', 'r2']);
  assert.deepEqual(table.called, [1], 'a swap into one card is not a missed call');

  let rotate = playing({ hands: [['r0', 'r1'], ['b2', 'b3'], ['y4', 'y5', 'y6']], discard: ['r3'], settings });
  rotate = play(rotate, 1, 'r0');
  assert.deepEqual(faces(handOf(rotate, 2)), ['r1']);
  assert.deepEqual(faces(handOf(rotate, 3)), ['b2', 'b3']);
  assert.deepEqual(faces(handOf(rotate, 1)), ['y4', 'y5', 'y6']);
});

test('drawing: keep or play the drawn card, forced play, and draw to match', () => {
  let table = playing({ hands: [['g1'], ['b2'], ['y4']], discard: ['r3'], draw: ['r9', 'b1'] });
  table = act(table, 1, { type: 'draw' });
  assert.equal(table.stage, 'drawn');
  assert.equal(FACES[table.drawnCard], 'r9');
  assert.deepEqual(faces(choicesFor(table, 1, handOf(table, 1)).playable), ['r9'], 'only the drawn card may be played');
  assert.equal(act(table, 1, { type: 'draw' }), null);
  const kept = act(table, 1, { type: 'keep' });
  assert.equal(kept.current, 2);
  assert.equal(handOf(kept, 1).length, 2);

  const forced = act(playing({ hands: [['g1'], ['b2'], ['y4']], discard: ['r3'], draw: ['r9'], settings: { forcePlay: true } }), 1, { type: 'draw' });
  assert.equal(choicesFor(forced, 1, handOf(forced, 1)).keep, false);
  assert.equal(act(forced, 1, { type: 'keep' }), null);

  const dud = act(playing({ hands: [['g1'], ['b2'], ['y4']], discard: ['r3'], draw: ['b9'] }), 1, { type: 'draw' });
  assert.equal(dud.current, 2, 'an unplayable draw ends the turn');

  const match = act(playing({ hands: [['g1'], ['b2'], ['y4']], discard: ['r3'], draw: ['b9', 'g8', 'y7', 'r4', 'b1'], settings: { drawToMatch: true } }), 1, { type: 'draw' });
  assert.deepEqual(faces(handOf(match, 1)), ['g1', 'b9', 'g8', 'y7', 'r4']);
  assert.equal(FACES[match.drawnCard], 'r4');
});

test('forgetting to shout “Oh no!” with one card left can be caught for two cards', () => {
  let table = playing({ hands: [['r1', 'r2'], ['b2', 'r5', 'r6'], ['y4', 'y5']], discard: ['r3'] });
  table = play(table, 1, 'r1');
  assert.equal(table.exposed, 1);
  assert.equal(choicesFor(table, 2, handOf(table, 2)).catch, true);
  assert.equal(choicesFor(table, 1, handOf(table, 1)).catch, false);
  const caught = act(table, 3, { type: 'catch' });
  assert.equal(handOf(caught, 1).length, 3);
  assert.equal(caught.exposed, null);
  const escaped = act(table, 1, { type: 'call' });
  assert.deepEqual(escaped.called, [1]);
  assert.equal(act(escaped, 3, { type: 'catch' }), null);
  const moved = play(table, 2, 'r5');
  assert.equal(moved.exposed, null, 'the next play closes the catch window');

  let early = playing({ hands: [['r1', 'r2'], ['b2'], ['y4']], discard: ['r3'] });
  assert.equal(choicesFor(early, 1, handOf(early, 1)).call, true);
  early = act(early, 1, { type: 'call' });
  early = play(early, 1, 'r1');
  assert.equal(early.exposed, null);
  assert.deepEqual(early.called, [1]);

  const relaxed = play(playing({ hands: [['r1', 'r2'], ['b2'], ['y4']], discard: ['r3'], settings: { mustCall: false } }), 1, 'r1');
  assert.equal(relaxed.exposed, null);
  assert.deepEqual(relaxed.called, [1]);
});

test('a call attached to a legal play protects the last card and logs one audible call', () => {
  const table = playing({ hands: [['r1', 'r2'], ['b2'], ['y4']] });
  const next = play(table, 1, 'r1', { call: true });
  assert.deepEqual(next.called, [1]);
  assert.equal(next.exposed, null);
  assert.deepEqual(next.log.map(({ k }) => k), ['play', 'call']);
  assert.equal(act(next, 1, { type: 'call' }), null);
  const alreadyCalled = play(act(table, 1, { type: 'call' }), 1, 'r1', { call: true });
  assert.equal(alreadyCalled.log.filter(({ k }) => k === 'call').length, 1);
  assert.equal(play(table, 1, 'r1', { call: true, seq: 0 }), null, 'an invalid play cannot create a call');
});

test('only the host can return a running table to a clean lobby while preserving the match', () => {
  const table = playing({
    hands: [['r1', 'g2'], ['b5', 'b6'], ['y5']], discard: ['wd4'], pendingDraw: 4,
    current: 2, wd4: { by: 1, bluff: true }, called: [3], exposed: 3,
    scores: { 1: 120, 2: 25, 3: 0 }, lastPlay: { by: 1, card: 107 },
  });
  assert.equal(act(table, 2, { type: 'lobby' }), null);
  const lobby = act(table, 1, { type: 'lobby' });
  assert.equal(lobby.phase, 'lobby');
  assert.deepEqual(lobby.seats, table.seats);
  assert.deepEqual(lobby.scores, table.scores);
  assert.deepEqual(lobby.settings, table.settings);
  for (const key of ['hands', 'drawPile', 'discard', 'called', 'reveal']) assert.deepEqual(lobby[key], [], key);
  for (const key of ['current', 'color', 'drawnCard', 'wd4', 'exposed', 'lastPlay', 'winner']) assert.equal(lobby[key], null, key);
  assert.equal(lobby.pendingDraw, 0);
  assert.equal(lobby.roundPoints, 0);
  assert.ok(lobby.turnSeq > table.turnSeq, 'old turn actions become stale');
  assert.ok(isValidTable(lobby));
  assert.equal(act(lobby, 1, { type: 'lobby' }), null);
  const next = act(lobby, 1, { type: 'deal' });
  assert.equal(next.phase, 'playing');
  assert.deepEqual(next.scores, table.scores);
  assert.ok(isValidTable(next));
});

test('going out scores everyone else’s cards, finishing draws still land, and matches end at the target', () => {
  let table = playing({ hands: [['rd2'], ['b2', 'w'], ['y4', 'gs']], discard: ['r3'], settings: { targetScore: 200 } });
  table.scores = { 1: 150, 2: 10, 3: 0 };
  table = play(table, 1, 'rd2');
  assert.equal(table.phase, 'roundOver');
  assert.equal(table.winner, 1);
  assert.equal(table.reveal.find((entry) => entry.id === 2).cards.length, 4, 'the final +2 still lands');
  const victimPoints = table.reveal.find((entry) => entry.id === 2).points;
  assert.equal(table.roundPoints, victimPoints + 24);
  assert.equal(table.scores[1], 150 + table.roundPoints);
  assert.equal(table.matchWinner, 1);
  assert.ok(isValidTable(table));
  assert.ok(isValidView(viewFor(table, 2), [1, 2, 3], 2));
  assert.equal(act(table, 4, { type: 'deal' }, [1, 2, 3, 4]), null, 'spectators cannot deal the next round');
  const next = act(table, 2, { type: 'deal' }, [1, 2, 3], () => table.nextRoundAt);
  assert.equal(next.round, 1, 'a new match starts at round one');
  assert.deepEqual(next.scores, { 1: 0, 2: 0, 3: 0 });
  assert.equal(next.current, 1);
});

test('next rounds wait exactly three seconds for everyone, including through the lobby', () => {
  const ready = playing({ hands: [['r1'], ['b2'], ['y4']] });
  const won = play(ready, 1, 'r1');
  assert.equal(won.nextRoundAt, 1000 + NEXT_ROUND_DELAY_MS);
  assert.equal(viewFor(won, 2).nextRoundAt, won.nextRoundAt);
  for (const id of [1, 2, 3]) {
    assert.equal(act(won, id, { type: 'deal' }, undefined, () => won.nextRoundAt - 1), null);
    assert.equal(act(won, id, { type: 'deal' }, undefined, () => won.nextRoundAt).phase, 'playing');
  }
  const lobby = act(won, 1, { type: 'lobby' });
  assert.equal(lobby.nextRoundAt, won.nextRoundAt);
  assert.equal(act(lobby, 1, { type: 'deal' }, undefined, () => won.nextRoundAt - 1), null);
  const next = act(lobby, 1, { type: 'deal' }, undefined, () => won.nextRoundAt);
  assert.equal(next.phase, 'playing');
  assert.equal(next.nextRoundAt, null);
  assert.equal(act(applyRoster(createTable(), [1, 2]), 1, { type: 'deal' }, undefined, () => 0).phase, 'playing',
    'a first-ever deal has no delay');
});

test('winning on a forced timeout play starts the cooldown using the coordinator clock', () => {
  const table = playing({ hands: [['r1'], ['b2'], ['y4']], settings: { forcePlay: true } });
  table.stage = 'drawn';
  table.drawnCard = table.hands[0][0];
  const won = expireTurn(table, seeded(1), () => 10000);
  assert.equal(won.phase, 'roundOver');
  assert.equal(won.nextRoundAt, 10000 + NEXT_ROUND_DELAY_MS);
  assert.equal(act(won, 1, { type: 'deal' }, undefined, () => 12999), null);
});

test('old snapshots without a round deadline remain readable, while invalid deadlines are rejected', () => {
  const legacy = applyRoster(createTable(), [1, 2]);
  delete legacy.nextRoundAt;
  assert.ok(isValidTable(legacy));
  assert.equal(viewFor(legacy, 1).nextRoundAt, null);
  assert.equal(act(legacy, 1, { type: 'deal' }, undefined, () => 0).phase, 'playing');
  for (const nextRoundAt of [-1, Infinity, NaN, '3000']) {
    assert.equal(isValidTable({ ...legacy, nextRoundAt }), false);
    assert.equal(isValidView({ ...viewFor(legacy, 1), nextRoundAt }, [1, 2], 1), false);
  }
});

test('an empty draw pile reshuffles the discards under the top card', () => {
  const table = playing({ hands: [['g1'], ['b2'], ['y4']], discard: ['r3', 'r4', 'r5'] });
  const everything = [...table.drawPile];
  table.discard = [...everything.slice(0, -1), ...table.discard];
  table.drawPile = everything.slice(-1);
  assert.ok(isValidTable(table));
  const drawn = act(table, 1, { type: 'draw' });
  const again = act({ ...drawn, current: 2, stage: 'play', drawnCard: null }, 2, { type: 'draw', seq: drawn.turnSeq });
  assert.ok(again.log.some((entry) => entry.k === 'reshuffle'));
  assert.equal(again.discard.length, 1);
  assert.ok(isValidTable(again));
});

test('an expired turn draws for the player, takes stacks, and forces playable draws when required', () => {
  const idle = expireTurn(playing({ hands: [['g1'], ['b2'], ['y4']], discard: ['r3'], draw: ['r9'] }), seeded(1));
  assert.equal(idle.current, 2);
  assert.equal(handOf(idle, 1).length, 2);
  assert.ok(idle.log.some((entry) => entry.k === 'timeout'));

  let stacked = playing({ hands: [['rd2', 'r1'], ['b2'], ['y4']], discard: ['r3'] });
  stacked = expireTurn(play(stacked, 1, 'rd2'), seeded(1));
  assert.equal(handOf(stacked, 2).length, 3);
  assert.equal(stacked.current, 3);

  const forced = expireTurn(playing({ hands: [['g1', 'g2'], ['b2'], ['y4']], discard: ['r3'], draw: ['w'], settings: { forcePlay: true } }), seeded(1));
  assert.equal(FACES[topCard(forced)], 'w');
  assert.equal(forced.color, 'g', 'auto-play picks the colour you hold most');
  assert.equal(forced.current, 2);
});

test('departing players are replaced by a waiting spectator or removed; a lone player returns to the lobby', () => {
  const table = playing({ seats: [1, 2, 3], hands: [['g1', 'g2'], ['b2'], ['y4', 'y5']], discard: ['r3'], current: 2, exposed: 2 });
  const subbed = applyRoster(table, [1, 3, 4]);
  assert.deepEqual(subbed.seats, [1, 4, 3]);
  assert.deepEqual(handOf(subbed, 4), handOf(table, 2));
  assert.equal(subbed.current, 4);
  assert.equal(subbed.exposed, null);
  assert.deepEqual(subbed.called, [4], 'an inherited one-card hand is not a missed call');
  assert.ok(isValidTable(subbed));

  const removed = applyRoster(table, [1, 3]);
  assert.deepEqual(removed.seats, [1, 3]);
  assert.equal(removed.current, 3);
  assert.ok(isValidTable(removed));

  const alone = applyRoster(table, [1]);
  assert.equal(alone.phase, 'lobby');
  assert.ok(isValidTable(alone));
  assert.equal(applyRoster(alone, [1]), alone, 'an unchanged roster returns the same table');
  assert.equal(abandonRound(table).phase, 'lobby');
});

test('log event IDs survive host recovery independently of card counts', () => {
  const table = playing({ hands: [['b1', 'g2'], ['b2', 'g3'], ['b3', 'g4']], draw: ['r4'] });
  table.logSeq = 50;
  const drawn = applyAction(table, 1, { type: 'draw', seq: table.turnSeq });
  assert.equal(drawn.log.at(-1).n, 1);
  assert.equal(drawn.log.at(-1).seq, 51);
  const view = viewFor(drawn, 1);
  const reports = new Map(drawn.seats.map((id) => [id, viewFor(drawn, id)]));
  const rebuilt = rebuildTable(view, reports, seeded(3));
  assert.equal(rebuilt.logSeq, 52);
  assert.equal(rebuilt.log.at(-1).seq, 52);
  assert.ok(isValidTable(rebuilt));

  // Old snapshots remain readable while their coordinator is being upgraded.
  for (const entry of view.log) delete entry.seq;
  assert.ok(isValidTable(rebuildTable(view, reports, seeded(3))));
});

test('a table can be rebuilt from one player’s view and the hands everyone reports', () => {
  const table = playing({ seats: [1, 2, 3], hands: [['g1', 'g2'], ['b2', 'b3', 'w'], ['y4']], discard: ['r9', 'r3'] });
  const view = viewFor(table, 2);
  const honest = new Map([[1, { hand: handOf(table, 1) }], [2, { hand: handOf(table, 2) }], [3, { hand: handOf(table, 3) }]]);
  const exact = rebuildTable(view, honest, seeded(3));
  assert.deepEqual(exact.hands, table.hands);
  assert.deepEqual([...exact.drawPile].sort((a, b) => a - b), [...table.drawPile].sort((a, b) => a - b));

  // Player 1 claims one of player 3's cards; neither claim can be trusted.
  const reports = new Map([[2, { hand: handOf(table, 2) }], [3, { hand: handOf(table, 3) }], [1, { hand: [handOf(table, 3)[0], handOf(table, 1)[0]] }]]);
  const rebuilt = rebuildTable(view, reports, seeded(3));
  assert.ok(isValidTable(rebuilt));
  assert.deepEqual(handOf(rebuilt, 2), handOf(table, 2));
  assert.equal(handOf(rebuilt, 1).length, 2, 'a conflicting claim is re-dealt at the same size');
  assert.equal(handOf(rebuilt, 3).length, 1);
  assert.equal(handOf(rebuilt, 1).includes(handOf(table, 3)[0]) && handOf(rebuilt, 3).includes(handOf(table, 3)[0]), false);
  assert.equal(rebuilt.revision, table.revision + 1);
  assert.equal(rebuilt.current, table.current);
  assert.ok(rebuilt.log.at(-1).k === 'recover');

  // Pending +4 stacks survive host recovery without creating a challenge.
  let hit = playing({ hands: [['wd4', 'r1', 'g2'], ['b5', 'b6'], ['y5']], discard: ['r3'], settings: { stacking: 'same' } });
  hit = play(hit, 1, 'wd4', { color: 'b' });
  assert.equal(choicesFor(hit, 2, handOf(hit, 2)).challenge, false);
  const recovered = rebuildTable(viewFor(hit, 2), new Map([[2, { hand: handOf(hit, 2) }]]), seeded(5));
  assert.ok(isValidTable(recovered));
  assert.equal(recovered.pendingDraw, 4);
  assert.deepEqual(choicesFor(recovered, 2, handOf(recovered, 2)), { ...choicesFor(recovered, 2, handOf(recovered, 2)), challenge: false, draw: true });
});

test('computer players fill free seats, give them up to people, and play by the same rules', () => {
  assert.deepEqual(BOT_NAMES.map((_, index) => botName(-(index + 1))), BOT_NAMES);
  assert.equal(isBotId(-1) && isBotId(-5) && !isBotId(-6) && !isBotId(1), true);

  // A lone person can play against bots.
  let table = applyRoster(createTable({ settings: { bots: 2 } }), [1]);
  assert.deepEqual(table.seats, [1, -1, -2]);
  assert.equal(act(table, 2, { type: 'settings', settings: { bots: 5 } }, [1, 2]), null, 'only the host adds bots');
  assert.equal(act(table, -1, { type: 'deal' }, [1]), null, 'bots cannot deal');

  // People always come first: arrivals bump the last bots, departures bring them back.
  table = act(table, HOST, { type: 'settings', settings: { bots: 5 } }, [1]);
  assert.deepEqual(table.seats, [1, -1, -2, -3, -4, -5]);
  table = applyRoster(table, [1, 2, 3]);
  assert.deepEqual(table.seats, [1, -1, -2, -3, 2, 3]);
  table = applyRoster(table, [1]);
  assert.deepEqual(table.seats, [1, -1, -2, -3, -4, -5]);
  table = act(table, HOST, { type: 'seat', watch: true }, [1]);
  assert.deepEqual(table.seats, [-1, -2, -3, -4, -5], 'the host can sit out and watch the bots');

  // Bots act through the rules engine like anyone else, and never leave mid-round.
  let duel = playing({ seats: [1, -1, -2], hands: [['g1'], ['r5', 'b2'], ['y4']], discard: ['r3'], settings: { bots: 2 }, current: -1 });
  duel = act(duel, -1, { type: 'play', card: cardIn(duel, -1, 'r5') });
  assert.equal(duel.current, -2);
  assert.deepEqual(applyRoster(duel, [1]).seats, [1, -1, -2]);
  assert.equal(act(duel, HOST, { type: 'settings', settings: { bots: 3 } }, [1]), null, 'no new bots mid-round');
  const view = viewFor(duel, 1);
  assert.ok(isValidView(view, [1], 1));
  assert.equal(isValidTable({ ...duel, settings: { ...duel.settings, bots: 1 } }), false, 'no seat for a bot the host never added');
  assert.equal(isValidView({ ...view, settings: { ...view.settings, bots: 1 } }, [1], 1), false);
});

test('validators reject malformed tables and views', () => {
  const table = playing({ hands: [['g1'], ['b2', 'b5'], ['y4']], discard: ['r3'] });
  for (const broken of [null, {}, { ...table, phase: 'nope' }, { ...table, drawPile: table.drawPile.slice(1) },
    { ...table, current: 99 }, { ...table, settings: { ...table.settings, turnTimer: 601 } },
    { ...table, hands: [[...table.hands[0], table.drawPile[0]], table.hands[1], table.hands[2]] },
    { ...table, scores: { abc: 1 } }, { ...table, stage: 'drawn' }]) {
    assert.equal(isValidTable(broken), false);
  }
  const view = viewFor(table, 2);
  assert.ok(isValidView(view, [1, 2, 3], 2));
  for (const [broken, members] of [[{ ...view, hand: [...view.hand, 0] }, [1, 2, 3]], [view, [1, 3]],
    [{ ...view, counts: [1, 1] }, [1, 2, 3]], [{ ...view, drawCount: 999 }, [1, 2, 3]], [{ ...view, discard: [] }, [1, 2, 3]]]) {
    assert.equal(isValidView(broken, members, 2), false);
  }
  assert.equal(isValidView(view, [1, 2, 3], 3), false, 'a view belongs to the seat it was made for');
});

// ---------------------------------------------------------------------------
// Randomized play: every rule combination, every step checked for conservation.
// ---------------------------------------------------------------------------

function randomSettings(random) {
  const pick = (options) => options[Math.floor(random() * options.length)];
  return normalizeSettings({
    bots: pick([0, 0, 1, 2, 3]),
    stacking: pick(['off', 'same', 'progressive']),
    jumpIn: random() < 0.6,
    sevenZero: random() < 0.5,
    drawToMatch: random() < 0.3,
    forcePlay: random() < 0.3,
    wildFour: pick(['anytime', 'strict']),
    mustCall: random() < 0.7,
    handSize: pick([5, 7, 10]),
    targetScore: pick([0, 200]),
    turnTimer: 0,
  });
}

function randomAction(table, id, random) {
  const seat = table.seats.indexOf(id);
  const hand = seat >= 0 ? table.hands[seat] : null;
  const choices = choicesFor(table, id, hand);
  const options = [];
  for (const card of choices.playable) {
    const target = table.seats.filter((other) => other !== id)[Math.floor(random() * (table.seats.length - 1))];
    options.push({ type: 'play', card, color: COLORS[Math.floor(random() * 4)], target, seq: choices.jumpIns.includes(card) ? -1 : table.turnSeq });
  }
  // Like people, the random players usually play a card when they can.
  if (options.length && random() < 0.8) return options[Math.floor(random() * options.length)];
  if (choices.draw) options.push({ type: 'draw', seq: table.turnSeq });
  if (choices.keep) options.push({ type: 'keep', seq: table.turnSeq });
  if (choices.challenge) options.push({ type: 'challenge', seq: table.turnSeq });
  if (choices.call) options.push({ type: 'call' });
  if (choices.catch) options.push({ type: 'catch' });
  return options.length ? options[Math.floor(random() * options.length)] : null;
}

function assertCanMove(table, label) {
  if (table.phase !== 'playing') return;
  const choices = choicesFor(table, table.current, table.hands[table.seats.indexOf(table.current)]);
  assert.ok(choices.draw || choices.keep || choices.challenge || choices.playable.some((card) => !choices.jumpIns.includes(card)),
    `the player on turn always has a move (${label})`);
}

test('hundreds of random games conserve every card and always stay valid', () => {
  const random = seeded(2026);
  let rounds = 0;
  for (let game = 0; game < 150; game += 1) {
    let members = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => index + 1);
    const settings = randomSettings(random);
    // Someone alone needs at least one computer player to deal.
    if (members.length === 1 && settings.bots === 0) settings.bots = 1;
    let table = applyRoster(createTable({ settings }), members, random);
    table = applyAction(table, HOST, { type: 'deal' }, { hostId: HOST, memberIds: members, random });
    for (let stepCount = 0; stepCount < 2500 && table.phase === 'playing'; stepCount += 1) {
      const roll = random();
      let next = null;
      if (roll < 0.02) next = expireTurn(table, random);
      else if (roll < 0.025 && members.length > 2) {
        members = members.filter((id) => id !== members[1 + Math.floor(random() * (members.length - 1))]);
        next = applyRoster(table, members, random);
      } else if (roll < 0.03 && members.length < 7) {
        members = [...members, Math.max(...members) + 1];
        next = applyRoster(table, members, random);
      } else {
        // Usually the player on turn acts; sometimes anyone tries anything.
        const actor = roll < 0.85 ? table.current : members[Math.floor(random() * members.length)];
        // Computer players mostly use the real bot logic, which must only ever choose legal moves.
        const action = isBotId(actor) && random() < 0.7 ? chooseTurnAction(table, actor, random) : randomAction(table, actor, random);
        if (action) {
          next = applyAction(table, actor, action, { hostId: HOST, memberIds: members, random });
          assert.notEqual(next, null, `a legal ${action.type} must apply (game ${game}, step ${stepCount})`);
        }
      }
      if (next) table = next;
      assert.ok(isValidTable(table), `table valid after step ${stepCount} of game ${game}`);
      assertCanMove(table, `game ${game}, step ${stepCount}`);
      for (const id of [...members, ...table.seats.filter(isBotId)]) {
        assert.ok(isValidView(viewFor(table, id), members, id), `view for ${id} valid`);
      }
    }
    assert.notEqual(table.phase, 'playing', `game ${game} finished`);
    if (table.phase === 'roundOver') rounds += 1;
  }
  assert.ok(rounds > 100, `most random games reach a winner (${rounds})`);
});

test('rounds rotate the first player and keep scores between rounds', () => {
  const members = [1, 2, 3];
  const first = applyAction(applyRoster(createTable(), members), HOST, { type: 'deal' }, { hostId: HOST, memberIds: members, random: seeded(4) });
  assert.equal(first.current, 1);
  const lonely = playing({ hands: [['r1'], ['b2'], ['y4']], discard: ['r3'] });
  const won = play(lonely, 1, 'r1');
  const second = act(won, 1, { type: 'deal' }, members, () => won.nextRoundAt);
  assert.equal(second.round, 2);
  assert.equal(second.current, 2);
  assert.equal(second.scores[1], won.scores[1]);
  assert.equal(rankOf(topCard(second)).length, 1);
});
