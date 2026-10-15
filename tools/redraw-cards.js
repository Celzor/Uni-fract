// Editable vector originals for every face in the homemade pen-and-paper deck.
// The yellow drawing stays identical; each other colour uses the same strokes.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const inks = {
  r: { name: 'Red', primary: '#b13e35', highlight: '#c87564' },
  y: { name: 'Yellow', primary: '#a87808', highlight: '#c2993b' },
  g: { name: 'Green', primary: '#2c7a4d', highlight: '#6c9e71' },
  b: { name: 'Blue', primary: '#326eaa', highlight: '#7a9fc1' },
};
const numerals = {
  0: 'M207 169C120 158 111 246 115 305C119 396 146 438 202 435C267 432 288 356 284 288C279 205 258 169 207 169Z',
  1: 'M128 220L205 170L198 431M136 435L262 430',
  2: 'M117 223C119 149 276 143 283 223C292 298 154 338 119 431L291 428',
  3: 'M117 183C180 160 285 155 282 222C280 264 223 294 181 294C240 281 289 310 284 364C281 434 183 450 115 412',
  4: 'M243 435L246 167L109 349L296 343',
  5: 'M283 174L130 180L121 293C186 271 279 276 283 351C288 434 183 464 112 412',
  6: 'M271 180C166 131 104 247 113 356C120 463 284 458 285 359C285 281 180 265 119 331',
  7: 'M112 177L292 184C235 262 163 333 139 433',
  8: 'M201 296C91 267 105 168 201 170C294 172 302 264 201 296C93 326 94 438 198 436C304 436 310 328 201 296Z',
  9: 'M283 277C271 150 116 150 113 246C109 327 216 341 281 277C290 374 227 460 142 424',
};
const actions = {
  s: '<path d="M200 196C127 190 96 244 102 309C108 372 152 405 213 399C282 392 306 341 297 278C289 224 250 194 200 196Z M128 365L274 226"/>',
  r: '<path d="M105 258C130 194 224 185 283 232L253 183M283 232L226 240 M293 343C265 407 178 414 115 366L146 415M115 366L175 356"/>',
  d2: '<path d="M76 297L147 295M112 259L110 335 M178 238C183 184 287 186 289 241C291 299 207 324 178 383L298 380"/>',
};

function coloredFace(color, rank) {
  const { name, primary, highlight } = inks[color];
  const prefix = color.toUpperCase();
  const label = { s: 'SKIP', r: 'REVERSE', d2: 'PICK UP TWO' }[rank];
  const symbol = rank === 'd2' ? '+2' : rank === 's' ? 'S' : rank === 'r' ? 'R' : rank;
  const drawing = numerals[rank] ? `<path d="${numerals[rank]}"/>` : actions[rank];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" role="img" aria-label="${name} ${label ?? rank}">
  <rect width="400" height="600" rx="13" fill="#fffef9"/>
  <path d="M31 24C130 34 255 24 369 34C360 204 353 375 370 566C261 561 142 581 29 565C43 406 25 224 34 55Z" fill="none" stroke="${primary}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M36 28C142 40 258 30 364 38M35 562C153 574 267 557 366 561" fill="none" stroke="${highlight}" stroke-width="2" opacity=".65"/>
  <g fill="${primary}" font-family="Segoe Print, Comic Sans MS, cursive" font-weight="700">
    <text x="48" y="81" font-size="31" transform="rotate(-4 48 81)">No No</text>
    <text x="352" y="87" font-size="45" text-anchor="end" transform="rotate(4 352 87)">${prefix}${symbol}</text>
    <text x="49" y="548" font-size="45" transform="rotate(-4 49 548)">${prefix}${symbol}</text>
    <text x="352" y="548" font-size="31" text-anchor="end" transform="rotate(3 352 548)">No No</text>
${label ? `    <text x="200" y="470" font-size="${rank === 'd2' ? 29 : 34}" text-anchor="middle" transform="rotate(-3 200 470)">${label}</text>` : ''}
  </g>
  <g fill="none" stroke="${primary}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-3 200 300)">${drawing}</g>
</svg>
`;
}

function wildFace(drawFour) {
  const label = drawFour ? 'WILD DRAW FOUR' : 'WILD';
  const symbol = drawFour ? '+4' : 'W';
  const drawing = drawFour
    ? 'M76 299L151 296M115 258L111 338 M263 390L266 203L171 335L306 331'
    : 'M110 209L148 387L201 280L246 388L290 207';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" role="img" aria-label="${drawFour ? 'Wild Draw Four' : 'Wild'}">
  <rect width="400" height="600" rx="13" fill="#fffef9"/>
  <path d="M31 24C130 34 255 24 369 34C360 204 353 375 370 566C261 561 142 581 29 565C43 406 25 224 34 55Z" fill="none" stroke="#69533d" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M36 28C142 40 258 30 364 38M35 562C153 574 267 557 366 561" fill="none" stroke="#9e8365" stroke-width="2" opacity=".65"/>
  <g fill="#69533d" font-family="Segoe Print, Comic Sans MS, cursive" font-weight="700">
    <text x="48" y="81" font-size="31" transform="rotate(-4 48 81)">No No</text>
    <text x="352" y="87" font-size="45" text-anchor="end" transform="rotate(4 352 87)">${symbol}</text>
    <text x="49" y="548" font-size="45" transform="rotate(-4 49 548)">${symbol}</text>
    <text x="352" y="548" font-size="31" text-anchor="end" transform="rotate(3 352 548)">No No</text>
    <text x="200" y="470" font-size="${drawFour ? 26 : 34}" text-anchor="middle" transform="rotate(-3 200 470)">${label}</text>
  </g>
  <g stroke-width="6" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-3 200 300)">
    <path d="M193 162C126 155 77 211 80 285L193 285Z" fill="#b13e35" fill-opacity=".17" stroke="#b13e35"/>
    <path d="M207 162C279 165 322 215 320 285L207 285Z" fill="#a87808" fill-opacity=".17" stroke="#a87808"/>
    <path d="M320 299C325 370 270 420 207 418L207 299Z" fill="#2c7a4d" fill-opacity=".17" stroke="#2c7a4d"/>
    <path d="M193 418C124 425 77 370 80 299L193 299Z" fill="#326eaa" fill-opacity=".17" stroke="#326eaa"/>
    <path d="${drawing}" fill="none" stroke="#fffef9" stroke-width="23"/>
    <path d="${drawing}" fill="none" stroke="#69533d" stroke-width="11"/>
  </g>
</svg>
`;
}

export async function redrawCards({ colors = Object.keys(inks), wilds = true } = {}) {
  let count = 0;
  for (const color of colors) {
    for (const rank of [...Object.keys(numerals), 's', 'r', 'd2']) {
      await writeFile(new URL(`../assets/cards/${color}${rank}.svg`, import.meta.url), coloredFace(color, rank));
      count += 1;
    }
  }
  if (wilds) {
    await writeFile(new URL('../assets/cards/w.svg', import.meta.url), wildFace(false));
    await writeFile(new URL('../assets/cards/wd4.svg', import.meta.url), wildFace(true));
    count += 2;
  }
  return count;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Redrew all ${await redrawCards()} faces in matching pen-and-paper artwork.`);
}
