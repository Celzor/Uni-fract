import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnClock } from '../src/clock.js';
import { fakeTimers } from './helpers.js';

function setup(seconds) {
  const timers = fakeTimers();
  const expiredAt = [];
  const clock = createTurnClock({
    now: timers.now,
    timers,
    onExpire: () => expiredAt.push(timers.now()),
  });
  const table = {
    phase: 'playing',
    current: 1,
    round: 1,
    turnNo: 1,
    stage: 'play',
    settings: { turnTimer: seconds },
  };
  clock.update(table);
  return { timers, clock, table, expiredAt };
}

for (const seconds of [1, 3, 7, 90, 600]) {
  test(`${seconds}-second turns expire at the exact configured deadline`, () => {
    const { timers, clock, table, expiredAt } = setup(seconds);
    assert.equal(clock.remaining(), seconds * 1000);
    timers.advance(seconds * 1000 - 1);
    clock.update(table);
    assert.equal(clock.remaining(), 1);
    assert.equal(timers.pending, 1);
    assert.deepEqual(expiredAt, []);
    timers.advance(1);
    assert.deepEqual(expiredAt, [seconds * 1000]);
    assert.equal(clock.remaining(), 0);
    timers.advance(1000);
    assert.equal(expiredAt.length, 1);
  });
}

test('turning the timer off cancels expiry and turning it on starts a fresh deadline', () => {
  const { timers, clock, table, expiredAt } = setup(3);
  timers.advance(2000);
  table.settings.turnTimer = 0;
  clock.update(table);
  assert.equal(clock.remaining(), null);
  assert.equal(timers.pending, 0);
  timers.advance(5000);
  assert.deepEqual(expiredAt, []);

  table.settings.turnTimer = 3;
  clock.update(table);
  assert.equal(clock.remaining(), 3000);
  timers.advance(2999);
  assert.deepEqual(expiredAt, []);
  timers.advance(1);
  assert.deepEqual(expiredAt, [10000]);
});

test('reset cancels the pending expiry and allows the same turn to restart', () => {
  const { timers, clock, table, expiredAt } = setup(7);
  timers.advance(1000);
  clock.reset();
  assert.equal(clock.remaining(), null);
  assert.equal(timers.pending, 0);
  timers.advance(10000);
  assert.deepEqual(expiredAt, []);
  clock.update(table);
  assert.equal(clock.remaining(), 7000);
  timers.advance(7000);
  assert.deepEqual(expiredAt, [18000]);
});

for (const condition of ['lobby', 'no current player', 'no table']) {
  test(`${condition} cancels the turn timer`, () => {
    const { timers, clock, table, expiredAt } = setup(1);
    timers.advance(500);
    if (condition === 'lobby') table.phase = 'lobby';
    if (condition === 'no current player') table.current = null;
    clock.update(condition === 'no table' ? null : table);
    assert.equal(clock.remaining(), null);
    assert.equal(timers.pending, 0);
    timers.advance(1000);
    assert.deepEqual(expiredAt, []);
  });
}

for (const changedField of ['turnNo', 'round']) {
  test(`a new ${changedField} cancels the old deadline and grants a full turn`, () => {
    const { timers, clock, table, expiredAt } = setup(3);
    timers.advance(2000);
    table[changedField] += 1;
    clock.update(table);
    assert.equal(clock.remaining(), 3000);
    assert.equal(timers.pending, 1);
    timers.advance(1000);
    assert.deepEqual(expiredAt, []);
    assert.equal(clock.remaining(), 2000);
    timers.advance(1999);
    assert.deepEqual(expiredAt, []);
    timers.advance(1);
    assert.deepEqual(expiredAt, [5000]);
  });
}

for (const seconds of [1, 2, 3, 4, 5, 7]) {
  const expectedGrace = Math.min(seconds, 5) * 1000;
  test(`${seconds}-second turns grant ${expectedGrace / 1000} seconds of drawn-card grace only once`, () => {
    const { timers, clock, table, expiredAt } = setup(seconds);
    timers.advance(seconds * 1000 - 100);
    table.stage = 'drawn';
    clock.update(table);
    const expectedExpiry = timers.now() + expectedGrace;
    assert.equal(clock.remaining(), expectedGrace);

    timers.advance(expectedGrace / 2);
    clock.update(table);
    clock.update(table);
    assert.equal(clock.remaining(), expectedGrace / 2);
    assert.equal(timers.pending, 1);
    timers.advance(expectedGrace / 2 - 1);
    clock.update(table);
    assert.equal(clock.remaining(), 1);
    assert.deepEqual(expiredAt, []);
    timers.advance(1);
    assert.deepEqual(expiredAt, [expectedExpiry]);
  });
}

test('drawing early preserves a longer existing deadline', () => {
  const { timers, clock, table, expiredAt } = setup(90);
  timers.advance(1000);
  table.stage = 'drawn';
  clock.update(table);
  assert.equal(clock.remaining(), 89000);
  timers.advance(88999);
  assert.deepEqual(expiredAt, []);
  timers.advance(1);
  assert.deepEqual(expiredAt, [90000]);
});

test('a new turn can receive drawn-card grace after the previous turn used it', () => {
  const { timers, clock, table, expiredAt } = setup(3);
  timers.advance(2900);
  table.stage = 'drawn';
  clock.update(table);
  timers.advance(1000);

  table.turnNo += 1;
  table.stage = 'play';
  clock.update(table);
  timers.advance(2900);
  assert.deepEqual(expiredAt, []);
  table.stage = 'drawn';
  clock.update(table);
  assert.equal(clock.remaining(), 3000);
  timers.advance(2999);
  assert.deepEqual(expiredAt, []);
  timers.advance(1);
  assert.deepEqual(expiredAt, [9800]);
});
