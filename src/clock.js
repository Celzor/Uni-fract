/** Extra time to decide on a just-drawn card when the turn was nearly over. */
export const DRAWN_GRACE_MS = 5000;

/**
 * The coordinator's turn timer. Only the coordinating copy runs it; everyone
 * else receives the remaining time with each snapshot.
 */
export function createTurnClock({ now = () => Date.now(), timers = globalThis, onExpire }) {
  let key = null;
  let deadline = null;
  let graced = false;
  let handle = null;

  function stop() {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  }

  function reset() {
    stop();
    key = null;
    deadline = null;
  }

  function update(table) {
    const seconds = table?.phase === 'playing' && table.current !== null ? table.settings.turnTimer : 0;
    if (!seconds) {
      reset();
      return;
    }
    const nextKey = `${table.round}:${table.turnNo}`;
    if (nextKey !== key) {
      key = nextKey;
      deadline = now() + seconds * 1000;
      graced = false;
    } else if (table.stage === 'drawn' && !graced) {
      deadline = Math.max(deadline, now() + Math.min(DRAWN_GRACE_MS, seconds * 1000));
      graced = true;
    }
    stop();
    const expected = key;
    handle = timers.setTimeout(() => {
      handle = null;
      if (key === expected) onExpire();
    }, Math.max(0, deadline - now()));
  }

  return {
    update,
    reset,
    remaining: () => (deadline === null ? null : Math.max(0, deadline - now())),
  };
}
