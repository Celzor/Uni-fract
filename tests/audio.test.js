import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameAudio } from '../src/audio.js';
import { applyAction, viewFor } from '../src/rules.js';
import { playing } from './helpers.js';

function audio(options = {}) {
  const played = [];
  const media = [];
  let hidden = false;
  const controller = createGameAudio({
    createAudio(src) {
      const sound = {
        src, currentTime: 0, volume: 1, paused: true,
        play() {
          assert.ok(media.every((other) => other === this || other.paused), 'sounds never overlap');
          this.paused = false;
          played.push(src.split('/').at(-1));
          return Promise.resolve();
        },
        pause() { this.paused = true; },
      };
      media.push(sound);
      return sound;
    },
    isHidden: () => hidden,
    ...options,
  });
  return { controller, played, media, hide(value) { hidden = value; } };
}

function snapshot(overrides = {}) {
  return { phase: 'playing', round: 1, turnNo: 1, revision: 1, current: 2, log: [], ...overrides };
}

test('initial history stays silent, while joining on your turn gives one nudge', () => {
  const h = audio();
  assert.equal(h.media.length, 0, 'audio is created lazily');
  const view = snapshot({ log: [{ seq: 1, n: 1, k: 'deal' }, { seq: 2, n: 2, k: 'play' }] });
  h.controller.update(view, 1);
  assert.deepEqual(h.played, []);
  h.controller.update({ ...view, current: 1, turnNo: 2, revision: 2 }, 1);
  h.controller.update({ ...view, current: 1, turnNo: 2, revision: 2 }, 1);
  assert.deepEqual(h.played, ['turn.wav']);
  assert.ok(h.media.every((sound) => sound.volume <= 0.3));

  const joining = audio();
  joining.controller.update({ ...view, current: 1 }, 1);
  joining.controller.update({ ...view, current: 1 }, 1);
  assert.deepEqual(joining.played, ['turn.wav']);
  const finished = audio();
  finished.controller.update(snapshot({ phase: 'roundOver', log: [{ seq: 3, n: 3, k: 'win' }] }), 1);
  assert.deepEqual(finished.played, []);
});

test('real consecutive single-card draws each sound once, including a draw that keeps your turn', () => {
  const h = audio();
  let table = playing({ hands: [['b1', 'g2'], ['b2', 'g3'], ['b3', 'g4']], draw: ['r4', 'r5'] });
  const show = () => h.controller.update(viewFor(table, 1), 1);
  show();
  table = applyAction(table, 1, { type: 'draw', seq: table.turnSeq });
  assert.equal(table.current, 1);
  assert.equal(table.stage, 'drawn');
  show();
  show();
  table = applyAction(table, 1, { type: 'keep', seq: table.turnSeq });
  show();
  table = applyAction(table, 2, { type: 'draw', seq: table.turnSeq });
  show();
  show();
  assert.deepEqual(table.log.filter((entry) => entry.k === 'draw').map((entry) => entry.n), [1, 1]);
  assert.deepEqual(h.played, ['turn.wav', 'draw.wav', 'draw.wav']);
});

test('turn and win cues take priority over card effects without layering', () => {
  const h = audio();
  h.controller.update(snapshot(), 1);
  h.controller.update(snapshot({ revision: 2, current: 1, turnNo: 2, log: [{ seq: 1, n: 1, k: 'play' }] }), 1);
  h.controller.update(snapshot({ revision: 3, phase: 'roundOver', log: [
    { seq: 1, n: 1, k: 'play' }, { seq: 2, n: 2, k: 'play' },
    { seq: 3, n: 4, k: 'take' }, { seq: 4, n: 4, k: 'win' },
  ] }), 1);
  assert.deepEqual(h.played, ['turn.wav', 'win.wav']);
  assert.equal(h.media[0].paused, true);
});

test('muting stops playback and consumes events without replay on unmute', () => {
  const h = audio();
  h.controller.update(snapshot({ current: 1 }), 1);
  h.controller.setEnabled(false);
  assert.equal(h.media[0].paused, true);
  const next = snapshot({ revision: 2, turnNo: 2, current: 1, log: [{ seq: 1, n: 1, k: 'play' }] });
  h.controller.update(next, 1);
  h.controller.setEnabled(true);
  h.controller.update(next, 1);
  assert.deepEqual(h.played, ['turn.wav']);
  h.controller.update({ ...next, revision: 3, log: [...next.log, { seq: 2, n: 2, k: 'call' }] }, 1);
  assert.deepEqual(h.played, ['turn.wav', 'call.wav']);
});

test('hidden updates, temporary null views and repeated syncs do not replay cues', () => {
  const h = audio();
  h.controller.update(snapshot(), 1);
  h.hide(true);
  const hidden = snapshot({ revision: 2, current: 1, turnNo: 2, log: [{ seq: 1, n: 1, k: 'play' }] });
  h.controller.update(hidden, 1);
  h.hide(false);
  h.controller.update(hidden, 1);
  h.controller.update(null, 1);
  h.controller.update(structuredClone(hidden), 1);
  assert.deepEqual(h.played, []);
  h.controller.update({ ...hidden, revision: 3, log: [...hidden.log, { seq: 2, n: 2, k: 'call' }] }, 1);
  assert.deepEqual(h.played, ['call.wav']);
  h.controller.destroy();
  assert.equal(h.media[0].paused, true);
  h.controller.update({ ...hidden, revision: 4, turnNo: 3 }, 1);
  assert.deepEqual(h.played, ['call.wav']);
});

test('an accepted lower-revision sync baselines history and resumes sound for new events', () => {
  const h = audio();
  h.controller.update(snapshot({ revision: 50, current: 1, turnNo: 20, log: [{ seq: 80, k: 'play' }] }), 1);
  const restored = snapshot({ revision: 4, current: 1, turnNo: 2, log: [{ seq: 3, k: 'deal' }, { seq: 4, k: 'play' }] });
  h.controller.update(restored, 1);
  h.controller.update(restored, 1);
  assert.deepEqual(h.played, ['turn.wav'], 'restored history and current turn are not replayed');
  h.controller.update({ ...restored, revision: 5, log: [...restored.log, { seq: 5, k: 'call' }] }, 1);
  assert.deepEqual(h.played, ['turn.wav', 'call.wav']);
});

test('reset starts a new session baseline even when revisions and event IDs are reused', () => {
  const h = audio();
  const previous = snapshot({ revision: 4, current: 1, log: [{ seq: 9, k: 'deal' }] });
  h.controller.update(previous, 1);
  h.controller.reset();
  assert.equal(h.media[0].paused, true);
  const nextSession = snapshot({ revision: 4, log: [{ seq: 9, k: 'deal' }, { seq: 10, k: 'play' }] });
  h.controller.update(nextSession, 1);
  h.controller.update(nextSession, 1);
  assert.deepEqual(h.played, ['turn.wav'], 'new-session history is silent');
  h.controller.update({ ...nextSession, revision: 5, log: [...nextSession.log, { seq: 11, k: 'call' }] }, 1);
  assert.deepEqual(h.played, ['turn.wav', 'call.wav']);
  h.controller.setEnabled(false);
  h.controller.reset();
  h.controller.update(previous, 1);
  assert.deepEqual(h.played, ['turn.wav', 'call.wav'], 'reset preserves the mute preference');
});

test('deals and calls have cues; empty draws and automatic timeout/keep actions are quiet', () => {
  const h = audio();
  let view = snapshot({ phase: 'lobby', revision: 0 });
  h.controller.update(view, 1);
  const append = (...entries) => {
    view = { ...view, revision: view.revision + 1, log: [...view.log, ...entries.map((entry, i) => ({ seq: view.log.length + i + 1, ...entry }))] };
    h.controller.update(view, 1);
  };
  append({ k: 'deal' });
  append({ k: 'play' });
  append({ k: 'take', n: 4 });
  append({ k: 'catch', n: 2 });
  append({ k: 'challenge', n: 6 });
  append({ k: 'draw', n: 0 });
  append({ k: 'timeout' }, { k: 'draw', n: 1 }, { k: 'keep' });
  append({ k: 'keep' }, { k: 'recover' });
  assert.deepEqual(h.played, ['deal.wav', 'play.wav', 'draw.wav', 'call.wav', 'call.wav']);
});

test('legacy logs without sequence IDs deduplicate by ordered overlap, including a trimmed log', () => {
  const h = audio();
  const first = { k: 'play', n: 5, by: 2, card: 4 };
  const draw = { k: 'draw', n: 1, by: 2 };
  h.controller.update(snapshot({ log: [first] }), 1);
  h.controller.update(snapshot({ revision: 2, log: [first, draw] }), 1);
  h.controller.update(snapshot({ revision: 2, log: [first, draw] }), 1);
  h.controller.update(snapshot({ revision: 3, log: [draw, { k: 'keep', n: 7, by: 2 }] }), 1);
  h.controller.update(snapshot({ revision: 4, log: [{ k: 'keep', n: 7, by: 2 }, draw] }), 1);
  assert.deepEqual(h.played, ['draw.wav', 'draw.wav']);
});

test('blocked autoplay and synchronous media failures never interrupt updates or retry stale events', async () => {
  for (const failure of ['reject', 'throw', 'construct']) {
    let attempts = 0;
    const h = audio({ createAudio() {
      if (failure === 'construct') { attempts += 1; throw new Error('Media unavailable'); }
      return {
        pause() {}, currentTime: 0,
        play() {
          attempts += 1;
          if (failure === 'throw') throw new Error('Media unavailable');
          return Promise.reject(new Error('Autoplay blocked'));
        },
      };
    } });
    const view = snapshot({ current: 1 });
    assert.doesNotThrow(() => h.controller.update(view, 1));
    h.controller.update(view, 1);
    await Promise.resolve();
    assert.equal(attempts, 1);
    h.controller.update({ ...view, revision: 2, turnNo: 2 }, 1);
    await Promise.resolve();
    assert.equal(attempts, 2, 'later cues still attempt playback');
  }
});
