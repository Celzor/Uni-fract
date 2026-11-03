import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLORS, DARK_COLORS, DECK_SIZE, FACES, LIGHT_FACES, DARK_FACES, REVERSE_DECK_SIZE,
  cardSide, colorOf, deckFor, deckSize, faceOf, flipCard, isWild, points, rankOf,
} from '../src/cards.js';
import {
  applyAction, applyRoster, createTable, expireTurn, isValidTable, isValidView,
  migrateSnapshot, normalizeSettings, playCheck, rebuildTable, topCard, viewFor,
} from '../src/rules.js';
import { chooseTurnAction, playAction } from '../src/bots.js';
import { seeded } from './helpers.js';

function fixture({ side = 'light', hands, discard = [side === 'dark' ? 'p3' : 'r3'], draw = [], settings = {}, ...rest }) {
  const deck = deckFor('reverse', side);
  const used = new Set();
  const take = (face) => {
    const card = deck.find((id) => !used.has(id) && (typeof face === 'number' ? id === face : faceOf(id) === face));
    assert.notEqual(card, undefined, `spare ${face}`);
    used.add(card);
    return card;
  };
  const handIds = hands.map((cards) => cards.map(take));
  const discardIds = discard.map(take);
  const drawIds = draw.map(take);
  const table = createTable({ settings: { gameMode: 'reverse', turnTimer: 0, ...settings } });
  Object.assign(table, {
    phase: 'playing', round: 1, side, seats: hands.map((_, index) => index + 1),
    hands: handIds, discard: discardIds, drawPile: [...deck.filter((id) => !used.has(id)), ...drawIds.reverse()],
    color: colorOf(discardIds.at(-1)) ?? (side === 'dark' ? 'p' : 'r'), current: 1,
    turnSeq: 1, turnNo: 1, ...rest,
  });
  assert.ok(isValidTable(table), 'valid fixture');
  return table;
}

function play(table, face, extra = {}) {
  const id = table.current;
  const card = table.hands[table.seats.indexOf(id)].find((value) => faceOf(value) === face);
  assert.notEqual(card, undefined);
  return applyAction(table, id, { type: 'play', card, seq: table.turnSeq, ...extra });
}

test('Reverse has 112 physical double-sided cards with fixed bijective pairings and side-specific scores', () => {
  assert.equal(FACES.length, 108);
  assert.equal(DECK_SIZE, 108);
  assert.equal(REVERSE_DECK_SIZE, 112);
  assert.equal(deckSize('reverse'), 112);
  for (const [side, colors, faces, actions, wilds] of [
    ['light', COLORS, LIGHT_FACES, ['d1', 'r', 's', 'f'], ['w', 'wd2']],
    ['dark', DARK_COLORS, DARK_FACES, ['d5', 'r', 'sa', 'f'], ['dw', 'dwc']],
  ]) {
    assert.equal(faces.length, 112);
    const deck = deckFor('reverse', side);
    assert.equal(new Set(deck).size, 112);
    assert.ok(deck.every((card) => cardSide(card) === side && flipCard(flipCard(card)) === card));
    for (const color of colors) {
      for (const rank of ['1', '2', '3', '4', '5', '6', '7', '8', '9', ...actions]) {
        assert.equal(faces.filter((face) => face === color + rank).length, 2);
      }
    }
    for (const face of wilds) assert.equal(faces.filter((value) => value === face).length, 4);
  }
  const expected = { '1': 1, '9': 9, d1: 10, d5: 20, r: 20, s: 20, sa: 30, f: 20, w: 40, wd2: 50, wdc: 60 };
  for (const card of [...deckFor('reverse'), ...deckFor('reverse', 'dark')]) {
    if (rankOf(card) in expected) assert.equal(points(card), expected[rankOf(card)]);
  }
  assert.equal(points(FACES.indexOf('w')), 50, 'classic scoring stays unchanged');
  assert.ok(LIGHT_FACES.some((_, index) => isWild(108 + index) !== isWild(flipCard(108 + index))));
});

test('mode settings constrain incompatible house rules and migrate old classic saves', () => {
  const settings = normalizeSettings({ gameMode: 'reverse', stacking: 'progressive', jumpIn: true, sevenZero: true, wildFour: 'anytime', drawToMatch: true });
  assert.equal(settings.stacking, 'off');
  assert.equal(settings.jumpIn, false);
  assert.equal(settings.sevenZero, false);
  assert.equal(settings.wildFour, 'strict');
  assert.equal(settings.drawToMatch, true);
  const old = createTable();
  delete old.settings.gameMode;
  delete old.side;
  const migrated = migrateSnapshot(old);
  assert.equal(migrated.settings.gameMode, 'classic');
  assert.equal(migrated.side, 'light');
  assert.ok(isValidTable(old));
  const switched = applyAction(applyRoster(old, [1, 2]), 1, { type: 'settings', settings: { gameMode: 'reverse' } }, { hostId: 1, memberIds: [1, 2] });
  const dealt = applyAction(switched, 1, { type: 'deal' }, { hostId: 1, memberIds: [1, 2], random: seeded(1) });
  assert.ok(isValidTable(dealt));
  assert.equal(dealt.side, 'light');
  assert.equal(dealt.hands.flat().length + dealt.drawPile.length + dealt.discard.length, 112);
});

test('Flip turns every hand and reverses both piles, taking the exposed opposite colour', () => {
  const table = fixture({ hands: [['rf', 'b2'], ['g5'], ['y7']], discard: ['y1', 'b3', 'r3'] });
  const card = table.hands[0][0];
  const next = play(table, 'rf');
  assert.ok(next);
  assert.equal(next.side, 'dark');
  assert.deepEqual(next.hands, [[flipCard(table.hands[0][1])], table.hands[1].map(flipCard), table.hands[2].map(flipCard)]);
  assert.deepEqual(next.drawPile, [...table.drawPile].reverse().map(flipCard));
  assert.deepEqual(next.discard, [...table.discard, card].reverse().map(flipCard));
  assert.equal(next.color, colorOf(topCard(next)));
  assert.equal(next.current, 2);
  assert.ok(isValidTable(next));
  assert.equal(next.log.at(-1).k, 'flip');
  assert.equal(table.side, 'light', 'transition does not mutate the old table');
});

test('Flip exposing a wild requires an opposite-palette choice, including bot and timeout plays', () => {
  const bottom = deckFor('reverse').find((card) => isWild(flipCard(card)) && faceOf(card) !== 'rf');
  const table = fixture({ hands: [['rf', 'b2'], ['g5'], ['y7']], discard: [bottom, 'r3'] });
  assert.equal(play(table, 'rf'), null);
  assert.equal(play(table, 'rf', { color: 'r' }), null);
  const next = play(table, 'rf', { color: 't' });
  assert.equal(next.color, 't');
  assert.ok(isValidTable(next));
  const view = viewFor(table, 1);
  assert.equal(view.flipTop, flipCard(bottom));
  const action = playAction(view, 1, table.hands[0][0], seeded(2));
  assert.ok(DARK_COLORS.includes(action.color));
  assert.ok(applyAction(table, 1, action));
  const drawn = { ...table, settings: { ...table.settings, forcePlay: true }, stage: 'drawn', drawnCard: table.hands[0][0] };
  assert.equal(expireTurn(drawn, seeded(3)).side, 'dark');
  const final = fixture({ hands: [['rf'], ['g5'], ['y7']], discard: [bottom, 'r3'] });
  const finished = play(final, 'rf', { color: 'v' });
  assert.equal(finished.phase, 'roundOver');
  assert.equal(finished.color, 'v');
  assert.equal(finished.side, 'dark');
  assert.ok(isValidTable(finished));
});

test('Reverse actions apply Draw One, Draw Five, strict Wild Draw Two, Reverse and Skip Everyone', () => {
  for (const [side, face, amount, rest] of [
    ['light', 'rd1', 1, 'b2'], ['dark', 'pd5', 5, 't2'], ['light', 'wd2', 2, 'b2'],
  ]) {
    const table = fixture({ side, hands: [[face, rest], [side === 'dark' ? 'o5' : 'g5'], [side === 'dark' ? 'v7' : 'y7']] });
    const next = play(table, face, { color: 'g' });
    assert.equal(next.hands[1].length, 1 + amount);
    assert.equal(next.current, 3);
    assert.equal(next.pendingDraw, 0);
    assert.ok(isValidTable(next));
  }
  for (const [side, face, matching, other] of [['light', 'wd2', 'r1', 'b3'], ['dark', 'dwc', 'p1', 't3']]) {
    const blocked = fixture({ side, hands: [[face, matching], [other], [side === 'dark' ? 'v7' : 'y7']] });
    assert.equal(playCheck(blocked, 1, blocked.hands[0], blocked.hands[0][0]), null);
    const allowed = fixture({ side, hands: [[face, other], [matching], [side === 'dark' ? 'v7' : 'y7']] });
    assert.ok(playCheck(allowed, 1, allowed.hands[0], allowed.hands[0][0]), 'matching number of another colour does not block wild draw');
  }
  const skip = play(fixture({ side: 'dark', hands: [['psa', 't2'], ['o1'], ['v1']] }), 'psa');
  assert.equal(skip.current, 1);
  assert.equal(skip.turnNo, 2);
  const reverse = play(fixture({ side: 'dark', hands: [['pr', 't2'], ['o1'], ['v1']] }), 'pr');
  assert.equal(reverse.direction, -1);
  assert.equal(reverse.current, 3);
});

test('Wild Draw Colour ignores wilds, draws to the selected exact colour, then skips', () => {
  const table = fixture({ side: 'dark', hands: [['dwc', 't2'], ['o1'], ['v1']], draw: ['dw', 't5', 'p2'] });
  const next = play(table, 'dwc', { color: 'p' });
  assert.deepEqual(next.hands[1].map(faceOf), ['o1', 'dw', 't5', 'p2']);
  assert.equal(next.current, 3);
  assert.equal(next.color, 'p');
  assert.equal(next.log.at(-1).n, 3);
  assert.ok(isValidTable(next));
});

test('Wild Draw Colour safely exhausts the deck when the chosen colour is all in hands', () => {
  const pink = deckFor('reverse', 'dark').filter((card) => colorOf(card) === 'p');
  const table = fixture({ side: 'dark', hands: [['dwc', 'v1'], ['t1'], pink], discard: ['t3'] });
  const expectedDraw = table.drawPile.length + 1;
  const next = play(table, 'dwc', { color: 'p' });
  assert.equal(next.hands[1].length, 1 + expectedDraw);
  assert.equal(next.drawPile.length, 0);
  assert.equal(next.discard.length, 1);
  assert.equal(next.current, 3);
  assert.ok(isValidTable(next));
});

test('drawing a strict wild cannot bypass its same-colour restriction or forced-play checks', () => {
  for (const [side, hand, draw] of [['light', ['r1', 'b2'], 'wd2'], ['dark', ['p1', 't2'], 'dwc']]) {
    const table = fixture({ side, hands: [hand, [side === 'dark' ? 'o1' : 'g1'], [side === 'dark' ? 'v1' : 'y1']], draw: [draw], settings: { forcePlay: true } });
    const next = applyAction(table, 1, { type: 'draw', seq: table.turnSeq });
    assert.equal(next.current, 2);
    assert.equal(next.stage, 'play');
    assert.equal(next.hands[0].length, 3);
    assert.equal(faceOf(topCard(next)), side === 'dark' ? 'p3' : 'r3');
    const expired = expireTurn(table, seeded(1));
    assert.equal(expired.current, 2);
    assert.equal(expired.hands[0].length, 3);
    assert.ok(isValidTable(expired));
  }
});

test('final Flip scores the newly active side; final Wild Draw Colour scores all penalty cards', () => {
  const table = fixture({ hands: [['rf'], ['g5'], ['y7']], discard: ['y1', 'r3'] });
  const next = play(table, 'rf');
  assert.equal(next.phase, 'roundOver');
  assert.equal(next.side, 'dark');
  assert.equal(next.roundPoints, points(flipCard(table.hands[1][0])) + points(flipCard(table.hands[2][0])));
  assert.ok(isValidTable(next));
  const fresh = applyAction(next, 1, { type: 'deal' }, { hostId: 1, memberIds: [1, 2, 3], now: () => next.nextRoundAt });
  assert.equal(fresh.side, 'light');
  assert.ok(isValidTable(fresh));
  const penalty = fixture({ side: 'dark', hands: [['dwc'], ['o1'], ['v1']], draw: ['dw', 't5', 'p2'] });
  const finish = play(penalty, 'dwc', { color: 'p' });
  assert.equal(finish.roundPoints, 1 + 40 + 5 + 2 + 1);
  assert.equal(finish.reveal[1].cards.length, 4);
  assert.ok(isValidTable(finish));
});

test('switching mode after a dark-side win clears old faces but keeps scores and the next-round cooldown', () => {
  const won = play(fixture({ side: 'dark', hands: [['p3'], ['o1'], ['v1']], discard: ['p5'] }), 'p3');
  const switched = applyAction(won, 1, { type: 'settings', settings: { gameMode: 'classic' } }, { hostId: 1 });
  assert.equal(switched.phase, 'lobby');
  assert.equal(switched.side, 'light');
  assert.equal(switched.round, won.round);
  assert.deepEqual(switched.scores, won.scores);
  assert.equal(switched.nextRoundAt, won.nextRoundAt);
  assert.deepEqual(switched.discard, []);
  assert.deepEqual(switched.reveal, []);
  assert.ok(isValidTable(switched));
  assert.ok(isValidView(viewFor(switched, 1), [1, 2, 3], 1));
  assert.equal(applyAction(switched, 1, { type: 'deal' }, { hostId: 1, now: () => won.nextRoundAt - 1 }), null);
  const fresh = applyAction(switched, 1, { type: 'deal' }, { hostId: 1, now: () => won.nextRoundAt });
  assert.ok(isValidTable(fresh));
  assert.ok(fresh.hands.flat().every((card) => card < DECK_SIZE));
});

test('reverse views expose card backs and full discard; recovery preserves flipped hands and pile order', () => {
  const table = fixture({ side: 'dark', hands: [['pf', 't2'], ['o1'], ['v1']], discard: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 'p3'] });
  const view = viewFor(table, 1);
  assert.equal(view.discard.length, 8);
  assert.deepEqual(view.opponentFaces, [{ id: 2, cards: table.hands[1].map(flipCard) }, { id: 3, cards: table.hands[2].map(flipCard) }]);
  assert.equal(view.drawBack, flipCard(table.drawPile.at(-1)));
  for (const id of [1, 2, 3, 99]) assert.ok(isValidView(viewFor(table, id), [1, 2, 3, 99], id));
  const reports = new Map(table.seats.map((id, index) => [id, { hand: table.hands[index] }]));
  const rebuilt = rebuildTable(view, reports, seeded(3));
  assert.deepEqual(rebuilt.hands, table.hands);
  assert.deepEqual(rebuilt.discard, table.discard);
  assert.equal(rebuilt.side, 'dark');
  assert.ok(isValidTable(rebuilt));
  const next = play(rebuilt, 'pf');
  assert.equal(topCard(next), flipCard(table.discard[0]));
  assert.ok(isValidTable(next));
  assert.equal(isValidTable({ ...table, side: 'light' }), false);
  assert.equal(isValidView({ ...view, drawBack: table.drawPile.at(-1) }, null, 1), false);
  assert.equal(isValidView({ ...view, flipTop: flipCard(table.discard.at(-1)) }, null, 1), false);
  assert.equal(isValidTable({ ...table, hands: [[0, ...table.hands[0].slice(1)], ...table.hands.slice(1)] }), false);
});

test('Reverse recovery preserves missing players and bots from printed backs despite stale reports', () => {
  for (const side of ['light', 'dark']) {
    const hands = side === 'light' ? [['rf', 'b2'], ['g1', 'g2'], ['y1', 'y2']] : [['pf', 't2'], ['o1', 'o2'], ['v1', 'v2']];
    const table = fixture({ side, hands, seats: [1, 2, -1], settings: { bots: 1 } });
    const view = viewFor(table, 1);
    for (const stale of [undefined, table.hands[1].map(flipCard), table.hands[1].slice(1), table.hands[2]]) {
      const reports = new Map([[1, { hand: table.hands[0] }]]);
      if (stale) reports.set(2, { hand: stale });
      const rebuilt = rebuildTable(view, reports, seeded(7));
      assert.deepEqual(rebuilt.hands, table.hands, `${side}: visible backs preserve both the absent peer and bot`);
      assert.ok(isValidTable(rebuilt));
    }
    const duplicate = structuredClone(view);
    duplicate.opponentFaces[0].cards[0] = flipCard(table.hands[0][0]);
    const repaired = rebuildTable(duplicate, new Map([[1, { hand: table.hands[0] }]]), seeded(8));
    assert.ok(isValidTable(repaired), 'conflicting public and reported claims cannot duplicate a physical card');
    assert.deepEqual(repaired.hands[2], table.hands[2], 'an unaffected bot retains its exact cards');
    const wrongSide = structuredClone(view);
    wrongSide.opponentFaces[0].cards = table.hands[1];
    const repairedSide = rebuildTable(wrongSide, new Map([[1, { hand: table.hands[0] }]]), seeded(9));
    assert.ok(isValidTable(repairedSide), 'malformed same-side backs are rejected');
  }
});

test('bots finish seeded Reverse rounds while conserving physical cards through flips and recovery', () => {
  let flips = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const random = seeded(seed);
    let table = applyRoster(createTable({ settings: { gameMode: 'reverse', turnTimer: 0, drawToMatch: seed % 2 === 0, forcePlay: seed % 3 === 0 } }), [1, 2, 3]);
    table = applyAction(table, 1, { type: 'deal' }, { hostId: 1, memberIds: [1, 2, 3], random });
    for (let turn = 0; turn < 3000 && table.phase === 'playing'; turn += 1) {
      const side = table.side;
      const action = chooseTurnAction(table, table.current, random);
      assert.ok(action);
      const next = applyAction(table, table.current, { ...action, call: true }, { random });
      assert.ok(next, `legal bot action on seed ${seed}, turn ${turn}`);
      table = next;
      if (side !== table.side) flips += 1;
      assert.ok(isValidTable(table), `valid table on seed ${seed}, turn ${turn}`);
      for (const id of table.seats) assert.ok(isValidView(viewFor(table, id), table.seats, id));
      if (turn === 20 && table.phase === 'playing') {
        const reports = new Map(table.seats.map((id, index) => [id, { hand: table.hands[index], drawnCard: id === table.current ? table.drawnCard : null }]));
        table = rebuildTable(viewFor(table, 1), reports, random);
        assert.ok(isValidTable(table));
      }
    }
    assert.equal(table.phase, 'roundOver', `seed ${seed} finishes`);
  }
  assert.ok(flips > 20, 'rounds exercised both sides repeatedly');
});
