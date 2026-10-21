import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BOTS, choicesFor, isValidView } from '../src/rules.js';
import { HUMAN_ID, createLocalGame } from '../src/local.js';
import { AUTO_DRAW_DELAY_MS } from '../src/auto-draw.js';
import { fakeTimers, seeded } from './helpers.js';

function practice({ bots = 3, seed = 5 } = {}) {
  const timers = fakeTimers();
  let latest = null;
  const game = createLocalGame({ botCount: bots, random: seeded(seed), timers, now: timers.now, onChange: (next) => { latest = next; } });
  game.start();
  return { game, timers, get state() { return latest; } };
}

test('bots play whole rounds among themselves while you watch, under every house rule', () => {
  for (const [seed, settings] of [
    [1, {}],
    [2, { stacking: 'progressive', sevenZero: true, drawToMatch: true, turnTimer: 10 }],
    [3, { stacking: 'off', forcePlay: true, wildFour: 'strict', mustCall: false, handSize: 10 }],
  ]) {
    const h = practice({ bots: MAX_BOTS, seed });
    const { game, timers } = h;
    game.act({ type: 'seat', watch: true });
    game.act({ type: 'settings', settings });
    assert.equal(h.state.view.seats.includes(HUMAN_ID), false);
    for (let round = 1; round <= 2; round += 1) {
      game.act({ type: 'deal' });
      assert.equal(h.state.view.phase, 'playing');
      for (let tick = 0; tick < 4000 && h.state.view.phase === 'playing'; tick += 1) {
        timers.advance(250);
        assert.ok(isValidView(h.state.view, h.state.participants.map((person) => person.id), HUMAN_ID));
      }
      assert.equal(h.state.view.phase, 'roundOver', `seed ${seed} round ${round} finished`);
      assert.ok(Object.values(h.state.view.scores).some((score) => score > 0));
      const deadline = h.state.nextRoundAt;
      assert.equal(deadline, h.state.view.nextRoundAt);
      game.act({ type: 'deal' });
      assert.equal(h.state.view.phase, 'roundOver', 'the host cannot deal while the countdown is running');
      timers.advance(deadline - timers.now() - 1);
      game.act({ type: 'deal' });
      assert.equal(h.state.view.phase, 'roundOver', 'one millisecond still remains');
      timers.advance(1);
    }
    game.destroy();
  }
});

test('an idle human is timed out, and can call, catch and play against bots', () => {
  const h = practice({ bots: 2, seed: 9 });
  const { game, timers } = h;
  game.act({ type: 'settings', settings: { turnTimer: 10 } });
  game.act({ type: 'deal' });
  assert.equal(h.state.view.current, HUMAN_ID);
  assert.ok(h.state.timerEndsAt > timers.now());
  timers.advance(10050);
  assert.ok(h.state.view.log.some((entry) => entry.k === 'timeout' && entry.by === HUMAN_ID));
  // Play the human sensibly until the round ends.
  for (let tick = 0; tick < 6000 && h.state.view.phase === 'playing'; tick += 1) {
    const view = h.state.view;
    const choices = choicesFor(view, HUMAN_ID, view.hand);
    if (choices.catch) game.act({ type: 'catch' });
    else if (choices.call) game.act({ type: 'call' });
    else if (view.current === HUMAN_ID) {
      const card = choices.playable.find((value) => !choices.jumpIns.includes(value));
      if (card !== undefined) game.act({ type: 'play', card, color: 'b', target: -1, seq: view.turnSeq });
      else if (choices.draw) game.act({ type: 'draw', seq: view.turnSeq });
      else if (choices.keep) game.act({ type: 'keep', seq: view.turnSeq });
    }
    timers.advance(200);
  }
  assert.equal(h.state.view.phase, 'roundOver');
  game.destroy();
});

test('the number of computer players is a house rule, fixed during a round', () => {
  const h = practice({ bots: 1 });
  const { game } = h;
  assert.deepEqual(h.state.view.seats, [HUMAN_ID, -1]);
  assert.deepEqual(h.state.participants.map((person) => person.id), [HUMAN_ID], 'bots are players, not participants');
  game.act({ type: 'settings', settings: { bots: MAX_BOTS } });
  assert.equal(h.state.view.seats.length, 1 + MAX_BOTS);
  game.act({ type: 'deal' });
  game.act({ type: 'settings', settings: { bots: 1 } });
  assert.equal(h.state.view.settings.bots, MAX_BOTS, 'rules cannot change mid-round');
  game.abandon();
  assert.equal(h.state.view.phase, 'lobby');
  game.act({ type: 'settings', settings: { bots: 2 } });
  assert.deepEqual(h.state.view.seats, [HUMAN_ID, -1, -2]);
  game.destroy();
});

test('practice automatically draws a stuck hand, and abandoning or destroying cancels it', () => {
  for (const finish of ['draw', 'abandon', 'destroy']) {
    const h = practice({ bots: 1, seed: 41 });
    h.game.act({ type: 'settings', settings: { turnTimer: 0, jumpIn: false } });
    h.game.act({ type: 'deal' });
    const before = h.state.view;
    assert.equal(before.current, HUMAN_ID);
    assert.equal(choicesFor(before, HUMAN_ID, before.hand).playable.length, 0);
    h.timers.advance(AUTO_DRAW_DELAY_MS - 1);
    assert.equal(h.state.view.revision, before.revision);
    if (finish === 'abandon') h.game.abandon();
    if (finish === 'destroy') h.game.destroy();
    h.timers.advance(1);
    if (finish === 'draw') {
      assert.equal(h.state.view.hand.length, before.hand.length + 1);
      assert.ok(h.state.view.log.some((entry) => entry.k === 'draw' && entry.by === HUMAN_ID));
    } else if (finish === 'abandon') assert.equal(h.state.view.phase, 'lobby');
    else assert.equal(h.state.view.revision, before.revision);
    h.game.destroy();
    assert.equal(h.timers.pending, 0);
  }
});

test('the host lobby action cancels practice bots and the turn clock while retaining settings', () => {
  const h = practice({ bots: 2 });
  h.game.act({ type: 'settings', settings: { turnTimer: 10 } });
  h.game.act({ type: 'deal' });
  const settings = h.state.view.settings;
  assert.ok(h.timers.pending > 0);
  h.game.act({ type: 'lobby' });
  const lobby = h.state.view;
  assert.equal(lobby.phase, 'lobby');
  assert.deepEqual(lobby.settings, settings);
  assert.deepEqual(lobby.seats, [HUMAN_ID, -1, -2]);
  assert.equal(h.state.timerEndsAt, null);
  assert.equal(h.timers.pending, 0);
  h.timers.advance(60000);
  assert.equal(h.state.view.revision, lobby.revision);
  h.game.act({ type: 'deal' });
  assert.equal(h.state.view.phase, 'playing');
  h.game.destroy();
});

test('practice supports custom turn durations and retains them when returning to the lobby', () => {
  for (const turnTimer of [0, 1, 3, 7, 90, 600]) {
    const h = practice({ bots: 1 });
    h.game.act({ type: 'settings', settings: { turnTimer, jumpIn: false } });
    h.game.act({ type: 'deal' });
    assert.equal(h.state.view.settings.turnTimer, turnTimer);
    assert.equal(h.state.timerEndsAt, turnTimer === 0 ? null : h.timers.now() + turnTimer * 1000);
    h.game.act({ type: 'settings', settings: { turnTimer: 30 } });
    assert.equal(h.state.view.settings.turnTimer, turnTimer, 'the timer remains fixed during a round');
    h.game.act({ type: 'lobby' });
    assert.equal(h.state.view.settings.turnTimer, turnTimer);
    assert.equal(h.state.timerEndsAt, null);
    h.game.destroy();
  }
});

test('a one-second practice turn expires at one second and passes control', () => {
  const h = practice({ bots: 1 });
  h.game.act({ type: 'settings', settings: { turnTimer: 1, jumpIn: false } });
  h.game.act({ type: 'deal' });
  const before = h.state.view;
  h.timers.advance(999);
  assert.equal(h.state.view.revision, before.revision);
  h.timers.advance(1);
  assert.ok(h.state.view.log.some(({ k, by }) => k === 'timeout' && by === HUMAN_ID));
  assert.notEqual(h.state.view.current, HUMAN_ID);
  assert.equal(h.state.nextRoundAt, null);
  h.game.destroy();
});
