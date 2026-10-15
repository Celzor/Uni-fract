import test from 'node:test';
import assert from 'node:assert/strict';
import { DECK_SIZE } from '../src/cards.js';
import { choicesFor, isValidTable } from '../src/rules.js';
import { GAME_PROTOCOL, RECOVERY_WINDOW_MS, createSession } from '../src/session.js';
import { fakeTimers, seeded } from './helpers.js';

const person = (id) => ({ id, name: `Player ${id}`, avatarUrl: null });
const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
};

/** An in-memory Refract relay: no echo, optional recipients, roster updates. */
function network(initialIds = [1, 2, 3], { persistence = true, settings = { turnTimer: 0 } } = {}) {
  const clients = new Map();
  const queue = [];
  const sent = [];
  const stores = new Map();
  const timers = fakeTimers();
  let memberIds = [...initialIds];
  let sessionId = 'test-session';
  let seed = 10;

  function add(id) {
    if (!stores.has(id)) stores.set(id, memoryStorage());
    const client = { view: null };
    seed += 1;
    client.session = createSession({
      storage: persistence ? stores.get(id) : null,
      random: seeded(seed),
      now: timers.now,
      timers,
      send(data, to) {
        const message = { from: id, data: structuredClone(data), to };
        queue.push(message);
        sent.push(message);
      },
      onChange(view) { client.view = view; },
    });
    clients.set(id, client);
    return client;
  }

  function init(id) {
    clients.get(id).session.init({ sessionId, self: person(id), participants: memberIds.map(person) });
  }

  function flush() {
    for (let count = 0; queue.length; count += 1) {
      assert.ok(count < 5000, 'message exchange must settle');
      const { from, data, to } = queue.shift();
      for (const [id, client] of clients) {
        if (id !== from && (!to || to.includes(id)) && memberIds.includes(id)) client.session.receive(from, structuredClone(data));
      }
    }
  }

  function settle(ms = RECOVERY_WINDOW_MS + 100) {
    flush();
    timers.advance(ms);
    flush();
  }

  for (const id of initialIds) add(id);
  for (const id of initialIds) init(id);
  settle();

  const net = {
    clients, sent, queue, timers, stores, flush, settle, init,
    get members() { return memberIds; },
    view: (id) => clients.get(id).view,
    game: (id) => clients.get(id).view.view,
    act(id, action) {
      const game = clients.get(id).view.view;
      clients.get(id).session.act({ seq: game.turnSeq, ...action });
      flush();
    },
    join(id) {
      memberIds.push(id);
      for (const client of clients.values()) client.session.setParticipants(memberIds.map(person));
      add(id);
      init(id);
      flush();
    },
    leave(id) {
      clients.get(id).session.destroy();
      clients.delete(id);
      memberIds = memberIds.filter((member) => member !== id);
      for (const client of clients.values()) client.session.setParticipants(memberIds.map(person));
      flush();
    },
    reload(id) {
      clients.get(id).session.destroy();
      add(id);
      init(id);
      flush();
    },
    newSession() {
      sessionId = 'new-session';
      for (const id of memberIds) init(id);
      settle();
    },
    hostTable() {
      const raw = stores.get(memberIds[0]).values.get(`${GAME_PROTOCOL}:${JSON.stringify([sessionId, memberIds[0]])}`);
      return JSON.parse(raw).table;
    },
    packet(kind, extra = {}) {
      return { protocol: GAME_PROTOCOL, sessionId, hostId: memberIds[0], kind, ...extra };
    },
    assertConverged() {
      const host = clients.get(memberIds[0]).view;
      for (const [id, client] of clients) {
        assert.equal(client.view.connected, true, `${id} connected`);
        assert.equal(client.view.hostId, memberIds[0]);
        const mine = client.view.view;
        for (const key of ['phase', 'round', 'revision', 'current', 'counts', 'discard', 'color', 'pendingDraw', 'scores', 'seats']) {
          assert.deepEqual(mine[key], host.view[key], `${id} agrees on ${key}`);
        }
      }
      // Every card is somewhere, exactly once.
      const total = host.view.phase === 'playing'
        ? host.view.counts.reduce((sum, count) => sum + count, 0) + host.view.drawCount + host.view.discardCount : DECK_SIZE;
      assert.equal(total, DECK_SIZE);
    },
  };
  if (settings) {
    net.act(memberIds[0], { type: 'settings', settings });
  }
  return net;
}

const deal = (net) => net.act(net.members[0], { type: 'deal' });
/** Have whoever is on turn take one sensible action. */
function playTurn(net) {
  const current = net.game(net.members[0]).current;
  const game = net.game(current);
  const choices = choicesFor(game, current, game.hand);
  const card = choices.playable.find((value) => !choices.jumpIns.includes(value));
  if (card !== undefined) net.act(current, { type: 'play', card, color: 'r', target: game.seats.find((id) => id !== current) });
  else if (choices.draw) net.act(current, { type: 'draw' });
  else if (choices.keep) net.act(current, { type: 'keep' });
  return current;
}

test('everyone receives the shared table, but only ever their own hand', () => {
  const net = network([1, 2, 3, 4, 5, 6, 7]);
  deal(net);
  net.assertConverged();
  const host = net.hostTable();
  assert.ok(isValidTable(host));
  for (const id of [2, 3, 4, 5, 6]) assert.deepEqual(net.game(id).hand, host.hands[host.seats.indexOf(id)]);
  assert.equal(net.game(7).hand, null, 'the seventh participant watches');
  for (const { data, to } of net.sent.filter((message) => message.data.kind === 'state')) {
    assert.deepEqual(to?.length, 1, 'snapshots are addressed to one participant');
    assert.equal('hands' in data.view, false);
    assert.equal('drawPile' in data.view, false);
    if (data.view.phase === 'playing' && data.view.hand) {
      assert.deepEqual(data.view.hand, host.hands[host.seats.indexOf(to[0])] ?? data.view.hand);
    }
  }
});

test('guests propose moves; the host applies only legal ones', () => {
  const net = network([1, 2, 3]);
  deal(net);
  const before = net.game(1).revision;
  net.act(2, { type: 'draw' });
  net.act(3, { type: 'deal' });
  net.act(2, { type: 'settings', settings: { handSize: 10 } });
  assert.equal(net.game(1).revision, before, 'out-of-turn and non-host actions are refused');
  for (let turn = 0; turn < 12; turn += 1) playTurn(net);
  net.assertConverged();
  assert.ok(net.game(1).revision > before + 6);
});

test('a guest can jump in out of turn', () => {
  const net = network([1, 2, 3]);
  deal(net);
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const game = net.game(1);
    if (game.phase !== 'playing') deal(net);
    const jumper = [2, 3].find((id) => choicesFor(net.game(id), id, net.game(id).hand).jumpIns.length);
    if (jumper) {
      const card = choicesFor(net.game(jumper), jumper, net.game(jumper).hand).jumpIns[0];
      net.act(jumper, { type: 'play', card, color: 'r', target: 1 });
      assert.equal(net.game(1).lastPlay.by, jumper);
      assert.equal(net.game(1).lastPlay.jumpIn, true);
      net.assertConverged();
      return;
    }
    playTurn(net);
  }
  assert.fail('no jump-in opportunity arose');
});

test('stale and malformed packets never change the game', () => {
  const net = network([1, 2, 3]);
  deal(net);
  const host = net.clients.get(1).session;
  const guest = net.clients.get(2).session;
  const revision = net.game(1).revision;
  const valid = net.packet('state', { members: [1, 2, 3], view: net.game(2) });
  for (const packet of [null, {}, net.packet('action', { action: null }), net.packet('action', { action: { type: 'deal' } }),
    { ...net.packet('action', { action: { type: 'draw', seq: net.game(1).turnSeq } }), sessionId: 'old' },
    { ...net.packet('action', { action: { type: 'draw', seq: net.game(1).turnSeq } }), protocol: 'other/1' }]) {
    host.receive(2, packet);
  }
  net.flush();
  assert.equal(net.game(1).revision, revision);
  const before = structuredClone(net.game(2));
  for (const packet of [{ ...valid, members: [1, 2] }, { ...valid, view: { ...valid.view, hand: [0, 1, 2] } },
    { ...valid, view: { ...valid.view, counts: [] } }, { ...valid, sessionId: 'wrong' }]) guest.receive(1, packet);
  guest.receive(3, valid);
  assert.deepEqual(net.game(2), before);
  net.assertConverged();
});

test('late joiners watch the round in progress and are seated for the next one', () => {
  const net = network([1, 2]);
  deal(net);
  net.join(3);
  assert.equal(net.game(3).hand, null);
  assert.deepEqual(net.game(3).seats, [1, 2]);
  net.assertConverged();
  net.leave(2);
  assert.deepEqual(net.game(1).seats, [1, 3], 'a watcher takes over a departed player’s hand');
  assert.equal(net.game(3).hand.length, net.game(3).counts[1]);
  net.assertConverged();
});

test('guest and host reloads recover the same table', () => {
  const net = network([1, 2, 3]);
  deal(net);
  for (let turn = 0; turn < 5; turn += 1) playTurn(net);
  const hand = net.game(2).hand;
  net.reload(2);
  assert.deepEqual(net.game(2).hand, hand);
  const table = net.hostTable();
  net.reload(1);
  net.settle();
  assert.deepEqual(net.hostTable().hands, table.hands, 'the host restores from its own storage');
  net.assertConverged();
  playTurn(net);
  net.assertConverged();
});

test('when the host leaves, the next participant rebuilds the table from everyone’s hands', () => {
  const net = network([1, 2, 3, 4]);
  deal(net);
  for (let turn = 0; turn < 6; turn += 1) playTurn(net);
  const hands = new Map([2, 3, 4].map((id) => [id, net.game(id).hand]));
  const scores = net.game(2).scores;
  net.leave(1);
  net.settle();
  assert.equal(net.view(2).isHost, true);
  assert.equal(net.view(2).recovering, false);
  const table = net.hostTable();
  assert.ok(isValidTable(table));
  assert.ok(table.log.some((entry) => entry.k === 'recover'));
  for (const [id, hand] of hands) {
    assert.deepEqual(net.game(id).hand, hand, `player ${id} keeps their exact hand`);
  }
  assert.deepEqual(table.seats, [2, 3, 4]);
  assert.deepEqual(net.game(3).scores, scores);
  net.assertConverged();
  for (let turn = 0; turn < 6; turn += 1) playTurn(net);
  net.assertConverged();
});

test('a host that reloads without storage recovers the round from its guests', () => {
  const net = network([1, 2, 3], { persistence: false });
  deal(net);
  for (let turn = 0; turn < 4; turn += 1) playTurn(net);
  const hands = new Map([1, 2, 3].map((id) => [id, net.game(id).hand]));
  const revision = net.game(2).revision;
  net.reload(1);
  net.settle();
  assert.equal(net.game(1).phase, 'playing');
  assert.ok(net.game(1).revision > revision);
  for (const id of [2, 3]) assert.deepEqual(net.game(id).hand, hands.get(id));
  assert.equal(net.game(1).hand.length, hands.get(1).length, 'the host’s lost hand is re-dealt at its size');
  net.assertConverged();
});

test('the host’s turn timer draws for an idle player and everyone sees the countdown', () => {
  const net = network([1, 2, 3], { settings: { turnTimer: 10 } });
  deal(net);
  const idle = net.game(1).current;
  const count = net.game(1).counts[net.game(1).seats.indexOf(idle)];
  const guest = net.view(2);
  assert.ok(guest.timerEndsAt > net.timers.now() + 9000 && guest.timerEndsAt <= net.timers.now() + 10000);
  net.timers.advance(10001);
  net.flush();
  const game = net.game(2);
  assert.notEqual(game.current, idle);
  assert.ok(game.log.some((entry) => entry.k === 'timeout' && entry.by === idle));
  assert.ok(game.counts[game.seats.indexOf(idle)] >= count + 1 || game.discard.length > 1);
  net.assertConverged();
});

test('only seated players can deal the next round and only the host changes the rules', () => {
  const net = network([1, 2, 3]);
  deal(net);
  const host = net.clients.get(1).session;
  // Finish the round quickly by letting players run out.
  for (let turn = 0; turn < 3000 && net.game(1).phase === 'playing'; turn += 1) playTurn(net);
  assert.equal(net.game(1).phase, 'roundOver');
  net.join(4);
  assert.deepEqual(net.game(4).seats, [1, 2, 3, 4], 'newcomers are seated for the next round');
  net.act(4, { type: 'seat', watch: true });
  assert.deepEqual(net.game(1).seats, [1, 2, 3]);
  net.act(4, { type: 'deal' });
  assert.equal(net.game(1).phase, 'roundOver', 'watchers cannot deal');
  net.act(4, { type: 'seat', watch: false });
  net.act(2, { type: 'settings', settings: { stacking: 'off' } });
  assert.equal(net.game(1).settings.stacking, 'same');
  host.act({ type: 'settings', settings: { stacking: 'off' } });
  net.flush();
  assert.equal(net.game(3).settings.stacking, 'off');
  net.act(2, { type: 'deal' });
  assert.equal(net.game(1).phase, 'playing');
  assert.deepEqual(net.game(1).seats, [1, 2, 3, 4]);
  net.assertConverged();
});

/** People act when it is their turn; the host's bots act on their own as time passes. */
function playWithBots(net) {
  const current = net.game(net.members[0]).current;
  if (current > 0) playTurn(net);
  net.timers.advance(400);
  net.flush();
}

test('someone alone in a call can play a whole round against host-run bots', () => {
  const net = network([1], { settings: { turnTimer: 0, bots: 2 } });
  assert.deepEqual(net.game(1).seats, [1, -1, -2]);
  deal(net);
  assert.equal(net.game(1).phase, 'playing');
  for (let tick = 0; tick < 4000 && net.game(1).phase === 'playing'; tick += 1) playWithBots(net);
  assert.equal(net.game(1).phase, 'roundOver');
  assert.ok(net.game(1).log.some((entry) => entry.by < 0), 'the bots took turns');
  assert.ok(isValidTable(net.hostTable()));
});

test('guests see the bots, and a new host keeps playing them after the host leaves', () => {
  const net = network([1, 2, 3], { settings: { turnTimer: 0, bots: 1 } });
  assert.deepEqual(net.game(2).seats, [1, 2, 3, -1], 'guests see the bot’s seat');
  deal(net);
  for (let tick = 0; tick < 12; tick += 1) playWithBots(net);
  net.leave(1);
  net.settle();
  assert.equal(net.view(2).isHost, true);
  assert.ok(net.game(3).seats.includes(-1), 'the bot keeps its seat');
  net.assertConverged();
  const before = Math.max(...net.game(2).log.map((entry) => entry.n));
  let botMoved = false;
  for (let tick = 0; tick < 300 && !botMoved && net.game(2).phase === 'playing'; tick += 1) {
    playWithBots(net);
    botMoved = net.game(2).log.some((entry) => entry.n > before && entry.by === -1);
  }
  assert.ok(botMoved, 'the new host plays the bot');
  net.assertConverged();
});

test('a new activity session starts from a fresh lobby', () => {
  const net = network([1, 2]);
  deal(net);
  playTurn(net);
  net.newSession();
  assert.equal(net.game(1).phase, 'lobby');
  assert.equal(net.game(2).phase, 'lobby');
  net.assertConverged();
});

test('roster events before init are buffered, and destroy stops all work', () => {
  let view;
  const sent = [];
  const timers = fakeTimers();
  const session = createSession({ storage: null, timers, now: timers.now, send: (packet) => sent.push(packet), onChange: (next) => { view = next; } });
  session.setParticipants([person(1), person(2), person(3)]);
  session.init({ sessionId: 'a', self: person(1), participants: [person(1), person(2)] });
  assert.equal(view.participants.length, 3);
  timers.advance(RECOVERY_WINDOW_MS + 10);
  assert.equal(view.connected, true);
  const before = sent.length;
  session.destroy();
  session.act({ type: 'deal' });
  session.sync();
  session.init({ sessionId: 'b', self: person(1), participants: [person(1), person(2)] });
  timers.advance(60000);
  assert.equal(sent.length, before);
});

test('unavailable or corrupt storage never prevents a live game', () => {
  for (const storage of [
    { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } },
    { getItem() { return '{not json'; }, setItem() {} },
    { getItem() { return JSON.stringify({ table: {}, members: [1, 2], hostId: 1 }); }, setItem() {} },
  ]) {
    let view;
    const timers = fakeTimers();
    const session = createSession({ storage, timers, now: timers.now, send() {}, onChange: (next) => { view = next; } });
    session.init({ sessionId: 'a', self: person(1), participants: [person(1), person(2)] });
    timers.advance(RECOVERY_WINDOW_MS + 10);
    session.act({ type: 'deal' });
    assert.equal(view.view.phase, 'playing');
  }
});
