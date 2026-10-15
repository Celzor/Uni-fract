import { choicesFor, isBotId } from './rules.js';

/** Leave enough time to show why cards are coming from the pile. */
export const AUTO_DRAW_DELAY_MS = 1000;
export const AUTO_DRAW_CATCH_GRACE_MS = 1500;

function automaticDraw(table) {
  if (table?.phase !== 'playing' || isBotId(table.current)) return null;
  const hand = table.hands[table.seats.indexOf(table.current)];
  if (!Array.isArray(hand)) return null;
  const choices = choicesFor(table, table.current, hand);
  // A challenge and a playable drawn card are still the player's decisions.
  if (!choices.draw || choices.challenge || choices.playable.length) return null;
  return { id: table.current, seq: table.turnSeq };
}

/**
 * Only the table coordinator runs this driver, just like the bots and clock.
 * Recheck the latest legal choices before acting, so a jump-in, hand swap,
 * manual draw, or host change cannot leave an old draw queued behind it.
 */
export function createAutoDrawDriver({ getTable, act, timers = globalThis }) {
  let handle = null;
  let generation = 0;

  function stop() {
    generation += 1;
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  }

  function schedule() {
    stop();
    const table = getTable();
    const move = automaticDraw(table);
    if (!move) return;
    const expected = generation;
    const { round, revision } = table;
    handle = timers.setTimeout(() => {
      if (generation !== expected) return;
      handle = null;
      const latest = getTable();
      const nextMove = automaticDraw(latest);
      if (latest?.round !== round || latest.revision !== revision ||
          nextMove?.id !== move.id || nextMove.seq !== move.seq) return;
      act(move.id, { type: 'draw', seq: move.seq });
    }, AUTO_DRAW_DELAY_MS + (table.exposed !== null ? AUTO_DRAW_CATCH_GRACE_MS : 0));
  }

  return { schedule, stop };
}
