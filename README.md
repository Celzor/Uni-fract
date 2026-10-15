# Uni-refract

**No-no**, the hand-drawn card game, as a Refract activity. Match the colour or the number. Stack the draws. Jump in out of turn. And when you’re down to one card, shout **“Oh no!”** before anyone catches you.

Uni-refract brings no-no into your call for two to six players. Extra participants watch, and can take a seat when one opens. It also runs on its own against computer players.

**No game server. No account setup. No runtime dependencies.** Refract supplies identities and relays messages; this app supplies the game.

## Try it locally

With **Node.js 24 or later**:

```sh
npm run dev
```

No `npm install` is needed. Open:

- **[The game](http://127.0.0.1:4173/)**: practice against up to five computer players (three by default), or sit out and watch the bots play.
- **[Shared activity preview](http://127.0.0.1:4173/tools/preview.html)**: up to seven real game frames connected through a local simulation of Refract’s host protocol. Add and remove participants, refresh a player, change themes, leave as the host, or start a new session.

For another port: `npm run dev -- --port 4200`. Opening `index.html` directly as a `file:` URL will not load browser modules; use the local server.

## Play in Refract

1. Publish the app at its own **HTTPS origin**, different from your Refract instance. GitHub Pages setup is below.
2. As an instance admin, open **Manage instance → Activities** and add:

   | Field | Value |
   | --- | --- |
   | Name | Uni-refract |
   | URL | Your final hosted page URL, including its repository path if applicable |
   | Description | No-no: match colours, stack draws, jump in, shout “Oh no!”. Two to six players; everyone else watches. |

3. Reload Refract so its content security policy picks up the activity origin.
4. Join a voice channel or private call. Open **Activities** in the call panel and select **Uni-refract**.
5. Everyone who opens the activity is seated, up to six. The first participant is the host: they pick the house rules and deal. Playing alone, or short of players? The host can add up to five computer players, with **Add a computer player** on the open seat or the **Computer players** house rule.

For development, register `http://127.0.0.1:4173/` on a non-production Refract instance or one with developer mode enabled. A loopback URL points at the machine running each browser, so use HTTPS hosting to play with friends on other machines.

The URL must be its final origin; redirects to another domain break Refract’s origin checks. Hosting must allow framing by your Refract instance. If you configure `CSP_DIRECTIVES` manually in Refract, include the activity origin in `frame-src`.

## Publish on GitHub Pages

The included [workflow](.github/workflows/pages.yml) checks the JavaScript, runs the tests, builds a public-only `dist/`, and deploys it when changes reach `main`. Pull requests run checks without deploying.

1. Push this project to its GitHub repository.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Run **Check and deploy Pages** from Actions, or push to `main` after enabling Pages.
4. Copy the deployed URL from the workflow and register it in Refract.

Alternatively, run `npm run build` and serve **only `dist/`** from any static HTTPS host. Never deploy the whole working directory. The build has an explicit public-file allowlist ([`tools/public-files.js`](tools/public-files.js)); tests, tooling scripts, and local configuration stay out of the output.

## House rules

The host sets these in the lobby, or between rounds.

| Rule | Options | What it does |
| --- | --- | --- |
| Computer players | None, 1–5 (practice starts with 3) | Bots fill empty seats and play by the same rules: they stack, jump in, shout “Oh no!” (usually), and will catch you if you forget. People always get priority: someone joining between rounds takes a bot’s seat. |
| Turn timer | Off, 10–60 s (default 30 s) | When time runs out you draw automatically (or take the stacked draws), and your turn ends. A just-drawn card gets at least five seconds of decision time. |
| Draw stacking | Off · +2 on +2, +4 on +4 · also +4 on +2 | Answer a draw card with your own to pass the growing total to the next player. Whoever can’t (or won’t) takes the lot and loses their turn. |
| Jump-in | On / off | Play a card identical to the top card (same colour and symbol) out of turn, including a second copy on your own card. Play continues from you. Identical +2s add to a pending draw stack; wilds never jump in. |
| 7-0 | On / off | A 7 swaps your hand with a player you choose. A 0 passes every hand one seat along in the direction of play. |
| Wild Draw Four | Can be challenged · No challenges · Only when stuck | When challengeable, the player hit can call a bluff. If the player who played it held the active colour, they draw the cards and the challenger plays on; otherwise the challenger draws them plus two more and loses their turn. |
| Shout “Oh no!” | On / off | Press **OH NO!** as you play your second-to-last card (or right after). Forget, and anyone can **Catch** you for two cards until the next player moves. |
| Draw to match | On / off | Keep drawing until you get a playable card. |
| Forced play | On / off | A playable drawn card must be played. |
| Starting hand | 5, 7, 10 | Cards dealt to each player. |
| Play to | Just keep score · 200 · 500 | The round winner scores everyone else’s cards: face value for numbers, 20 for Skip/Reverse/Draw Two, 50 for wilds. Reaching the target wins the match; the next deal starts a new one. |

Always on: Skip skips the next player; Reverse flips direction (with two players it acts as a Skip); Draw Two and Wild Draw Four make the next player draw and lose their turn unless they can stack or challenge. A drawn card that can be played may be played straight away or kept. Rounds open on a number card, and the first player rotates each round. When the draw pile runs out, the discards are reshuffled under the top card.

If you have no legal card, the table draws for you after a short pause (normally 1.6 seconds, with extra time to catch a missed “Oh no!”). This also takes an unanswered draw stack automatically. A challengeable +4 still waits for your choice to challenge or take the cards. The host controls automatic draws in multiplayer, so cards are only drawn once.

Keyboard: **D** draw, **O** shout “Oh no!”, **C** catch, **K** keep.

Sound uses short, quiet cues for turns, playing and drawing cards, dealing, calls, and round wins. **Sound on / off** mutes every effect and remembers your preference. Only one cue plays at a time; repeated multiplayer snapshots do not replay sounds.

Cards swoop between hands and piles individually. Drawn cards take a second to arrive, spaced apart so each one is visible; large penalties use tighter spacing to keep the animation brief. Draw Fours land with a heavier impact; stacked penalties show a floating total counting up. Round and match wins have a fanfare and confetti. Motion respects your system’s reduced-motion preference.

Players sit around the felt, with your own seat beside your hand. Refract profile pictures appear when available, with initials as a fallback. A yellow outline and soft glow surround the whole hand area on your turn, with your profile outside it; playable cards lift up. The draw control sits below the deck, with space reserved so turn changes keep the table steady.

Inside Refract, the table and cards adapt to the frame's height as well as its width. Compact frames put opponents in a strip and move the score pad, table talk, and table tools into **Scores & log**. The **Expand** button requests full screen from Refract. Very short frames retain scrolling inside the game so controls stay reachable; the header and Expand button stay in place.

## How the integration works

The wire contract is **`refract-activity/1`**, through the small, dependency-free [bridge](src/bridge.js) shared with [refract-tack-toe](https://github.com/Celzor/refract-tack-toe). Messages within the activity use `uni-refract/1`, the Refract session ID, and the elected host ID.

```text
Activity frame       Refract host         Other participants
      ready ────────────► │
            ◄──── init   │  self, participants, sessionId, theme
      broadcast ────────►│──── message ───────────►
            ◄── message │◄──── broadcast ─────────
```

Card games have hidden information, so this goes one step further than tic-tac-toe:

- **The first participant is the host.** Only the host’s copy holds the full table: every hand and the draw pile’s order. It validates every action against Refract’s relayed sender ID, the turn, and a turn sequence number (so a click made just before someone jumped in is refused), runs the turn timer, and plays the computer players. Bots decide from their own view, so they never see anyone else’s cards.
- **Each participant gets a private view.** After every change the host sends each participant, addressed to them alone, the public table plus *their own* hand. Other hands and the deck order never leave the host’s browser. Spectators receive no hand.
- **Late arrivals and reloads** request a snapshot. A small periodic resync recovers any dropped message. The host keeps its full table in `sessionStorage`, scoped by session ID and user, so a host reload resumes exactly where it was.
- **When the host leaves**, the next participant becomes host and asks everyone for their latest view, which includes their own hand. It adopts the most recent view, keeps every hand that is consistent, re-deals any hand nobody could vouch for (or that two players both claimed), and shuffles the unseen cards into a fresh draw pile. In practice every remaining player keeps their exact cards. A Wild Draw Four that was pending at the hand-over can no longer be challenged, because only the old host knew whether it was a bluff. Computer players carry on under the new host, but their hands are re-dealt at the same size, since only the old host knew them. The same recovery runs if the host reloads with storage unavailable.
- **Seats follow the call.** Arrivals are seated in the lobby up to six; later arrivals watch. If a player leaves mid-round, the earliest watcher takes over their hand in place; with no watcher, their cards go back into the pile, and with fewer than two players the round returns to the lobby. Anyone can choose to sit out between rounds. Computer players never leave mid-round and use negative player IDs, so they can never collide with a Refract user.

Payloads stay far below Refract’s 16 KiB limit (a view is typically under 2 KiB). Names are rendered as text. No Refract credentials or tokens are requested.

This is a cooperative casual-game protocol, not an anti-cheat service: the host’s browser is trusted to deal fairly, and it necessarily knows every hand. There is no backend referee.

| File | Responsibility |
| --- | --- |
| [`src/cards.js`](src/cards.js) | The 108-card deck, names, points, and art paths |
| [`src/rules.js`](src/rules.js) | Pure rules engine: every action and house rule, private views, recovery, validation |
| [`src/session.js`](src/session.js) | Refract session: host authority, per-player snapshots, sync, timers, host hand-over |
| [`src/clock.js`](src/clock.js) | The host’s turn timer |
| [`src/bots.js`](src/bots.js) | Computer players: move choice and the driver that plays them for the host |
| [`src/local.js`](src/local.js) | The offline practice table |
| [`src/bridge.js`](src/bridge.js) | Refract postMessage boundary |
| [`src/avatars.js`](src/avatars.js) | Refract profile pictures and fallback initials |
| [`src/app.js`](src/app.js) | UI and wiring for both modes |
| [`src/audio.js`](src/audio.js) | Quiet sound cues, event deduplication, and mute control |
| [`src/auto-draw.js`](src/auto-draw.js) | Host-controlled draws when a human has no playable card |
| [`src/effects.js`](src/effects.js) | Card flights, draw-stack impacts and tallies, and celebrations |
| [`tools/preview.html`](tools/preview.html) | Multi-frame Refract protocol simulator |
| [`tests/`](tests/) | Rules, randomized whole-game play, synchronization, bots, bridge, page markup, and static-serving checks |

Card art lives in [`assets/cards`](assets/cards), named by face: colour `r`/`y`/`g`/`b` followed by `0`–`9`, `s` (skip), `r` (reverse) or `d2`, plus `w` and `wd4`.

All 54 faces use matching editable SVGs: cream paper, handwritten strokes, readable coloured inks, and four-colour wild symbols. Yellow keeps its dark ochre design. The source drawing commands are in [`tools/redraw-cards.js`](tools/redraw-cards.js); run `node tools/redraw-cards.js` to regenerate the deck. The older `node tools/redraw-yellow.js` command still regenerates only the yellow faces.

## Development checks

```sh
npm run check
npm test
npm run build
```

The suite uses Node’s built-in runner, an in-memory Refract relay, and fake timers, without a real Refract account. It includes a randomized run of 150 complete games across every house-rule combination that checks, after every single move, that all 108 cards are accounted for, every view is valid, and the player on turn always has a legal move. In environments that forbid child processes, run `node --test --test-isolation=none` instead.

An optional browser smoke test exercises practice mode and the multiplayer preview, including a host leaving mid-round:

```sh
# Start npm run dev in another terminal first.
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tools/browser-check.mjs
```

It accepts `TEST_URL` (defaults to `http://127.0.0.1:4173/`), `PLAYWRIGHT_MODULE` for an existing Playwright installation, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for an existing Chromium-based browser such as Edge or Chrome. Screenshots go to the ignored `artifacts/` folder. A protocol simulator verifies the app’s side of the contract; final acceptance uses signed-in users in an actual Refract call.

## License

GNU GPL v3, matching refract-tack-toe, whose bridge and tooling this project adapts. See [LICENSE](LICENSE).

Sound effects are adapted from [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds), released under **CC0 1.0** (royalty-free, including commercial use). Source filenames and processing details are in [audio credits](assets/audio/CREDITS.txt); the pack’s original [license notice](assets/audio/LICENSE.txt) ships with the game.
