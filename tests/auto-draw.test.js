import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_DRAW_CATCH_GRACE_MS, AUTO_DRAW_DELAY_MS, createAutoDrawDriver } from '../src/auto-draw.js';
import { applyAction, createTable, isValidTable } from '../src/rules.js';
import { faces, fakeTimers, playing } from './helpers.js';

function driverFor(initial, timers = fakeTimers()) {
  let table = initial;
  const moves = [];
  const driver = createAutoDrawDriver({
    getTable: () => table,
    timers,
    act(id, action) {
      moves.push({ id, action });
      table = applyAction(table, id, action);
      assert.ok(isValidTable(table));
      driver.schedule();
    },
  });
  return {
    driver, timers, moves,
    get table() { return table; },
    set table(next) { table = next; },
  };
}

test('a stuck human draws after a visible pause, then keeps control of a playable drawn card', () => {
  const h = driverFor(playing({ hands: [['b1', 'g2'], ['r5'], ['y6']], draw: ['r8'] }));
  h.driver.schedule();
  h.timers.advance(AUTO_DRAW_DELAY_MS - 1);
  assert.equal(h.moves.length, 0);
  h.timers.advance(1);
  assert.deepEqual(h.moves, [{ id: 1, action: { type: 'draw', seq: 1 } }]);
  assert.deepEqual(faces(h.table.hands[0]), ['b1', 'g2', 'r8']);
  assert.equal(h.table.stage, 'drawn');
  h.timers.advance(AUTO_DRAW_DELAY_MS * 3);
  assert.equal(h.moves.length, 1, 'the player still chooses to play or keep');
});

test('automatic draws respect draw-to-match and pass an unplayable single draw', () => {
  for (const drawToMatch of [false, true]) {
    const h = driverFor(playing({
      hands: [['b1', 'g2'], ['r5'], ['y6']], draw: ['y8', 'r8'], settings: { drawToMatch },
    }));
    h.driver.schedule();
    h.timers.advance(AUTO_DRAW_DELAY_MS);
    assert.deepEqual(faces(h.table.hands[0]), drawToMatch ? ['b1', 'g2', 'y8', 'r8'] : ['b1', 'g2', 'y8']);
    assert.equal(h.table.current, drawToMatch ? 1 : 2);
    assert.equal(h.table.stage, drawToMatch ? 'drawn' : 'play');
  }
});

test('an unanswered draw stack is taken in full, including unchallengeable +4s', () => {
  for (const [top, amount] of [['rd2', 6], ['wd4', 8]]) {
    const h = driverFor(playing({
      hands: [['b1', 'g2'], ['r5'], ['y6']], discard: [top], pendingDraw: amount,
      settings: { wildFour: 'anytime' },
    }));
    h.driver.schedule();
    h.timers.advance(AUTO_DRAW_DELAY_MS);
    assert.equal(h.table.hands[0].length, 2 + amount);
    assert.equal(h.table.current, 2);
    assert.equal(h.table.pendingDraw, 0);
    assert.deepEqual(h.table.log.at(-1), { k: 'take', by: 1, n: amount, seq: 1 });
  }
});

test('playable cards, stack responses, bots and resting tables do not auto-draw', () => {
  const tables = [
    playing({ hands: [['r1', 'g2'], ['r5'], ['y6']] }),
    playing({ hands: [['bd2', 'g2'], ['r5'], ['y6']], discard: ['rd2'], pendingDraw: 2 }),
    playing({ seats: [-1, 2, 3], hands: [['b1', 'g2'], ['r5'], ['y6']], settings: { bots: 1 } }),
    createTable(),
    { ...createTable(), phase: 'roundOver' },
    null,
  ];
  for (const table of tables) {
    const h = driverFor(table);
    h.driver.schedule();
    h.timers.advance(AUTO_DRAW_DELAY_MS * 3);
    assert.equal(h.moves.length, 0);
    assert.equal(h.timers.pending, 0);
  }
});

test('legacy +4 metadata cannot stop an automatic penalty draw', () => {
  const table = playing({
    hands: [['b1', 'g2'], ['r5'], ['y6']], discard: ['wd4'], pendingDraw: 4, wd4: { by: 3, bluff: false },
  });
  table.settings.wildFour = 'challenge';
  const h = driverFor(table);
  h.driver.schedule();
  h.timers.advance(AUTO_DRAW_DELAY_MS);
  assert.equal(h.table.hands[0].length, 6);
  assert.equal(h.table.settings.wildFour, 'anytime');
  assert.equal(h.table.pendingDraw, 0);
});

test('a new state reschedules the draw and a manual draw cancels the waiting automatic draw', () => {
  const h = driverFor(playing({ hands: [['b1', 'g2'], ['r5'], ['y6']], draw: ['r8'] }));
  h.driver.schedule();
  h.timers.advance(AUTO_DRAW_DELAY_MS / 2);
  h.table = applyAction(h.table, 1, { type: 'call' });
  h.driver.schedule();
  h.timers.advance(AUTO_DRAW_DELAY_MS / 2);
  assert.equal(h.moves.length, 0, 'the cancelled callback does not fire');
  h.timers.advance(AUTO_DRAW_DELAY_MS / 2);
  assert.equal(h.moves.length, 1);

  const manual = driverFor(playing({ hands: [['b1', 'g2'], ['r5'], ['y6']], draw: ['r8'] }));
  manual.driver.schedule();
  manual.table = applyAction(manual.table, 1, { type: 'draw', seq: manual.table.turnSeq });
  manual.driver.schedule();
  manual.timers.advance(AUTO_DRAW_DELAY_MS);
  assert.equal(manual.moves.length, 0);
  assert.equal(manual.table.hands[0].length, 3);
});

test('stale callbacks cannot draw after a changed turn, loss of authority, or stop', () => {
  // clearTimeout may race an already queued task; execute it anyway to verify guards.
  for (const transition of ['turn', 'authority', 'stop']) {
    let callback;
    const timers = { setTimeout(fn) { callback = fn; return 1; }, clearTimeout() {} };
    const h = driverFor(playing({ hands: [['b1', 'g2'], ['r5'], ['y6']] }), timers);
    h.driver.schedule();
    if (transition === 'turn') h.table = { ...h.table, current: 2, turnSeq: 2 };
    if (transition === 'authority') h.table = null;
    if (transition === 'stop') h.driver.stop();
    callback();
    assert.equal(h.moves.length, 0, transition);
  }
});

test('an automatic draw leaves time to catch a missed call before closing the window', () => {
  const h = driverFor(playing({ hands: [['b1', 'g2'], ['r5'], ['y6']], exposed: 2, draw: ['y8', 'g8', 'r8'] }));
  h.driver.schedule();
  h.timers.advance(AUTO_DRAW_DELAY_MS + AUTO_DRAW_CATCH_GRACE_MS - 1000);
  assert.equal(h.moves.length, 0, 'the normal draw delay does not close the catch window');
  h.table = applyAction(h.table, 3, { type: 'catch' });
  assert.equal(h.table.hands[1].length, 3, 'the missed call can still be caught');
  assert.equal(h.table.exposed, null);
  h.driver.schedule();
  h.timers.advance(AUTO_DRAW_DELAY_MS - 1);
  assert.equal(h.moves.length, 0);
  h.timers.advance(1);
  assert.equal(h.moves.length, 1);
  assert.equal(h.table.hands[0].length, 3);

  const unclaimed = driverFor(playing({ hands: [['b1', 'g2'], ['r5'], ['y6']], exposed: 2, draw: ['r8'] }));
  unclaimed.driver.schedule();
  unclaimed.timers.advance(AUTO_DRAW_DELAY_MS + AUTO_DRAW_CATCH_GRACE_MS - 1);
  assert.equal(unclaimed.moves.length, 0);
  unclaimed.timers.advance(1);
  assert.equal(unclaimed.moves.length, 1, 'the round proceeds once the extra catch window ends');
});
