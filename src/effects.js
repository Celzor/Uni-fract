import { DECK_SIZE, cardImage, rankOf } from './cards.js';

const BACK_IMAGE = 'assets/card-back.svg';
const COLORS = ['#db6149', '#ffd21c', '#72a978', '#1673ed', '#f1e0b7'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const handFor = (view, selfId) => view?.hand ?? view?.reveal?.find((entry) => entry.id === selfId)?.cards ?? [];

function rectOf(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
}

function appendedEntries(previous, current) {
  for (let size = Math.min(previous.length, current.length); size > 0; size -= 1) {
    if (previous.slice(-size).every((entry, index) => JSON.stringify(entry) === JSON.stringify(current[index]))) {
      return current.slice(size);
    }
  }
  return current;
}

/** Decorative only: these animations never delay or submit a game action. */
export function createTableEffects() {
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const nodes = new Set();
  const animations = new Set();
  const timers = new Set();
  const frames = new Set();
  const pulses = new Map();
  let previous = null;
  let lastSeq = 0;
  let destroyed = false;
  let penalty = null;

  const suppressed = () => destroyed || document.hidden || motion?.matches;

  function remove(element) {
    element.remove();
    nodes.delete(element);
    if (penalty === element) penalty = null;
  }

  function later(ms, task) {
    const handle = setTimeout(() => {
      timers.delete(handle);
      if (!suppressed()) task();
    }, ms);
    timers.add(handle);
    return handle;
  }

  function nextFrame(task) {
    const handle = requestAnimationFrame((time) => {
      frames.delete(handle);
      if (!suppressed()) task(time);
    });
    frames.add(handle);
    return handle;
  }

  function animate(element, keyframes, options, done) {
    if (typeof element.animate !== 'function') {
      done?.();
      return null;
    }
    const animation = element.animate(keyframes, options);
    animations.add(animation);
    animation.onfinish = () => {
      animations.delete(animation);
      done?.();
    };
    animation.oncancel = () => animations.delete(animation);
    return animation;
  }

  function decoration(className, x, y) {
    const element = document.createElement('div');
    element.className = className;
    element.setAttribute('aria-hidden', 'true');
    element.style.pointerEvents = 'none';
    element.style.position = 'fixed';
    if (Number.isFinite(x)) element.style.left = `${x}px`;
    if (Number.isFinite(y)) element.style.top = `${y}px`;
    nodes.add(element);
    return element;
  }

  function clear() {
    for (const handle of timers) clearTimeout(handle);
    for (const handle of frames) cancelAnimationFrame(handle);
    timers.clear();
    frames.clear();
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const element of nodes) element.remove();
    nodes.clear();
    penalty = null;
    const felt = document.getElementById('felt');
    felt?.classList.remove('table-impact', 'table-celebrating');
    pulses.clear();
  }

  function reset() {
    clear();
    previous = null;
    lastSeq = 0;
  }

  function onVisibility() {
    if (suppressed()) clear();
  }

  document.addEventListener('visibilitychange', onVisibility);
  motion?.addEventListener('change', onVisibility);

  /** Take every layout reading in a batch, before creating any flight nodes. */
  function capture() {
    if (suppressed()) return null;
    const cards = new Map();
    const cardElements = new Map();
    const seats = new Map();
    for (const element of document.querySelectorAll('.card[data-card]')) {
      const rect = rectOf(element);
      if (!rect) continue;
      const id = Number(element.dataset.card);
      cards.set(id, rect);
      cardElements.set(id, element);
    }
    for (const element of document.querySelectorAll('.seat-chip[data-player-id]')) {
      const rect = rectOf(element);
      if (rect) seats.set(Number(element.dataset.playerId), rect);
    }
    return {
      cards, cardElements, seats,
      draw: rectOf(document.getElementById('draw-pile')),
      discard: rectOf(document.getElementById('discard')),
      discardTop: document.querySelector('#discard .pile-card:last-child'),
      hand: rectOf(document.getElementById('hand')),
    };
  }

  function pulse(className, duration) {
    const felt = document.getElementById('felt');
    if (!felt) return;
    const old = pulses.get(className);
    if (old) {
      clearTimeout(old);
      timers.delete(old);
    }
    felt.classList.remove(className);
    nextFrame(() => {
      felt.classList.add(className);
      const handle = later(duration, () => {
        felt.classList.remove(className);
        pulses.delete(className);
      });
      pulses.set(className, handle);
    });
  }

  function fly({ from, to, card = null, width, delay = 0, heavy = false, deal = false, playing = false, target = null, index = 0 }) {
    if (!from || !to) return 0;
    const start = center(from);
    const finish = center(to);
    const cardWidth = clamp(width ?? from.width, 40, 150);
    const cardHeight = cardWidth * 1.5;
    const flight = decoration(`card-flight${heavy ? ' card-flight-heavy' : ''}`, start.x - cardWidth / 2, start.y - cardHeight / 2);
    flight.style.width = `${cardWidth}px`;
    flight.style.height = `${cardHeight}px`;
    const image = document.createElement('img');
    image.src = card === null ? BACK_IMAGE : cardImage(card);
    image.alt = '';
    image.draggable = false;
    flight.append(image);
    document.body.append(flight);

    const dx = finish.x - start.x;
    const dy = finish.y - start.y;
    const direction = dx < 0 ? -1 : 1;
    const drawing = !playing && !deal;
    const duration = heavy ? 640 : playing ? 470 : deal ? 490 : 1000;
    const endScale = target || playing ? clamp(to.width / cardWidth, 0.5, 1.8) : 0.38;
    const rotation = playing ? ((card * 7) % 9) - 4 : (index % 5 - 2) * 2;
    const arc = heavy ? 100 : playing ? 58 : 35 + Math.min(45, Math.abs(dx) * 0.1);
    const transform = (x, y, angle, scale) => `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(${scale})`;

    // The real card remains interactive, but its face appears as the flying
    // copy lands. Cancelling the animation restores its normal opacity.
    if (target) animate(target, [{ opacity: 0 }, { opacity: 0 }], { duration: delay + duration, fill: 'none' });
    animate(flight, [
      { offset: 0, opacity: 0, transform: transform(0, 0, -direction * 12, 0.9) },
      { offset: 0.08, opacity: 1, transform: transform(dx * 0.015, -12, -direction * 18, 1) },
      { offset: 0.5, opacity: 1, transform: transform(dx * 0.52, dy * 0.45 - arc, direction * (heavy ? 25 : 13), heavy ? 1.35 : 1.08) },
      { offset: 0.82, opacity: 1, transform: transform(dx, dy + (heavy ? 8 : -5), rotation + direction * 3, endScale * (heavy ? 1.12 : 1.03)) },
      { offset: 0.94, opacity: 1, transform: transform(dx, dy - 2, rotation - direction, endScale * 0.98) },
      { offset: 1, opacity: target || playing ? 1 : 0, transform: transform(dx, dy, rotation, endScale) },
    ], { duration, delay, easing: drawing ? 'cubic-bezier(.4,0,.2,1)' : 'cubic-bezier(.18,.7,.23,1)', fill: 'both' }, () => remove(flight));
    return delay + duration;
  }

  function impact(point, heavy = false) {
    const burst = decoration(`impact-burst${heavy ? ' impact-heavy' : ''}`, point.x, point.y);
    const ring = document.createElement('span');
    ring.className = 'impact-ring';
    burst.append(ring);
    const count = heavy ? 16 : 10;
    for (let index = 0; index < count; index += 1) {
      const spark = document.createElement('span');
      spark.className = 'impact-spark';
      spark.style.setProperty('--angle', `${index * 360 / count}deg`);
      spark.style.setProperty('--distance', `${(heavy ? 112 : 70) + (index % 3) * 13}px`);
      spark.style.setProperty('--delay', `${(index % 3) * 16}ms`);
      burst.append(spark);
    }
    document.body.append(burst);
    pulse('table-impact', heavy ? 820 : 600);
    later(1100, () => remove(burst));
  }

  function tally(point, from, to) {
    if (penalty) remove(penalty);
    const element = decoration('penalty-tally', point.x, point.y - 30);
    penalty = element;
    const label = document.createElement('span');
    label.className = 'penalty-label';
    label.textContent = from > 0 ? 'STACKED!' : 'PICK UP';
    const value = document.createElement('strong');
    value.className = 'penalty-value';
    value.textContent = `+${from}`;
    element.append(label, value);
    document.body.append(element);
    let started = null;
    function count(time) {
      if (!element.isConnected) return;
      started ??= time;
      const progress = Math.min(1, (time - started) / 600);
      value.textContent = `+${Math.round(from + (to - from) * (1 - (1 - progress) ** 3))}`;
      if (progress < 1) nextFrame(count);
    }
    nextFrame(count);
    later(1650, () => remove(element));
  }

  function celebrate(matchWin) {
    const layer = decoration('round-celebration');
    layer.style.inset = '0';
    const count = matchWin ? 72 : 44;
    for (let index = 0; index < count; index += 1) {
      const piece = document.createElement('span');
      piece.className = 'celebration-piece';
      const angle = (index / count) * Math.PI * 2;
      const distance = 200 + (index % 7) * 48;
      piece.style.setProperty('--x', `${48 + (index % 5)}vw`);
      piece.style.setProperty('--y', '44vh');
      piece.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
      piece.style.setProperty('--dy', `${Math.sin(angle) * distance + 220}px`);
      piece.style.setProperty('--spin', `${(index % 2 ? -1 : 1) * (240 + index * 29)}deg`);
      piece.style.setProperty('--delay', `${(index % 8) * 34}ms`);
      piece.style.setProperty('--color', COLORS[index % COLORS.length]);
      layer.append(piece);
    }
    document.body.append(layer);
    pulse('table-celebrating', 3200);
    later(3600, () => remove(layer));
  }

  function update(view, selfId, beforeRects) {
    if (destroyed) return;
    if (!view) {
      clear();
      return; // Keep the event cursor across a temporary disconnect.
    }
    const prior = previous;
    const restarted = prior && view.revision < prior.revision;
    if (restarted) reset();
    const log = view.log ?? [];
    const appended = prior && !restarted ? appendedEntries(prior.log ?? [], log) : [];
    const fresh = prior && !restarted ? log.filter((entry) => Number.isSafeInteger(entry.seq)
      ? entry.seq > lastSeq : appended.includes(entry)) : [];
    previous = structuredClone(view);
    lastSeq = Math.max(lastSeq, ...log.map((entry) => entry.seq ?? 0));
    if (suppressed()) {
      clear();
      return;
    }
    // Hydration, repeated snapshots and a restored older host are baselines.
    if (!prior || restarted || view.revision === prior.revision) return;
    if (!fresh.length && view.pendingDraw <= prior.pendingDraw) return;

    const after = capture();
    const before = beforeRects ?? after;
    const deck = after?.draw ?? before?.draw;
    const discard = after?.discard ?? before?.discard;
    if (!deck && !discard) return;
    const seatRect = (id) => after?.seats.get(id) ?? before?.seats.get(id);
    const targetRect = (id, card = null) => id === selfId
      ? after?.cards.get(card) ?? after?.hand ?? before?.hand ?? seatRect(id) : seatRect(id);
    const cardWidth = clamp(deck?.width ?? 84, 48, 110);
    const oldHand = new Set(handFor(prior, selfId));
    const shuffledHands = fresh.some((entry) => entry.k === 'swap' || entry.k === 'rotate');
    const newCards = shuffledHands ? [] : handFor(view, selfId).filter((card) => !oldHand.has(card));
    // A timed-out forced play may draw and play the same card in one update.
    for (const entry of fresh) {
      if (!shuffledHands && entry.k === 'play' && entry.by === selfId && !oldHand.has(entry.card) && !newCards.includes(entry.card)) {
        newCards.push(entry.card);
      }
    }
    let newCardIndex = 0;
    let landing = 0;
    let lastFinish = 0;
    let heavyLanding = null;

    for (const entry of fresh) {
      if (entry.k === 'deal' && view.phase === 'playing' && deck) {
        const count = Math.min(DECK_SIZE, view.counts.reduce((sum, value) => sum + value, 0));
        const gap = Math.min(42, 1250 / Math.max(1, count));
        const selfHand = handFor(view, selfId);
        let dealt = 0;
        // Deal around the table one card at a time, just like a real hand.
        for (let index = 0; dealt < count; index += 1) {
          for (let seat = 0; seat < view.seats.length && dealt < count; seat += 1) {
            if (index >= view.counts[seat]) continue;
            const id = view.seats[seat];
            const card = id === selfId ? selfHand[index] ?? null : null;
            lastFinish = Math.max(lastFinish, fly({
              from: deck, to: targetRect(id, card), card, width: cardWidth, delay: dealt * gap, deal: true, index: dealt,
              target: card === null ? null : after?.cardElements.get(card),
            }));
            dealt += 1;
          }
        }
      } else if (entry.k === 'play' && discard) {
        const heavy = rankOf(entry.card) === 'wd4';
        const from = (entry.by === selfId ? before?.cards.get(entry.card) : null)
          ?? before?.seats.get(entry.by) ?? (entry.by === selfId ? before?.hand : null) ?? deck;
        const finish = fly({
          from, to: discard, card: entry.card, width: cardWidth, heavy, playing: true,
          target: entry.card === view.discard.at(-1) ? after?.discardTop : null,
        });
        lastFinish = Math.max(lastFinish, finish);
        landing = finish * 0.82;
        if (heavy) {
          heavyLanding = landing;
          const point = center(discard);
          later(landing, () => impact(point, true));
        }
      } else if (['draw', 'take', 'catch', 'challenge'].includes(entry.k) && deck) {
        const id = entry.k === 'catch' || (entry.k === 'challenge' && entry.won) ? entry.target : entry.by;
        // The event stores the number actually drawn, including an exhausted
        // deck. Counting only hand deltas loses draws followed by a forced play.
        const count = clamp(Number.isSafeInteger(entry.n) ? entry.n : 0, 0, DECK_SIZE);
        // Let each card register, while keeping even a large penalty under 3.4s.
        const gap = Math.min(220, 2400 / Math.max(1, count - 1));
        for (let index = 0; index < count; index += 1) {
          const card = id === selfId ? newCards[newCardIndex++] ?? null : null;
          lastFinish = Math.max(lastFinish, fly({
            from: deck, to: targetRect(id, card), card, width: cardWidth,
            delay: (landing ? landing + 85 : 0) + index * gap, index,
            target: card === null ? null : after?.cardElements.get(card),
          }));
        }
      }
    }

    const grew = view.pendingDraw > prior.pendingDraw;
    if (discard && (grew || heavyLanding !== null)) {
      const point = center(discard);
      const from = prior.pendingDraw;
      const to = grew ? view.pendingDraw : from + 4;
      later(heavyLanding ?? landing, () => tally(point, from, to));
    }
    if (view.phase === 'roundOver' && prior.phase !== 'roundOver' && fresh.some((entry) => entry.k === 'win')) {
      later(Math.min(lastFinish + 80, 1250), () => celebrate(view.matchWinner !== null));
    }
  }

  return {
    capture,
    update,
    reset,
    destroy() {
      destroyed = true;
      reset();
      document.removeEventListener('visibilitychange', onVisibility);
      motion?.removeEventListener('change', onVisibility);
    },
  };
}
