import { drawAmount, isCard } from './cards.js';

const CUES = Object.freeze({
  play: { volume: 0.22, priority: 1 },
  draw: { volume: 0.22, priority: 1 },
  deal: { volume: 0.25, priority: 2 },
  call: { volume: 0.28, priority: 3 },
  turn: { volume: 0.28, priority: 4 },
  stack: { volume: 0.3, priority: 5 },
  impact: { volume: 0.34, priority: 6 },
  'oh-no': { volume: 0.6, priority: 6.5 },
  win: { volume: 0.34, priority: 7 },
  'match-win': { volume: 0.36, priority: 8 },
});

const isImpact = (cue) => cue === 'stack' || cue === 'impact';

function eventCue(entry, view) {
  switch (entry.k) {
    case 'play': {
      const amount = isCard(entry.card) ? drawAmount(entry.card) : 0;
      return amount === 4 ? 'impact' : amount === 2 ? 'stack' : 'play';
    }
    case 'draw': case 'take': return entry.n > 0 ? 'draw' : null;
    case 'call': return 'oh-no';
    case 'catch': case 'challenge': return 'call';
    case 'deal': return 'deal';
    case 'win': return view.matchWinner != null ? 'match-win' : 'win';
    default: return null;
  }
}

// Older saved games have no seq field; n also holds card counts in those logs.
function appendedEntries(previous, current) {
  for (let size = Math.min(previous.length, current.length); size > 0; size -= 1) {
    if (previous.slice(-size).every((entry, index) => entry === JSON.stringify(current[index]))) {
      return current.slice(size);
    }
  }
  return current;
}

/** Play at most one cue per public game update, without replaying history. */
export function createGameAudio({
  enabled = true,
  createAudio = (src) => new Audio(src),
  isHidden = () => globalThis.document?.hidden === true,
} = {}) {
  const sounds = new Map();
  let active = null;
  let hydrated = false;
  let destroyed = false;
  let lastLog = [];
  let lastSeq = 0;
  let lastRevision = -1;
  let lastTurn = null;

  function stop() {
    const sound = active?.sound;
    active = null;
    if (!sound) return;
    try { sound.pause(); } catch { /* Media failures must not interrupt the game. */ }
    try { sound.currentTime = 0; } catch { /* Metadata may not have loaded yet. */ }
  }

  function play(cue, pendingDraw) {
    // Let spoken calls, impacts and fanfares finish over ordinary cues. Each newly stacked
    // card can land its own impact, while celebrations remain the priority.
    // Skipped cues are consumed by update(), so they never queue up afterwards.
    if (active && CUES[active.cue].priority >= CUES.stack.priority
      && !active.sound.paused && !active.sound.ended
      && CUES[cue].priority < CUES[active.cue].priority
      && !(isImpact(active.cue) && isImpact(cue))) return;
    stop();
    try {
      let sound = sounds.get(cue);
      if (!sound) {
        sound = createAudio(`./assets/audio/${cue}.wav`);
        sounds.set(cue, sound);
      }
      // A growing stack feels heavier through pitch, with only a small gain
      // increase. Reset cached media properties for the next unstacked card.
      const extra = isImpact(cue) ? Math.max(0, (pendingDraw ?? 0) - (cue === 'impact' ? 4 : 2)) : 0;
      sound.volume = CUES[cue].volume + Math.min(0.04, extra * 0.004);
      sound.preservesPitch = cue === 'oh-no';
      sound.playbackRate = Math.max(0.86, 1 - extra * 0.01);
      const playback = { sound, cue };
      active = playback;
      sound.currentTime = 0;
      sound.play()?.catch(() => {
        // A blocked effect must not suppress later cues after a user gesture.
        if (active === playback) stop();
      });
    } catch { stop(); }
  }

  function reset() {
    stop();
    hydrated = false;
    lastLog = [];
    lastSeq = 0;
    lastRevision = -1;
    lastTurn = null;
  }

  return {
    update(view, selfId) {
      if (destroyed) return;
      if (!view) {
        stop();
        return; // Keep cursors through temporary disconnects.
      }
      // A requested sync may accept a reloaded host's earlier table. Treat its
      // history as a fresh baseline, so old sequence numbers cannot mute it.
      const restarted = view.revision < lastRevision;
      if (restarted) reset();
      const log = view.log ?? [];
      const appended = hydrated ? appendedEntries(lastLog, log) : [];
      const fresh = hydrated ? log.filter((entry) => Number.isSafeInteger(entry.seq)
        ? entry.seq > lastSeq : appended.includes(entry)) : [];
      const turn = selfId != null && view.phase === 'playing' && view.current === selfId
        ? `${selfId}:${view.round}:${view.turnNo}` : null;
      let cue = !restarted && turn && turn !== lastTurn ? 'turn' : null;
      const timedOut = fresh.some((entry) => entry.k === 'timeout');
      for (const entry of fresh) {
        const next = eventCue(entry, view);
        if (!next || (timedOut && CUES[next].priority === 1)) continue;
        if (!cue || CUES[next].priority >= CUES[cue].priority) cue = next;
      }

      hydrated = true;
      lastLog = log.map((entry) => JSON.stringify(entry));
      lastSeq = Math.max(lastSeq, ...log.map((entry) => entry.seq ?? 0));
      lastRevision = view.revision ?? lastRevision;
      lastTurn = turn;
      // Advance cursors even while muted or hidden; restoring sound has no backlog.
      if (!enabled || isHidden()) {
        stop();
        return;
      }
      if (cue) play(cue, view.pendingDraw);
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) stop();
    },
    reset,
    destroy() {
      destroyed = true;
      stop();
      sounds.clear();
    },
  };
}
