import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatar, resolveAvatarUrl } from '../src/avatars.js';

test('uses absolute Refract pictures and resolves paths only with an explicit host origin', () => {
  assert.equal(resolveAvatarUrl('https://refract.example/media/alex.webp'), 'https://refract.example/media/alex.webp');
  assert.equal(resolveAvatarUrl('/media/alex.webp', 'https://refract.example'), 'https://refract.example/media/alex.webp');
  assert.equal(resolveAvatarUrl('media/alex.webp', 'http://localhost:3000'), 'http://localhost:3000/media/alex.webp');
  assert.equal(resolveAvatarUrl('/media/alex.webp'), null, 'never accidentally request a Refract path from the game server');
});

test('missing, malformed, credential-bearing and non-web picture URLs fall back to an initial', () => {
  for (const value of [null, undefined, 4, '', ' ', 'https://[invalid', 'javascript:alert(1)', 'file:///avatar.png', 'data:image/png;base64,AAAA', 'https://user:password@refract.example/avatar.png']) {
    assert.equal(resolveAvatarUrl(value, 'https://refract.example'), null, String(value));
  }
});

test('an unavailable picture removes itself and leaves the player initial visible', (context) => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  context.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tagName) {
      const element = {
        tagName,
        children: [],
        attributes: {},
        events: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, callback) { this.events[name] = callback; },
        append(child) { this.children.push(child); child.parent = this; },
        remove() { this.parent.children = this.parent.children.filter((child) => child !== this); },
      };
      return element;
    },
  } });
  const avatar = createAvatar({ name: 'Alex', avatarUrl: '/media/alex.webp' }, 'https://refract.example');
  const picture = avatar.children[0];
  assert.equal(avatar.textContent, 'A');
  assert.equal(picture.src, 'https://refract.example/media/alex.webp');
  assert.equal(picture.alt, '');
  assert.equal(picture.referrerPolicy, 'no-referrer');
  picture.events.error();
  assert.deepEqual(avatar.children, []);
  assert.equal(avatar.textContent, 'A');
});
