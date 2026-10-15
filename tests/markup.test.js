import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SETTING_OPTIONS } from '../src/rules.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const settingsForm = html.match(/<form id="settings"[\s\S]*?<\/form>/)?.[0] ?? '';

test('every house-rule control is named after an engine setting, and every setting has one', () => {
  const names = [...settingsForm.matchAll(/\sname="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(names, Object.keys(SETTING_OPTIONS).sort());
});

test('rule menus offer exactly the values the engine accepts', () => {
  for (const [, name, body] of settingsForm.matchAll(/<select name="([^"]+)">([\s\S]*?)<\/select>/g)) {
    const values = [...body.matchAll(/<option value="([^"]*)"/g)].map((match) => (/^\d+$/.test(match[1]) ? Number(match[1]) : match[1]));
    assert.deepEqual([...values].sort(), [...SETTING_OPTIONS[name]].sort(), `${name} options`);
  }
  for (const [, name] of settingsForm.matchAll(/<input type="checkbox" name="([^"]+)"/g)) {
    assert.deepEqual(SETTING_OPTIONS[name], [true, false], `${name} is an on/off rule`);
  }
});

test('every element the app looks up by id exists in the page', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const used = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]));
  assert.ok(used.size > 40);
  for (const id of used) assert.ok(ids.has(id), `#${id} is missing from index.html`);
});
