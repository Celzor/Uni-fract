import { createBotDriver } from './bots.js';
import { createAutoDrawDriver } from './auto-draw.js';
import { createTurnClock } from './clock.js';
import { MAX_BOTS, abandonRound, applyAction, applyRoster, createTable, expireTurn, viewFor } from './rules.js';

export const HUMAN_ID = 1;
const MEMBERS = Object.freeze([HUMAN_ID]);

/**
 * Practice against computer players, outside of Refract. It drives the same
 * rules engine and bot driver as a live table, and reports the same view shape.
 */
export function createLocalGame({ onChange, random = Math.random, now = () => Date.now(), timers = globalThis, pace = 1, botCount = 3 }) {
  const bots = Math.min(MAX_BOTS, Math.max(0, botCount));
  let table = applyRoster(createTable({ settings: { bots } }), MEMBERS, random);
  let destroyed = false;
  const clock = createTurnClock({ now, timers, onExpire: () => commit(expireTurn(table, random, now)) });
  const act = (id, action) => commit(applyAction(table, id, action, { hostId: HUMAN_ID, memberIds: MEMBERS, random, now }));
  const driver = createBotDriver({ getTable: () => (destroyed ? null : table), act, random, timers, pace });
  const autoDraw = createAutoDrawDriver({ getTable: () => (destroyed ? null : table), act, timers });

  function emit() {
    if (destroyed) return;
    const remaining = clock.remaining();
    const self = { id: HUMAN_ID, name: 'You', avatarUrl: null };
    onChange({
      view: viewFor(table, HUMAN_ID),
      self,
      participants: [self],
      hostId: HUMAN_ID,
      isHost: true,
      connected: true,
      recovering: false,
      notice: '',
      timerEndsAt: remaining === null ? null : now() + remaining,
      nextRoundAt: table.nextRoundAt,
    });
  }

  function commit(next) {
    if (!next || destroyed) return false;
    table = next;
    clock.update(table);
    emit();
    driver.schedule();
    autoDraw.schedule();
    return true;
  }

  return {
    start: emit,
    act: (action) => {
      if (!act(HUMAN_ID, action)) emit();
    },
    abandon() {
      if (table.phase === 'playing') commit(applyRoster(abandonRound(table), MEMBERS, random));
    },
    destroy() {
      destroyed = true;
      driver.stop();
      autoDraw.stop();
      clock.reset();
    },
  };
}
