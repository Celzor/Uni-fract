import test from 'node:test';
import assert from 'node:assert/strict';
import { choicesFor, isValidView } from '../src/rules.js';
import { HUMAN_ID, MAX_BOTS, createLocalGame } from '../src/local.js';
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
      if (card !== undefined) game.act({ type: 'play', card, color: 'b', target: 2, seq: view.turnSeq });
      else if (choices.draw) game.act({ type: 'draw', seq: view.turnSeq });
      else if (choices.keep) game.act({ type: 'keep', seq: view.turnSeq });
    }
    timers.advance(200);
  }
  assert.equal(h.state.view.phase, 'roundOver');
  game.destroy();
});

test('the bot count is adjustable only between rounds', () => {
  const h = practice({ bots: 1 });
  const { game } = h;
  assert.equal(h.state.view.seats.length, 2);
  game.setBots(99);
  assert.equal(h.state.view.seats.length, 1 + MAX_BOTS);
  game.act({ type: 'deal' });
  game.setBots(1);
  assert.equal(h.state.view.seats.length, 1 + MAX_BOTS);
  game.abandon();
  assert.equal(h.state.view.phase, 'lobby');
  game.setBots(2);
  assert.deepEqual(h.state.view.seats, [1, 2, 3]);
  game.destroy();
});
