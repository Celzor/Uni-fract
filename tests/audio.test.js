import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameAudio } from '../src/audio.js';
import { applyAction, viewFor } from '../src/rules.js';
import { cardPicker, playing } from './helpers.js';

function audio(options = {}) {
  const played = [];
  const media = [];
  let hidden = false;
  const controller = createGameAudio({
    createAudio(src) {
      const sound = {
        src, currentTime: 0, volume: 1, paused: true, ended: false,
        play() {
          assert.ok(media.every((other) => other === this || other.paused), 'sounds never overlap');
          this.paused = false;
          this.ended = false;
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

test('a real Oh no call speaks once for the caller and the other players', () => {
  const clients = [audio(), audio(), audio()];
  let table = playing({ hands: [['r5', 'b2'], ['g1', 'g2'], ['b1', 'b3']] });
  const show = () => clients.forEach((client, index) => client.controller.update(viewFor(table, index + 1), index + 1));
  show();
  table = applyAction(table, 1, { type: 'call' });
  show();
  show();
  table = applyAction(table, 1, { type: 'play', seq: table.turnSeq, card: table.hands[0][0] });
  show();
  for (const client of clients) {
    assert.equal(client.played.filter((cue) => cue === 'oh-no.wav').length, 1);
    assert.equal(client.played.at(-1), 'oh-no.wav', 'playing the card and the next turn do not cut off speech');
    const voice = client.media.find((sound) => sound.src.endsWith('/oh-no.wav'));
    assert.equal(voice.volume, 0.6);
    assert.equal(voice.playbackRate, 1);
    assert.equal(voice.preservesPitch, true);
  }
});

test('Oh no attached to a draw-four play takes priority over its impact and the next turn', () => {
  const clients = [audio(), audio(), audio()];
  let table = playing({ hands: [['wd4', 'b2'], ['g1', 'g2'], ['b1', 'b3']] });
  const show = () => clients.forEach((client, index) => client.controller.update(viewFor(table, index + 1), index + 1));
  show();
  table = applyAction(table, 1, {
    type: 'play', seq: table.turnSeq, card: table.hands[0][0], color: 'b', call: true,
  });
  assert.equal(table.pendingDraw, 4);
  show();
  show();
  for (const client of clients) {
    assert.equal(client.played.filter((cue) => cue === 'oh-no.wav').length, 1);
    assert.equal(client.played.at(-1), 'oh-no.wav');
    assert.equal(client.played.includes('impact.wav'), false);
  }
});

test('spoken calls interrupt card impacts and never replay after mute, hiding or reconnect', () => {
  const h = audio();
  const { take } = cardPicker();
  let view = snapshot();
  const append = (entry) => {
    view = { ...view, revision: view.revision + 1,
      log: [...view.log, { ...entry, seq: view.log.length + 1 }] };
    h.controller.update(view, 1);
  };
  h.controller.update(view, 1);
  append({ k: 'play', card: take('wd4') });
  append({ k: 'call', by: 2 });
  assert.deepEqual(h.played, ['impact.wav', 'oh-no.wav']);
  assert.equal(h.media[0].paused, true);
  const voice = h.media[1];
  voice.currentTime = 0.4;
  h.controller.setEnabled(false);
  assert.equal(voice.paused, true);
  assert.equal(voice.currentTime, 0);
  append({ k: 'call', by: 3 });
  h.controller.setEnabled(true);
  h.controller.update(view, 1);
  h.hide(true);
  append({ k: 'call', by: 2 });
  h.hide(false);
  h.controller.update(view, 1);
  h.controller.update(null, 1);
  h.controller.update(structuredClone(view), 1);
  assert.deepEqual(h.played, ['impact.wav', 'oh-no.wav']);
  append({ k: 'call', by: 3 });
  assert.deepEqual(h.played, ['impact.wav', 'oh-no.wav', 'oh-no.wav']);
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

test('draw cards land distinct impacts ahead of turn nudges and automatic takes', () => {
  const h = audio();
  const { take } = cardPicker();
  h.controller.update(snapshot(), 1);
  const four = snapshot({ revision: 2, current: 1, turnNo: 2, pendingDraw: 4,
    log: [{ seq: 1, k: 'play', card: take('wd4') }] });
  h.controller.update(four, 1);
  assert.deepEqual(h.played, ['impact.wav']);
  h.controller.update({ ...four, revision: 3, pendingDraw: 0,
    log: [...four.log, { seq: 2, k: 'take', n: 4 }] }, 1);
  assert.deepEqual(h.played, ['impact.wav'], 'automatic collection cannot cut off the impact');
  const two = snapshot({ revision: 4, current: 1, turnNo: 3, pendingDraw: 2,
    log: [...four.log, { seq: 2, k: 'take', n: 4 }, { seq: 3, k: 'play', card: take('rd2') }] });
  h.controller.update(two, 1);
  assert.deepEqual(h.played, ['impact.wav', 'stack.wav'], 'a new draw-two lands even over a previous draw-four');
});

test('stack weight grows within comfortable limits and resets for the next unstacked card', () => {
  const h = audio();
  const { take } = cardPicker();
  let view = snapshot();
  h.controller.update(view, 1);
  const land = (pendingDraw) => {
    view = { ...view, revision: view.revision + 1, pendingDraw,
      log: [...view.log, { seq: view.log.length + 1, k: 'play', card: take('wd4') }] };
    h.controller.update(view, 1);
    return h.media.find((sound) => sound.src.endsWith('/impact.wav'));
  };
  const first = land(4);
  const initialRate = first.playbackRate;
  const initialVolume = first.volume;
  land(8);
  assert.ok(first.playbackRate < initialRate);
  assert.ok(first.volume > initialVolume);
  assert.equal(first.preservesPitch, false);
  land(32);
  assert.ok(first.playbackRate >= 0.86);
  assert.ok(first.volume <= 0.38);
  land(4);
  assert.equal(first.playbackRate, initialRate);
  assert.equal(first.volume, initialVolume);
  assert.deepEqual(h.played, ['impact.wav', 'impact.wav', 'impact.wav', 'impact.wav']);
});

test('stack impacts never replay on snapshots, reconnect, unmute or a lower-revision sync', () => {
  const h = audio();
  const { take } = cardPicker();
  const first = snapshot({ revision: 5, pendingDraw: 4, log: [{ seq: 4, k: 'play', card: take('wd4') }] });
  h.controller.update(first, 1);
  assert.deepEqual(h.played, []);
  const stacked = { ...first, revision: 6, pendingDraw: 8,
    log: [...first.log, { seq: 5, k: 'play', card: take('wd4') }] };
  h.controller.update(stacked, 1);
  h.controller.update(structuredClone(stacked), 1);
  h.controller.update(null, 1);
  h.controller.update(structuredClone(stacked), 1);
  h.controller.setEnabled(false);
  const muted = { ...stacked, revision: 7, pendingDraw: 10,
    log: [...stacked.log, { seq: 6, k: 'play', card: take('rd2') }] };
  h.controller.update(muted, 1);
  h.controller.setEnabled(true);
  h.controller.update(muted, 1);
  h.controller.update(first, 1);
  assert.deepEqual(h.played, ['impact.wav']);
});

test('a draw-four finishing the round selects the fanfare and further impacts cannot interrupt it', () => {
  const h = audio();
  const { take } = cardPicker();
  h.controller.update(snapshot(), 1);
  const finished = snapshot({ revision: 2, phase: 'roundOver', log: [
    { seq: 1, k: 'play', card: take('wd4') }, { seq: 2, k: 'take', n: 4 }, { seq: 3, k: 'win' },
  ] });
  h.controller.update(finished, 1);
  h.controller.update({ ...finished, revision: 3, phase: 'playing', round: 2, pendingDraw: 4,
    log: [...finished.log, { seq: 4, k: 'play', card: take('wd4') }] }, 1);
  assert.deepEqual(h.played, ['win.wav']);
  assert.equal(h.media[0].paused, false);
});

test('round fanfare finishes over new-hand cues without queuing a backlog', () => {
  const h = audio();
  h.controller.update(snapshot(), 1);
  const finished = snapshot({ revision: 2, phase: 'roundOver', log: [{ seq: 1, k: 'win' }] });
  h.controller.update(finished, 1);
  const fanfare = h.media[0];
  assert.equal(fanfare.volume, 0.34);
  const nextRound = snapshot({ revision: 3, round: 2, current: 1, log: [...finished.log, { seq: 2, k: 'deal' }] });
  h.controller.update(nextRound, 1);
  const call = { ...nextRound, revision: 4, log: [...nextRound.log, { seq: 3, k: 'call' }] };
  h.controller.update(call, 1);
  assert.deepEqual(h.played, ['win.wav']);
  assert.equal(fanfare.paused, false);
  fanfare.ended = true;
  fanfare.paused = true;
  h.controller.update(call, 1);
  assert.deepEqual(h.played, ['win.wav'], 'no skipped cues play after the fanfare ends');
  h.controller.update({ ...call, revision: 5, log: [...call.log, { seq: 4, k: 'play' }] }, 1);
  assert.deepEqual(h.played, ['win.wav', 'play.wav']);
});

test('match completion gets one bigger fanfare, never on initial snapshots or reconnects', () => {
  const h = audio();
  h.controller.update(snapshot(), 1);
  const completed = snapshot({ revision: 2, phase: 'roundOver', matchWinner: 1, log: [{ seq: 1, k: 'win' }] });
  h.controller.update(completed, 1);
  h.controller.update(structuredClone(completed), 1);
  assert.deepEqual(h.played, ['match-win.wav']);
  assert.equal(h.media[0].volume, 0.36);
  h.controller.update(null, 1);
  assert.equal(h.media[0].paused, true);
  h.controller.update(structuredClone(completed), 1);
  assert.deepEqual(h.played, ['match-win.wav']);
  const joining = audio();
  joining.controller.update(completed, 1);
  assert.deepEqual(joining.played, []);
});

test('muting immediately stops a celebration and unmuting never replays it', () => {
  const h = audio();
  h.controller.update(snapshot(), 1);
  const finished = snapshot({ revision: 2, phase: 'roundOver', log: [{ seq: 1, k: 'win' }] });
  h.controller.update(finished, 1);
  h.media[0].currentTime = 0.5;
  h.controller.setEnabled(false);
  assert.equal(h.media[0].paused, true);
  assert.equal(h.media[0].currentTime, 0);
  h.controller.setEnabled(true);
  h.controller.update(finished, 1);
  assert.deepEqual(h.played, ['win.wav']);
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
  assert.deepEqual(h.played, ['turn.wav', 'oh-no.wav']);
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
  assert.deepEqual(h.played, ['oh-no.wav']);
  h.controller.destroy();
  assert.equal(h.media[0].paused, true);
  h.controller.update({ ...hidden, revision: 4, turnNo: 3 }, 1);
  assert.deepEqual(h.played, ['oh-no.wav']);
});

test('an accepted lower-revision sync baselines history and resumes sound for new events', () => {
  const h = audio();
  h.controller.update(snapshot({ revision: 50, current: 1, turnNo: 20, log: [{ seq: 80, k: 'play' }] }), 1);
  const restored = snapshot({ revision: 4, current: 1, turnNo: 2, log: [{ seq: 3, k: 'deal' }, { seq: 4, k: 'play' }] });
  h.controller.update(restored, 1);
  h.controller.update(restored, 1);
  assert.deepEqual(h.played, ['turn.wav'], 'restored history and current turn are not replayed');
  h.controller.update({ ...restored, revision: 5, log: [...restored.log, { seq: 5, k: 'call' }] }, 1);
  assert.deepEqual(h.played, ['turn.wav', 'oh-no.wav']);
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
  assert.deepEqual(h.played, ['turn.wav', 'oh-no.wav']);
  h.controller.setEnabled(false);
  h.controller.reset();
  h.controller.update(previous, 1);
  assert.deepEqual(h.played, ['turn.wav', 'oh-no.wav'], 'reset preserves the mute preference');
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

test('a rejected fanfare releases its priority so the next user action can sound', async () => {
  const played = [];
  const h = audio({ createAudio(src) {
    return {
      currentTime: 0, paused: false, ended: false,
      pause() { this.paused = true; },
      play() {
        played.push(src.split('/').at(-1));
        return src.endsWith('/win.wav') ? Promise.reject(new Error('Autoplay blocked')) : Promise.resolve();
      },
    };
  } });
  h.controller.update(snapshot(), 1);
  const finished = snapshot({ revision: 2, phase: 'roundOver', log: [{ seq: 1, k: 'win' }] });
  h.controller.update(finished, 1);
  await Promise.resolve();
  h.controller.update({ ...finished, revision: 3, log: [...finished.log, { seq: 2, k: 'deal' }] }, 1);
  assert.deepEqual(played, ['win.wav', 'deal.wav']);
});
