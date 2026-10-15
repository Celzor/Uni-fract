import assert from 'node:assert/strict';
import { DECK_SIZE, FACES, colorOf } from '../src/cards.js';
import { DEFAULT_SETTINGS, createTable, isValidTable } from '../src/rules.js';

/** Small deterministic generator so failures replay exactly. */
export function seeded(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Controllable setTimeout/clearTimeout/now for timers and bots. */
export function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms = 0) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 100000; guard += 1) {
        let next = null;
        for (const [id, task] of tasks) {
          if (task.at <= end && (!next || task.at < next.task.at || (task.at === next.task.at && id < next.id))) next = { id, task };
        }
        if (!next) break;
        tasks.delete(next.id);
        now = next.task.at;
        next.task.fn();
      }
      now = end;
    },
    get pending() { return tasks.size; },
  };
}

/** Card ids by face; each call hands out a different physical copy. */
export function cardPicker() {
  const used = new Set();
  const take = (face) => {
    const id = FACES.findIndex((value, index) => value === face && !used.has(index));
    assert.ok(id >= 0, `No spare ${face} card`);
    used.add(id);
    return id;
  };
  return { take, used };
}

/**
 * A playing table with chosen hands. `draw` lists the next cards to be drawn,
 * first drawn first; the rest of the deck sits underneath in id order.
 */
export function playing({ seats = [1, 2, 3], hands, discard = ['r3'], draw = [], settings = {}, ...rest }) {
  const { take, used } = cardPicker();
  const handIds = hands.map((hand) => hand.map(take));
  const discardIds = discard.map(take);
  const drawIds = draw.map(take);
  const remaining = [...Array(DECK_SIZE).keys()].filter((id) => !used.has(id));
  const table = createTable({ settings: { ...DEFAULT_SETTINGS, turnTimer: 0, ...settings } });
  Object.assign(table, {
    phase: 'playing',
    round: 1,
    seats,
    hands: handIds,
    discard: discardIds,
    drawPile: [...remaining, ...drawIds.reverse()],
    color: colorOf(discardIds.at(-1)) ?? 'r',
    current: seats[0],
    turnSeq: 1,
    turnNo: 1,
    scores: Object.fromEntries(seats.map((id) => [id, 0])),
    ...rest,
  });
  assert.ok(isValidTable(table), 'fixture table must be valid');
  return table;
}

export const faces = (cards) => cards.map((card) => FACES[card]);
export const handOf = (table, id) => table.hands[table.seats.indexOf(id)];
