import { createBotDriver } from './bots.js';
import { createAutoDrawDriver } from './auto-draw.js';
import { createTurnClock } from './clock.js';
import {
  NEXT_ROUND_DELAY_MS, TURN_TIMER_LIMITS, applyAction, applyRoster, createTable, expireTurn, isValidTable, isValidView, migrateSnapshot, rebuildTable, viewFor,
} from './rules.js';

export const GAME_PROTOCOL = 'uni-refract/1';
export const RECOVERY_WINDOW_MS = 2500;
export const RECOVERY_RETRY_MS = 900;
const MAX_TIMER_MS = TURN_TIMER_LIMITS.max * 1000;

const validId = (id) => Number.isSafeInteger(id) && id > 0;
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const token = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const validToken = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;

function normalizePeople(people) {
  if (!Array.isArray(people)) return null;
  const seen = new Set();
  const result = [];
  for (const person of people) {
    if (!person || !validId(person.id) || seen.has(person.id)) return null;
    seen.add(person.id);
    result.push({
      id: person.id,
      name: typeof person.name === 'string' && person.name.trim() ? person.name : `Player ${person.id}`,
      avatarUrl: typeof person.avatarUrl === 'string' ? person.avatarUrl : null,
    });
  }
  return result;
}

function browserStorage() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

/**
 * The shared game for one Refract activity session. The first participant
 * coordinates: it alone holds the full table (every hand and the draw pile),
 * applies actions, runs the turn timer, and sends each participant a view
 * containing only what that participant may see.
 */
export function createSession({ send, onChange, storage = browserStorage(), random = Math.random, now = () => Date.now(), timers = globalThis }) {
  let table = null;
  let view = null;
  let self = null;
  let participants = [];
  let earlyParticipants = null;
  let sessionId = null;
  let hostId = null;
  let connected = false;
  let notice = '';
  let destroyed = false;
  let acceptedHostId = null;
  let pendingSync = null;
  let recovery = null;
  let timerEndsAt = null;

  const ids = () => participants.map((person) => person.id);
  const isHost = () => self !== null && self.id === hostId;
  const isMember = (id) => participants.some((person) => person.id === id);
  const others = () => ids().filter((id) => id !== self?.id);
  const storageKey = () => `${GAME_PROTOCOL}:${JSON.stringify([sessionId, self?.id])}`;

  const clock = createTurnClock({
    now,
    timers,
    onExpire() {
      if (!destroyed && isHost() && table && !recovery) commit(expireTurn(table, random, now));
    },
  });

  // Computer players are played by whoever coordinates the table.
  const hosting = () => !destroyed && isHost() && table !== null && !recovery;
  const actForPlayer = (id, action) => hosting() && commit(applyAction(table, id, action, { hostId, memberIds: ids(), random, now }));
  const bots = createBotDriver({
    getTable: () => (hosting() ? table : null),
    act: actForPlayer,
    random,
    timers,
  });
  const autoDraw = createAutoDrawDriver({
    getTable: () => (hosting() ? table : null),
    act: actForPlayer,
    timers,
  });

  function persist() {
    if (!storage || !isHost() || !table || recovery) return;
    try {
      storage.setItem(storageKey(), JSON.stringify({ table, hostId, members: ids() }));
    } catch { /* A disabled or full browser store must not prevent live play. */ }
  }

  function restore() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(storageKey());
      if (!raw || raw.length > 200000) return null;
      const saved = JSON.parse(raw);
      const restored = migrateSnapshot(saved?.table);
      return saved?.hostId === self.id && isValidTable(restored) ? restored : null;
    } catch {
      return null;
    }
  }

  function restingNotice() {
    if (!self || !isMember(self.id)) return 'You are no longer in this activity.';
    if (recovery) return 'Gathering everyone’s cards…';
    if (!connected) return 'Synchronizing the table…';
    return '';
  }

  function emit() {
    if (destroyed) return;
    persist();
    onChange({
      view: clone(view),
      self: self && { ...self },
      participants: participants.map((person) => ({ ...person })),
      hostId,
      isHost: isHost(),
      connected,
      recovering: recovery !== null,
      notice,
      timerEndsAt,
      nextRoundAt: view?.nextRoundAt ?? null,
    });
  }

  function transmit(kind, data = {}, to) {
    if (destroyed || !sessionId || !self || !isMember(self.id)) return;
    try {
      send({ protocol: GAME_PROTOCOL, sessionId, hostId, kind, ...data }, to);
    } catch (error) {
      console.warn('Uni-refract could not send a message.', error);
    }
  }

  /** Each participant receives a private view: their own hand, never anyone else's. */
  function publish(targets = others(), replyTo) {
    if (!isHost() || !table || recovery) return;
    const members = ids();
    const remainingMs = clock.remaining();
    for (const id of targets) {
      if (id === self.id || !isMember(id)) continue;
      transmit('state', {
        view: viewFor(table, id), members, remainingMs,
        nextRoundRemainingMs: nextRoundRemaining(table),
        ...(replyTo ? { replyTo } : {}),
      }, [id]);
    }
  }

  function commit(next) {
    if (!next || destroyed || !isHost()) return false;
    table = next;
    clock.update(table);
    view = viewFor(table, self.id);
    const remaining = clock.remaining();
    timerEndsAt = remaining === null ? null : now() + remaining;
    connected = true;
    acceptedHostId = hostId;
    notice = restingNotice();
    emit();
    publish();
    bots.schedule();
    autoDraw.schedule();
    return true;
  }

  function stopHosting() {
    table = null;
    clock.reset();
    bots.stop();
    autoDraw.stop();
    if (recovery) recovery.handles.forEach((handle) => timers.clearTimeout(handle));
    recovery = null;
  }

  /**
   * A new coordinator has no hidden cards. It asks everyone for their latest
   * view (which includes their own hand), adopts the most recent one, and
   * re-deals anything nobody could vouch for.
   */
  function beginRecovery() {
    autoDraw.stop();
    if (recovery) recovery.handles.forEach((handle) => timers.clearTimeout(handle));
    const requestId = token();
    recovery = { requestId, reports: new Map(), handles: [] };
    connected = false;
    notice = restingNotice();
    emit();
    if (!others().length) {
      finishRecovery();
      return;
    }
    transmit('recover', { requestId }, others());
    recovery.handles.push(timers.setTimeout(() => {
      if (recovery?.requestId !== requestId) return;
      // Peers that had not yet seen the roster change ignored the first request.
      const missing = others().filter((id) => !recovery.reports.has(id));
      if (missing.length) transmit('recover', { requestId }, missing);
    }, RECOVERY_RETRY_MS));
    recovery.handles.push(timers.setTimeout(() => {
      if (recovery?.requestId === requestId) finishRecovery();
    }, RECOVERY_WINDOW_MS));
  }

  function maybeFinishRecovery() {
    if (recovery && others().every((id) => recovery.reports.has(id))) finishRecovery();
  }

  function finishRecovery() {
    if (!recovery || destroyed) return;
    const { reports, handles } = recovery;
    handles.forEach((handle) => timers.clearTimeout(handle));
    recovery = null;
    const candidates = [];
    if (table) candidates.push({ id: self.id, view: viewFor(table, self.id), authoritative: true });
    else if (view && isValidView(view, null, self.id)) candidates.push({ id: self.id, view });
    for (const [id, reported] of reports) if (reported) candidates.push({ id, view: reported });
    // The local table wins ties because it alone holds every hand.
    let best = null;
    for (const candidate of candidates) {
      if (!best || candidate.view.revision > best.view.revision) best = candidate;
    }
    let next;
    if (best?.authoritative) next = table;
    else if (best) {
      const hands = new Map();
      for (const candidate of candidates) {
        if (candidate.view.hand) hands.set(candidate.id, { hand: candidate.view.hand, drawnCard: candidate.view.drawnCard });
      }
      next = rebuildTable(best.view, hands, random);
    } else {
      next = createTable();
    }
    if (!isValidTable(next)) next = createTable({ settings: best?.view.settings });
    commit(applyRoster(next, ids(), random));
  }

  function updateRoster(people) {
    const next = normalizePeople(people);
    if (!next || destroyed) return;
    if (!self) {
      earlyParticipants = next;
      return;
    }
    const oldHost = hostId;
    const oldMembers = ids();
    participants = next;
    hostId = participants[0]?.id ?? null;
    const changed = JSON.stringify(oldMembers) !== JSON.stringify(ids());
    const leadershipChanged = oldHost !== hostId;
    if (!isMember(self.id)) {
      stopHosting();
      connected = false;
      notice = restingNotice();
      emit();
      return;
    }

    if (isHost()) {
      if (leadershipChanged) {
        beginRecovery();
      } else if (recovery) {
        emit();
        maybeFinishRecovery();
      } else if (table) {
        const updated = applyRoster(table, ids(), random);
        if (updated !== table) commit(updated);
        else {
          emit();
          if (changed) publish();
        }
      }
      return;
    }

    if (leadershipChanged) stopHosting();
    if (leadershipChanged || (view && !isValidView(view, ids(), self.id))) {
      connected = false;
      acceptedHostId = null;
    }
    notice = restingNotice();
    emit();
    if (changed) sync();
  }

  function init(message) {
    if (destroyed || !message || typeof message.sessionId !== 'string' || !message.sessionId ||
        !message.self || !validId(message.self.id)) return;
    const nextParticipants = normalizePeople(message.participants);
    if (!nextParticipants || !nextParticipants.some((person) => person.id === message.self.id)) return;
    if (sessionId === message.sessionId && self?.id === message.self.id) {
      self = normalizePeople([message.self])[0];
      updateRoster(message.participants);
      sync();
      return;
    }
    stopHosting();
    sessionId = message.sessionId;
    pendingSync = null;
    self = normalizePeople([message.self])[0];
    participants = nextParticipants;
    hostId = participants[0].id;
    view = null;
    connected = false;
    acceptedHostId = null;
    timerEndsAt = null;
    if (isHost()) {
      const saved = restore();
      if (saved) commit(applyRoster(saved, ids(), random));
      else beginRecovery();
    } else {
      notice = restingNotice();
      emit();
    }
    if (earlyParticipants) {
      const pending = earlyParticipants;
      earlyParticipants = null;
      updateRoster(pending);
    }
    sync();
  }

  function sync() {
    if (destroyed || !self || !isMember(self.id)) return;
    if (isHost()) publish();
    else {
      pendingSync = token();
      transmit('sync', { requestId: pendingSync }, hostId === null ? undefined : [hostId]);
    }
  }

  function nextRoundRemaining(snapshot = view) {
    return snapshot?.nextRoundAt == null ? null : Math.max(0, snapshot.nextRoundAt - now());
  }

  /** Hosts and guests may have different wall clocks; exchange the time left. */
  function localizeNextRound(snapshot, remaining) {
    if (snapshot.nextRoundAt === null) return snapshot;
    const left = Number.isFinite(remaining) && remaining >= 0
      ? Math.min(remaining, NEXT_ROUND_DELAY_MS)
      : Math.min(Math.max(0, snapshot.nextRoundAt - now()), NEXT_ROUND_DELAY_MS);
    let deadline = now() + left;
    if (view?.nextRoundAt !== null && view?.nextRoundAt !== undefined
      && snapshot.round === view.round && snapshot.turnNo === view.turnNo) {
      // Repeated or delayed snapshots cannot restart the same countdown.
      deadline = Math.min(deadline, view.nextRoundAt);
    }
    return { ...snapshot, nextRoundAt: deadline };
  }

  function receiveState(from, data) {
    const incoming = migrateSnapshot(data.view);
    if (isHost() || from !== hostId || !Array.isArray(data.members) ||
        JSON.stringify(data.members) !== JSON.stringify(ids()) || !isValidView(incoming, ids(), self.id)) return;
    const requested = pendingSync !== null && data.replyTo === pendingSync;
    if (acceptedHostId === hostId && !requested && view && data.view.revision < view.revision) {
      // A fresh request tells a reloaded coordinator apart from delayed old packets.
      sync();
      return;
    }
    view = clone(localizeNextRound(incoming, data.nextRoundRemainingMs));
    const remaining = data.remainingMs;
    timerEndsAt = Number.isFinite(remaining) && remaining >= 0 ? now() + Math.min(remaining, MAX_TIMER_MS) : null;
    pendingSync = null;
    acceptedHostId = hostId;
    connected = true;
    notice = restingNotice();
    emit();
  }

  function receive(from, data) {
    if (destroyed || !self || !isMember(self.id) || !isMember(from) || !data || typeof data !== 'object' ||
        data.protocol !== GAME_PROTOCOL || data.sessionId !== sessionId || data.hostId !== hostId) return;
    switch (data.kind) {
      case 'state':
        receiveState(from, data);
        break;
      case 'sync':
        if (isHost() && validToken(data.requestId)) publish([from], data.requestId);
        break;
      case 'action':
        if (!isHost() || !table || recovery) return;
        if (!commit(applyAction(table, from, data.action, { hostId, memberIds: ids(), random, now }))) publish([from]);
        break;
      case 'recover':
        if (isHost() || from !== hostId || !validToken(data.requestId)) return;
        transmit('report', {
          requestId: data.requestId, view: view && isValidView(view, null, self.id) ? view : null,
          nextRoundRemainingMs: nextRoundRemaining(),
        }, [hostId]);
        break;
      case 'report': {
        if (!isHost() || !recovery || data.requestId !== recovery.requestId) return;
        const reported = migrateSnapshot(data.view);
        recovery.reports.set(from, reported !== null && isValidView(reported, null, from)
          ? clone(localizeNextRound(reported, data.nextRoundRemainingMs)) : null);
        maybeFinishRecovery();
        break;
      }
      default:
        break;
    }
  }

  function act(action) {
    if (destroyed || !self || !connected || !isMember(self.id) || !action || typeof action !== 'object') return;
    if (isHost()) {
      if (!table || recovery) return;
      if (!commit(applyAction(table, self.id, action, { hostId, memberIds: ids(), random, now }))) emit();
    } else {
      transmit('action', { action }, [hostId]);
    }
  }

  return {
    init,
    setParticipants: updateRoster,
    receive,
    act,
    sync,
    destroy() {
      destroyed = true;
      stopHosting();
    },
  };
}
