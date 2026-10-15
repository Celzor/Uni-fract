import { BOT_NAMES, chooseTurnAction, handSize, jumpInCard, playAction } from './bots.js';
import { createTurnClock } from './clock.js';
import { abandonRound, applyAction, applyRoster, createTable, expireTurn, viewFor } from './rules.js';

export const HUMAN_ID = 1;
export const MIN_BOTS = 1;
export const MAX_BOTS = BOT_NAMES.length;

/**
 * Practice against computer players, outside of Refract. It drives the same
 * rules engine and reports the same view shape as a live session.
 */
export function createLocalGame({ onChange, random = Math.random, now = () => Date.now(), timers = globalThis, pace = 1, botCount: initialBots = 3 }) {
  let botCount = Math.min(MAX_BOTS, Math.max(MIN_BOTS, initialBots));
  let members = memberList();
  let table = applyRoster(createTable(), members, random);
  let destroyed = false;
  const scheduled = new Set();
  const clock = createTurnClock({ now, timers, onExpire: () => commit(expireTurn(table, random)) });

  function memberList() {
    return [HUMAN_ID, ...Array.from({ length: botCount }, (_, index) => index + 2)];
  }

  function people() {
    return members.map((id) => ({ id, name: id === HUMAN_ID ? 'You' : BOT_NAMES[id - 2], avatarUrl: null, bot: id !== HUMAN_ID }));
  }

  function emit() {
    if (destroyed) return;
    const remaining = clock.remaining();
    const everyone = people();
    onChange({
      view: viewFor(table, HUMAN_ID),
      self: everyone[0],
      participants: everyone,
      hostId: HUMAN_ID,
      isHost: true,
      connected: true,
      recovering: false,
      notice: '',
      timerEndsAt: remaining === null ? null : now() + remaining,
      botCount,
    });
  }

  function commit(next) {
    if (!next || destroyed) return false;
    table = next;
    clock.update(table);
    emit();
    scheduleBots();
    return true;
  }

  function act(id, action) {
    return commit(applyAction(table, id, action, { hostId: HUMAN_ID, memberIds: members, random }));
  }

  function later(ms, task) {
    const handle = timers.setTimeout(() => {
      scheduled.delete(handle);
      if (!destroyed) task();
    }, ms * pace);
    scheduled.add(handle);
  }

  function clearBots() {
    for (const handle of scheduled) timers.clearTimeout(handle);
    scheduled.clear();
  }

  function takeTurn(id) {
    if (table.phase !== 'playing' || table.current !== id) return;
    const action = chooseTurnAction(table, id, random);
    if (!action) return;
    // Bots usually remember to call before playing their second-to-last card.
    if (action.type === 'play' && handSize(table, id) === 2 && random() < 0.85) act(id, { type: 'call' });
    act(id, { ...action, seq: table.turnSeq });
  }

  function scheduleBots() {
    clearBots();
    if (table.phase !== 'playing') return;
    const bots = table.seats.filter((id) => id !== HUMAN_ID);
    const exposed = table.exposed;
    if (exposed !== null) {
      if (exposed !== HUMAN_ID && random() < 0.6) later(400 + random() * 1200, () => act(exposed, { type: 'call' }));
      const catchers = bots.filter((id) => id !== exposed);
      if (catchers.length) {
        const catcher = catchers[Math.floor(random() * catchers.length)];
        later(1500 + random() * 1700, () => act(catcher, { type: 'catch' }));
      }
    }
    for (const id of bots) {
      if (id === table.current || jumpInCard(table, id) === null || random() >= 0.45) continue;
      later(450 + random() * 700, () => {
        const card = jumpInCard(table, id);
        if (card !== null) act(id, playAction(viewFor(table, id), id, card, random));
      });
    }
    if (bots.includes(table.current)) {
      // Leave a beat to catch a missed call before the next bot moves on.
      const delay = (table.stage === 'drawn' ? 600 : 900) + random() * 700 + (exposed !== null ? 1500 : 0);
      const id = table.current;
      later(delay, () => takeTurn(id));
    }
  }

  return {
    start: emit,
    act: (action) => {
      if (!act(HUMAN_ID, action)) emit();
    },
    setBots(count) {
      if (table.phase === 'playing') return;
      botCount = Math.min(MAX_BOTS, Math.max(MIN_BOTS, count));
      members = memberList();
      commit(applyRoster(table, members, random)) || emit();
    },
    abandon() {
      if (table.phase === 'playing') commit(applyRoster(abandonRound(table), members, random));
    },
    destroy() {
      destroyed = true;
      clearBots();
      clock.reset();
    },
  };
}
