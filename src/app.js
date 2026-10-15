import { connectActivity } from './bridge.js';
import { createGameAudio } from './audio.js';
import { createAvatar } from './avatars.js';
import { createTableEffects } from './effects.js';
import { COLOR_NAMES, cardImage, cardName, colorOf, isWild, rankName, rankOf, sortHand } from './cards.js';
import { createLocalGame } from './local.js';
import { MAX_BOTS, MAX_PLAYERS, MIN_PLAYERS, botName, choicesFor, isBotId, topCard } from './rules.js';
import { createSession } from './session.js';

const $ = (id) => document.getElementById(id);
const embedded = window.parent !== window || new URLSearchParams(location.search).get('embedded') === '1';
const SOUND_KEY = 'uni-refract:sound';
const TIMER_CIRCUMFERENCE = 97.4;
// Walk around the table from the viewer's left, preserving the seat order.
const SEAT_POSITIONS = [
  [], ['north'], ['west', 'east'], ['west', 'north', 'east'],
  ['west', 'north-west', 'north-east', 'east'],
  ['west', 'north-west', 'north', 'north-east', 'east'],
  ['south-west', 'west', 'north-west', 'north-east', 'east', 'south-east'],
];

// Names seen this session, so the table talk can still name players who left.
const names = new Map();
const cardButtons = new Map();
let live = null;
let bridge = null;
let refractOrigin = null;
let controller = null;
let handshakeTimer = null;
let retryTimer = null;
let tickTimer = null;
let pendingChoice = null;
let audioSessionKey = null;
let lastTopKey = null;
let soundOn = readSoundPreference();
const gameAudio = createGameAudio({ enabled: soundOn });
const tableEffects = createTableEffects();

document.body.classList.toggle('embedded', embedded);
$('call-banner').hidden = embedded;
if (embedded) {
  $('connection').dataset.state = 'waiting';
  $('connection-label').textContent = 'Connecting to Refract';
} else if (matchMedia('(prefers-color-scheme: light)').matches) {
  document.documentElement.dataset.theme = 'light';
}

function readSoundPreference() {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const me = () => live?.self?.id ?? null;
const isMe = (id) => id !== null && id === me();
const nameOf = (id) => {
  if (isMe(id)) return 'You';
  return isBotId(id) ? botName(id) : names.get(id) ?? 'A player';
};
const avatarFor = (id) => createAvatar({
  name: isBotId(id) ? botName(id).replace(/^Al /, '') : nameOf(id),
  avatarUrl: live?.participants?.find((person) => person.id === id)?.avatarUrl,
}, refractOrigin);
const objectName = (id) => (isMe(id) ? 'you' : nameOf(id));
const possessive = (id) => (isMe(id) ? 'Your' : `${nameOf(id)}’s`);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function chip(card, color) {
  const element = node('span', 'card-chip', cardName(card));
  element.dataset.color = color ?? colorOf(card) ?? 'w';
  return element;
}

function bold(text) {
  return node('b', '', text);
}

/** One line of table talk. Names are inserted as text, never as markup. */
function describe(entry) {
  const who = (id) => bold(nameOf(id));
  const whom = (id) => bold(objectName(id));
  switch (entry.k) {
    case 'deal': return [`Round ${entry.round} dealt. `, who(entry.by), isMe(entry.by) ? ' go first.' : ' goes first.'];
    case 'play': return [who(entry.by), entry.jump ? ' jumped in with ' : ' played ', chip(entry.card, entry.color), entry.color ? ` → ${COLOR_NAMES[entry.color]}` : ''];
    case 'draw': return entry.n ? [who(entry.by), ` drew ${entry.n === 1 ? 'a card' : `${entry.n} cards`}`] : [who(entry.by), ' found the deck empty'];
    case 'take': return [who(entry.by), ` took +${entry.n}`];
    case 'keep': return [who(entry.by), ' kept the drawn card'];
    case 'challenge': return entry.won
      ? [who(entry.by), ' called ', bold(isMe(entry.target) ? 'your' : `${nameOf(entry.target)}’s`), ' bluff! ', who(entry.target), ` drew ${entry.n}`]
      : [who(entry.by), ' challenged ', whom(entry.target), ` and lost: +${entry.n}`];
    case 'call': return [who(entry.by), ' shouted ', bold('“Oh no!”')];
    case 'catch': return [who(entry.by), ' caught ', whom(entry.target), ` without a call: +${entry.n}`];
    case 'timeout': return [who(entry.by), ' ran out of time'];
    case 'swap': return [who(entry.by), ' swapped hands with ', whom(entry.target)];
    case 'rotate': return ['Every hand moved along'];
    case 'reshuffle': return ['The discards were shuffled into a fresh deck'];
    case 'left': return [who(entry.by), ' left the table'];
    case 'sub': return [who(entry.by), ' took over the empty seat'];
    case 'abandon': return ['Not enough players. Back to the lobby.'];
    case 'win': return [who(entry.by), ` won the round · +${entry.points}`];
    case 'recover': return ['The table was rebuilt after a host change'];
    default: return ['Something happened'];
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const before = tableEffects.capture();
  for (const person of live?.participants ?? []) names.set(person.id, person.name);
  const view = live?.view ?? null;
  const atTable = !!view && view.phase !== 'lobby';
  $('lobby').hidden = atTable;
  $('table').hidden = !atTable;
  renderConnection();
  if (atTable) renderTable(view);
  else renderLobby(view);
  renderNotice();
  closeStaleChoice(view);
  gameAudio.update(view, me());
  tableEffects.update(view, me(), before);
  scheduleTick();
}

function renderConnection() {
  const ready = !embedded || !!live?.connected;
  let label = 'Local practice';
  if (embedded) {
    if (live?.recovering) label = 'Gathering the cards';
    else if (ready) label = 'Connected to Refract';
    else label = live ? 'Syncing with Refract' : 'Waiting for Refract';
  }
  $('connection-label').textContent = label;
  $('connection').dataset.state = ready ? 'connected' : 'waiting';
  $('sound').textContent = soundOn ? 'Sound on' : 'Sound off';
  $('sound').setAttribute('aria-pressed', String(soundOn));
  $('refract-lobby-tools').hidden = !embedded;
  $('refract-table-tools').hidden = !embedded;
}

function renderNotice() {
  const text = live?.notice ?? '';
  if (live) {
    $('notice').textContent = text;
    $('notice').hidden = !text;
  }
}

function renderLobby(view) {
  const self = me();
  const people = live?.participants ?? [];
  const seats = view?.seats ?? [];
  const list = $('seat-list');
  const rows = seats.map((id) => {
    const row = node('li', 'seat-row');
    row.append(avatarFor(id), node('strong', '', names.get(id) ?? nameOf(id)));
    const tags = node('span', 'tags');
    if (isMe(id) && names.get(id) !== 'You') tags.append(node('span', 'tag you', 'You'));
    if (id === live?.hostId && embedded) tags.append(node('span', 'tag', 'Host'));
    if (isBotId(id)) tags.append(node('span', 'tag', 'Bot'));
    if (view?.scores?.[id]) tags.append(node('span', 'tag', `${view.scores[id]} pts`));
    row.append(tags);
    return row;
  });
  if (seats.length < MAX_PLAYERS) {
    const open = node('li', 'seat-row empty');
    open.append(node('span', '', embedded ? 'Open seat · invite someone from your call' : 'Open seat'));
    // The host can fill the seat right here, as well as from the house rules.
    if (canEditRules(view) && view.settings.bots < MAX_BOTS) {
      const add = node('button', 'text-button', 'Add a computer player');
      add.type = 'button';
      add.addEventListener('click', () => send({ type: 'settings', settings: { bots: view.settings.bots + 1 } }));
      open.append(add);
    }
    rows.push(open);
  }
  list.replaceChildren(...rows);
  $('seat-count').textContent = `${seats.length} / ${MAX_PLAYERS} SEATS`;

  const watching = people.filter((person) => !seats.includes(person.id));
  $('watchers').hidden = watching.length === 0;
  $('watchers').textContent = `Watching · ${watching.map((person) => (isMe(person.id) ? 'You' : person.name)).join(', ')}`;

  const toggle = $('seat-toggle');
  toggle.hidden = !view || self === null;
  if (view && self !== null) {
    const sittingOut = view.sittingOut.includes(self);
    const seated = seats.includes(self);
    toggle.disabled = !seated && !sittingOut;
    toggle.textContent = seated ? 'Sit out and watch' : sittingOut ? 'Take a seat' : 'The table is full';
  }

  renderSettings(view);
  const host = !!live?.isHost && !!live?.connected;
  const enough = seats.length >= MIN_PLAYERS;
  const deal = $('deal');
  deal.disabled = !host || !enough || !view;
  deal.firstChild.textContent = host ? 'Deal the cards ' : 'Waiting for the host ';
  let note;
  if (!view) note = embedded ? 'Connecting to your call…' : 'Setting up the table…';
  else if (!enough) note = embedded ? 'You need at least two players. Invite someone from your call, or add computer players.' : 'Add a computer player to start.';
  else if (view.matchWinner !== null) note = `${nameOf(view.matchWinner)} won the last match. The next deal starts a new one.`;
  else if (host) note = `${plural(seats.length, 'player')} ready. Deal when you’re set.`;
  else note = `${nameOf(live?.hostId)} deals when everyone’s ready.`;
  $('lobby-note').textContent = note;
}

const canEditRules = (view) => !!view && !!live?.isHost && !!live?.connected && view.phase !== 'playing';

function renderSettings(view) {
  const form = $('settings');
  const editable = canEditRules(view);
  $('rules-owner').textContent = editable ? 'YOU DECIDE' : 'HOST’S CALL';
  for (const element of form.elements) {
    const value = view?.settings?.[element.name];
    if (value !== undefined && document.activeElement !== element) {
      if (element.type === 'checkbox') element.checked = value === true;
      else element.value = String(value);
    }
    element.disabled = !editable;
  }
}

function readSettings() {
  const settings = {};
  for (const element of $('settings').elements) {
    if (!element.name) continue;
    if (element.type === 'checkbox') settings[element.name] = element.checked;
    else settings[element.name] = /^\d+$/.test(element.value) ? Number(element.value) : element.value;
  }
  return settings;
}

function renderTable(view) {
  const self = me();
  const seated = view.seats.includes(self);
  const choices = choicesFor(view, self, view.hand);
  const myTurn = view.phase === 'playing' && view.current === self;
  const over = view.phase === 'roundOver';
  $('table-arena').classList.toggle('round-over', over);
  const felt = $('felt');
  felt.dataset.color = view.color ?? '';
  felt.classList.toggle('my-turn', myTurn);
  $('play-area').hidden = over;
  $('results').hidden = !over;
  $('round-label').textContent = `ROUND ${view.round}${view.settings.targetScore ? ` · TO ${view.settings.targetScore}` : ''}`;
  $('quit-local').hidden = embedded || over;

  renderSeats(view);
  if (over) renderResults(view);
  else {
    renderPiles(view, choices);
    renderStatus(view, choices, seated);
  }
  renderActions(view, choices);
  renderHand(view, choices, myTurn, seated);
  renderScores(view);
  renderLog(view);
}

function renderSeats(view) {
  const self = me();
  const start = Math.max(0, view.seats.indexOf(self));
  const order = [...view.seats.slice(start), ...view.seats.slice(0, start)];
  const chips = order.map((id) => {
    const index = view.seats.indexOf(id);
    const count = view.counts[index] ?? 0;
    const element = node('div', 'seat-chip');
    element.dataset.playerId = String(id);
    element.classList.toggle('current', view.phase === 'playing' && view.current === id);
    element.classList.toggle('me', isMe(id));
    const avatar = avatarFor(id);
    const copy = node('span', 'seat-copy');
    copy.append(node('strong', '', nameOf(id)));
    const score = view.scores[id] ?? 0;
    const sub = view.phase === 'playing' ? `${plural(count, 'card')} · ${score} pts` : `${score} pts`;
    copy.append(node('span', 'seat-sub', isBotId(id) ? `${sub} · bot` : sub));
    element.append(avatar, copy);
    if (view.phase === 'playing' && !isMe(id)) {
      const fan = node('span', 'mini-fan');
      fan.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < Math.min(count, 9); i += 1) fan.append(node('i'));
      element.append(fan);
    }
    if (view.called.includes(id)) element.append(node('span', 'badge called', 'OH NO!'));
    if (view.exposed === id) element.append(node('span', 'badge exposed', 'NO CALL'));
    element.setAttribute('aria-label', `${nameOf(id)}, ${plural(count, 'card')}, ${score} points${view.current === id ? ', taking a turn' : ''}`);
    return element;
  });
  const ownSeat = chips.find((element) => element.classList.contains('me'));
  const opponents = chips.filter((element) => element !== ownSeat);
  opponents.forEach((element, index) => { element.dataset.position = SEAT_POSITIONS[opponents.length][index]; });
  $('opponents').dataset.seatCount = String(opponents.length);
  $('opponents').replaceChildren(...opponents);
  $('self-seat').hidden = !ownSeat;
  $('self-seat').replaceChildren(...(ownSeat ? [ownSeat] : []));
  $('hand-area').classList.toggle('watching', !ownSeat);
}

function rotationFor(card, top) {
  if (top) return { r: ((card * 7) % 9) - 4, x: 0, y: 0 };
  return { r: ((card * 47) % 31) - 15, x: ((card * 13) % 11) - 5, y: ((card * 5) % 9) - 4 };
}

function renderPiles(view, choices) {
  const drawPile = $('draw-pile');
  drawPile.disabled = !choices.draw;
  drawPile.setAttribute('aria-label', choices.draw ? (view.pendingDraw ? `Take ${view.pendingDraw} cards` : 'Draw a card') : `Draw pile, ${plural(view.drawCount, 'card')}`);
  $('draw-count').textContent = `${view.drawCount} left`;

  const top = topCard(view);
  const topKey = `${view.round}:${view.discardCount}:${top}`;
  const cards = view.discard.slice(-4).map((card, index, shown) => {
    const isTop = index === shown.length - 1;
    const element = node('div', 'pile-card');
    const { r, x, y } = rotationFor(card, isTop);
    element.style.setProperty('--r', `${r}deg`);
    element.style.setProperty('--x', `${x}px`);
    element.style.setProperty('--y', `${y}px`);
    const image = node('img');
    image.src = cardImage(card);
    image.alt = isTop ? `Top card: ${cardName(card)}${isWild(card) ? `, ${COLOR_NAMES[view.color]} chosen` : ''}` : '';
    element.append(image);
    if (isTop && isWild(card) && view.color) {
      const band = node('span', 'chosen');
      band.dataset.color = view.color;
      element.append(band);
    }
    if (isTop && topKey !== lastTopKey && lastTopKey !== null) element.classList.add('landed');
    return element;
  });
  $('discard').replaceChildren(...cards);
  lastTopKey = topKey;

  $('active-color-label').textContent = view.color ? COLOR_NAMES[view.color] : '—';
  $('direction').dataset.direction = String(view.direction);
  $('direction-label').textContent = view.direction === 1 ? 'Clockwise' : 'Counter-clockwise';
  $('pending').hidden = !view.pendingDraw;
  $('pending').textContent = `+${view.pendingDraw} incoming`;
}

function renderStatus(view, choices, seated) {
  const self = me();
  const top = topCard(view);
  const ownMoves = choices.playable.filter((card) => !choices.jumpIns.includes(card));
  let status;
  let detail;
  if (view.current === self) {
    if (view.pendingDraw > 0) {
      if (!ownMoves.length && !choices.challenge) {
        status = `No card to stack — taking +${view.pendingDraw}…`;
        detail = 'The cards are coming to you automatically.';
      } else {
        status = `+${view.pendingDraw} coming your way!`;
        const options = [];
        if (ownMoves.length) options.push('stack a draw card to pass it on');
        if (choices.challenge) options.push('challenge the Wild Draw Four');
        options.push(`take the ${view.pendingDraw}`);
        detail = options.join(', or ').replace(/^./, (letter) => letter.toUpperCase()) + '.';
      }
    } else if (view.stage === 'drawn') {
      status = `You drew ${cardName(view.drawnCard)}.`;
      detail = choices.keep ? 'Play it now, or keep it and end your turn.' : 'Forced play: this one has to go down.';
    } else {
      status = ownMoves.length ? 'Your turn' : 'No playable cards — drawing…';
      const match = isWild(top) ? COLOR_NAMES[view.color] : `${COLOR_NAMES[view.color]} or ${rankName(top)}`;
      detail = ownMoves.length ? `Match ${match}, or play a wild.`
        : view.settings.drawToMatch ? 'Drawing until something matches.' : 'Taking a card from the pile automatically.';
    }
  } else {
    const current = view.current;
    if (view.pendingDraw > 0) status = `${nameOf(current)} is facing +${view.pendingDraw}`;
    else if (view.stage === 'drawn') status = `${nameOf(current)} drew a card…`;
    else status = `${possessive(current)} turn`;
    if (!seated) detail = 'You’re watching. You’ll be dealt in next round.';
    else if (choices.catch) detail = `${nameOf(view.exposed)} forgot to shout “Oh no!” Catch them before the next move.`;
    else if (choices.jumpIns.length) detail = 'You hold an identical card. Jump in!';
    else if (view.settings.jumpIn) detail = 'Hold an identical card? You can jump in out of turn.';
    else detail = 'Hang tight. Your turn is coming.';
  }
  $('status').textContent = status;
  $('status-detail').textContent = detail;
}

function renderActions(view, choices) {
  const over = view.phase !== 'playing';
  $('call-button').hidden = over || !choices.call;
  $('catch-button').hidden = over || !choices.catch;
  $('catch-button').textContent = choices.catch ? `Catch ${nameOf(view.exposed)}!` : 'Catch!';
  $('challenge-button').hidden = over || !choices.challenge;
  $('keep-button').hidden = over || !choices.keep;
  $('draw-button').hidden = over || !choices.draw;
  $('draw-button').textContent = view.pendingDraw ? `Take +${view.pendingDraw}` : 'Draw a card';
}

function renderHand(view, choices, myTurn, seated) {
  const container = $('hand');
  container.classList.toggle('my-turn', myTurn);
  const hand = view.hand ? sortHand(view.hand) : [];
  const buttons = hand.map((card) => {
    let button = cardButtons.get(card);
    if (!button) {
      button = node('button', 'card');
      button.dataset.card = String(card);
      button.type = 'button';
      const image = node('img');
      image.src = cardImage(card);
      image.alt = '';
      image.draggable = false;
      button.append(image);
      button.addEventListener('click', () => playCard(card));
      cardButtons.set(card, button);
    }
    const jump = choices.jumpIns.includes(card);
    const playable = choices.playable.includes(card);
    button.classList.toggle('playable', playable && !jump);
    button.classList.toggle('jump', jump);
    button.classList.toggle('drawn', view.drawnCard === card);
    button.disabled = !playable;
    button.setAttribute('aria-label', `${cardName(card)}${jump ? ', jump in' : playable ? ', playable' : ''}`);
    return button;
  });
  if (!buttons.length) {
    const text = view.phase === 'roundOver' ? '' : seated ? 'No cards left!' : 'You’re watching this round.';
    container.replaceChildren(node('span', 'hand-empty', text));
  } else {
    container.replaceChildren(...buttons);
  }
  $('my-label').textContent = seated ? 'Your hand' : 'Spectating';
  $('my-badge').hidden = !view.called.includes(me());
  $('my-count').textContent = hand.length ? plural(hand.length, 'card').toUpperCase() : '';
  fitHand();
}

/** Overlap cards just enough to keep the whole hand on screen. */
function fitHand() {
  const container = $('hand');
  const cards = container.querySelectorAll('.card');
  if (cards.length < 2 || container.clientWidth === 0) {
    container.style.setProperty('--overlap', '0px');
    return;
  }
  const width = cards[0].getBoundingClientRect().width;
  const available = container.clientWidth - 16;
  const gap = 6;
  const needed = cards.length * width + (cards.length - 1) * gap;
  const overlap = needed <= available ? -gap : Math.min(width * 0.8, (cards.length * width - available) / (cards.length - 1));
  container.style.setProperty('--overlap', `${overlap}px`);
}

function renderScores(view) {
  const ids = new Set([...view.seats, ...Object.keys(view.scores).map(Number)]);
  const rows = [...ids].map((id) => ({ id, score: view.scores[id] ?? 0 })).sort((a, b) => b.score - a.score);
  const lead = rows[0]?.score ?? 0;
  $('scores').replaceChildren(...rows.map(({ id, score }) => {
    const item = node('li', score > 0 && score === lead ? 'lead' : '');
    item.append(node('span', '', nameOf(id)), node('strong', '', String(score)));
    return item;
  }));
}

function renderLog(view) {
  const log = $('log');
  log.replaceChildren(...view.log.map((entry) => {
    const item = node('li');
    item.append(...describe(entry));
    return item;
  }));
  log.scrollTop = log.scrollHeight;
}

function renderResults(view) {
  const winner = view.winner;
  const match = view.matchWinner !== null;
  $('results-eyebrow').textContent = match ? 'MATCH COMPLETE' : `ROUND ${view.round} COMPLETE`;
  $('results-title').textContent = isMe(winner)
    ? `You win the ${match ? 'match' : 'round'}!`
    : `${nameOf(winner)} wins the ${match ? 'match' : 'round'}!`;
  $('results-detail').textContent = `+${view.roundPoints} points from the cards left in everyone else’s hands.${match ? ` First to ${view.settings.targetScore}.` : ''}`;
  $('reveal').replaceChildren(...view.reveal.map((entry) => {
    const item = node('li', entry.id === winner ? 'winner' : '');
    const thumbs = node('span', 'thumbs');
    for (const card of sortHand(entry.cards)) {
      const image = node('img');
      image.src = cardImage(card);
      image.alt = cardName(card);
      thumbs.append(image);
    }
    if (!entry.cards.length) thumbs.append(node('span', 'pts', 'Out!'));
    item.append(node('span', 'who', nameOf(entry.id)), thumbs, node('span', 'pts', entry.id === winner ? `+${view.roundPoints}` : `${entry.points} pts`));
    return item;
  }));
  const self = me();
  const canDeal = (!!live?.isHost || view.seats.includes(self)) && view.seats.length >= MIN_PLAYERS;
  const next = $('next-round');
  next.disabled = !canDeal;
  next.firstChild.textContent = match ? 'Start a new match ' : 'Deal next round ';
  $('back-to-lobby').hidden = !live?.isHost;
}

// ---------------------------------------------------------------------------
// Timer, sound, and choices
// ---------------------------------------------------------------------------

function scheduleTick() {
  clearInterval(tickTimer);
  tickTimer = null;
  if (live?.timerEndsAt && live.view?.phase === 'playing') tickTimer = setInterval(updateTimer, 250);
  updateTimer();
}

function updateTimer() {
  const view = live?.view;
  const total = (view?.settings.turnTimer ?? 0) * 1000;
  const show = !!view && view.phase === 'playing' && total > 0 && !!live.timerEndsAt;
  $('timer').hidden = !show;
  const current = document.querySelector('.seat-chip.current');
  current?.classList.toggle('timed', show);
  if (!show) return;
  const remaining = Math.max(0, live.timerEndsAt - Date.now());
  const fraction = Math.min(1, remaining / total);
  $('timer-label').textContent = String(Math.ceil(remaining / 1000));
  $('timer-arc').style.strokeDashoffset = String(TIMER_CIRCUMFERENCE * (1 - fraction));
  $('timer').classList.toggle('urgent', remaining <= 5000);
  current?.style.setProperty('--progress', String(fraction));
  current?.style.setProperty('--timer-color', remaining <= 5000 ? 'var(--orange)' : 'var(--cyan)');
}

function choose(dialog, card) {
  return new Promise((resolve) => {
    pendingChoice = { dialog, card };
    dialog.returnValue = '';
    dialog.addEventListener('close', () => {
      pendingChoice = null;
      resolve(dialog.returnValue || null);
    }, { once: true });
    dialog.showModal();
  });
}

function closeStaleChoice(view) {
  if (!pendingChoice) return;
  const choices = view ? choicesFor(view, me(), view.hand) : null;
  if (!choices?.playable.includes(pendingChoice.card)) pendingChoice.dialog.close('');
}

async function playCard(card) {
  const view = live?.view;
  if (!view || pendingChoice) return;
  const self = me();
  if (!choicesFor(view, self, view.hand).playable.includes(card)) return;
  const action = { type: 'play', card, seq: view.turnSeq };
  if (isWild(card)) {
    const color = await choose($('color-dialog'), card);
    if (!color) return;
    action.color = color;
  }
  if (view.settings.sevenZero && rankOf(card) === '7' && view.hand.length > 1) {
    const list = $('target-list');
    list.replaceChildren(...view.seats.filter((id) => id !== self).map((id) => {
      const button = node('button');
      button.value = String(id);
      button.append(node('strong', '', nameOf(id)), node('span', '', plural(view.counts[view.seats.indexOf(id)], 'card')));
      return button;
    }));
    const target = await choose($('target-dialog'), card);
    if (!target) return;
    action.target = Number(target);
  }
  controller?.act(action);
}

function send(action) {
  const view = live?.view;
  if (view) controller?.act({ seq: view.turnSeq, ...action });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$('draw-pile').addEventListener('click', () => send({ type: 'draw' }));
$('draw-button').addEventListener('click', () => send({ type: 'draw' }));
$('keep-button').addEventListener('click', () => send({ type: 'keep' }));
$('challenge-button').addEventListener('click', () => send({ type: 'challenge' }));
$('call-button').addEventListener('click', () => send({ type: 'call' }));
$('catch-button').addEventListener('click', () => send({ type: 'catch' }));
$('deal').addEventListener('click', () => send({ type: 'deal' }));
$('next-round').addEventListener('click', () => send({ type: 'deal' }));
$('back-to-lobby').addEventListener('click', () => send({ type: 'lobby' }));
$('seat-toggle').addEventListener('click', () => {
  const view = live?.view;
  if (view) send({ type: 'seat', watch: view.seats.includes(me()) });
});
$('settings').addEventListener('change', () => send({ type: 'settings', settings: readSettings() }));
$('settings').addEventListener('submit', (event) => event.preventDefault());
$('quit-local').addEventListener('click', () => controller?.abandon?.());
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  gameAudio.setEnabled(soundOn);
  try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch { /* Preference only. */ }
  renderConnection();
});
for (const button of document.querySelectorAll('[data-action="sync"]')) {
  button.addEventListener('click', () => {
    bridge?.ready();
    controller?.sync?.();
  });
}
for (const button of document.querySelectorAll('[data-action="leave"]')) {
  button.addEventListener('click', () => bridge?.close());
}

// Keyboard shortcuts for quick hands: D draw, O shout "Oh no!", C catch, K keep.
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || pendingChoice) return;
  if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea')) return;
  const view = live?.view;
  if (!view || view.phase !== 'playing') return;
  const choices = choicesFor(view, me(), view.hand);
  const shortcut = { d: choices.draw && 'draw', o: choices.call && 'call', c: choices.catch && 'catch', k: choices.keep && 'keep' }[event.key.toLowerCase()];
  if (shortcut) {
    event.preventDefault();
    send({ type: shortcut });
  }
});
window.addEventListener('resize', fitHand);

if (embedded) {
  const session = createSession({
    send: (data, to) => bridge?.broadcast(data, to),
    onChange(next) {
      live = next;
      render();
    },
  });
  controller = { act: (action) => session.act(action), sync: () => session.sync(), destroy: () => session.destroy() };
  bridge = connectActivity({
    onInit(message, origin) {
      clearTimeout(handshakeTimer);
      refractOrigin = origin;
      const key = JSON.stringify([message.sessionId, message.self.id]);
      if (key !== audioSessionKey) {
        gameAudio.reset();
        tableEffects.reset();
        lastTopKey = null;
        audioSessionKey = key;
      }
      document.documentElement.dataset.theme = message.theme;
      session.init(message);
    },
    onParticipants: (people) => session.setParticipants(people),
    onMessage: (from, data) => session.receive(from, data),
  });
  handshakeTimer = setTimeout(() => {
    if (!live) {
      $('notice').textContent = 'No Refract connection yet. Open this activity from a call, or use Resync to try again.';
      $('notice').hidden = false;
    }
  }, 8000);
  // Refract does not replay messages; periodic snapshots recover anything dropped.
  retryTimer = setInterval(() => {
    if (!live) bridge.ready();
    else session.sync();
  }, 5000);
} else {
  const local = createLocalGame({
    onChange(next) {
      live = next;
      render();
    },
  });
  controller = { act: (action) => local.act(action), abandon: () => local.abandon(), destroy: () => local.destroy() };
  local.start();
}

window.addEventListener('pagehide', () => {
  clearTimeout(handshakeTimer);
  clearInterval(retryTimer);
  clearInterval(tickTimer);
  gameAudio.destroy();
  tableEffects.destroy();
  controller?.destroy();
  bridge?.destroy();
});
// A back/forward-cache restore needs fresh listeners and a fresh handshake.
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
render();
