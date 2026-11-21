---
slug: draw-telephone
stage: launched
priority: 5
url: https://pb-draw-telephone.pages.dev
repo: https://github.com/janwan2003/draw-telephone
updated: 2026-11-21
---

# draw-telephone

## Thesis

**Who:** Friend group chats, families, classes, coworkers and Discord servers. Teens and young
adults first, but the game is simple enough for grandparents.

**What:** An *asynchronous* drawing telephone game (the old parlour game "telephone pictionary":
write a phrase, the next person draws it, the next guesses the drawing, and so on) played inside
a group chat over a day, not in a live session. One person creates a game and sends the link to
the chat. Each member opens it whenever they have a minute, joins with a nickname, and gets one
turn: they see only the previous step (a phrase or a drawing) and draw or describe it on their
phone (about 1–2 minutes). The chain moves on as people take turns; several chains run in
parallel so nobody waits long. When everyone has played (or at a set time, e.g. 9 pm), the
reveal unlocks: every chain played back step by step, from "a cat doing taxes" to "a raccoon
robbing a bank".

**Needs others:** yes. A chain of one is not a game; the joke only exists when other people
misread your drawing.

**Viral moment:** the reveal. The final chain is funny by construction, and the product renders
each chain as a shareable image or short looping animation ("Grandma's cat became a raccoon in
5 steps") that people post to stories and forward to other chats. The group-chat link preview
shows live state: "Today's chain: 4 of 7 drew · reveal at 9 pm", which pulls the stragglers in.
After the reveal: "Start one for your other group".

**How often:** daily or weekly per group. That is the Plain shape from the charter: a short
ritual, results after everyone plays, a streak. A typical person is in several group chats, so
they have more than one place to start a game.

**Why now:** the live version is proven at scale (garticphone.com ≈ 9.5M visits/month, below),
but live play needs everyone online at once, on a call, for 20+ minutes. Group chats are
asynchronous; nothing popular fills that slot on the web.

## Market evidence

Searches run 2026-11-20. Sources are search-result summaries, not opened pages, unless noted.
Traffic figures are third-party estimates.

- **Live demand is large:** garticphone.com ≈ 9.54M visits in Semrush's competitor table
  (page last updated October 2025) ([Semrush gartic.io competitors](https://www.semrush.com/website/gartic.io/competitors/));
  gartic.io (a different, draw-and-guess game) ≈ 2.68M visits ([Semrush gartic.io overview](https://semrush.com/website/gartic.io/overview)).
  Jackbox Games publishes a "[games like Gartic Phone](https://www.jackboxgames.com/games-like-gartic-phone)" page, i.e. sells into the same demand.
- **Incumbents are live, not async:** Gartic Phone's friend games run on a turn timer that
  starts once most people have finished ([Gartic guide on Medium](https://medium.com/gartic/the-ultimate-gartic-phone-guide-all-modes-explained-805404f94948),
  [ProGameGuides](https://progameguides.com/gartic-phone/how-to-play-gartic-phone/)); its untimed "Masterpiece" mode is
  still one session. I found no evidence of multi-day play. Drawize Phone gives a share link to a
  private room with host timers but describes live play ([Drawize blog](https://www.drawize.com/blog/drawize-phone)).
  DrawGuess sets up a voice call ([AlternativeTo](https://alternativeto.net/software/drawguess/about)).
  Mobile apps (Drawing Phone, TELPIC, TeleDraw) target Discord/Zoom calls and need an install
  ([TELPIC App Store](https://apps.apple.com/app/id1517046567), [TeleDraw App Store](https://apps.apple.com/us/app/teledraw-%EC%86%8D%EC%82%AD%EC%9E%84-%EA%B7%B8%EB%A6%AC%EA%B8%B0/id6615065956?l=en-US)).
- **Async has a history but no current leader:** Broken Picture Telephone (2007) let people join a
  game hours or days later ([Wikipedia](https://en.wikipedia.org/wiki/Broken_Picture_Telephone));
  Drawception plays with 12–24 *random strangers*, not your group, and has been only partly
  functional since 2022 per [Wikipedia](https://en.wikipedia.org/wiki/Drawception). Neither is a private group-chat game.
- **Re-check 2026-11-21 (builder):** async telephone *apps* do exist, all install-only on iOS:
  [Doodle Party](https://apps.apple.com/us/app/doodle-party/id1512039534) ("asynchronous party game", up to 8 players),
  [Etch](https://apps.apple.com/us/app/-/id1550287122) (played via iMessage groups, optional no time limit),
  [DoodleLoop](https://apps.apple.com/us/app/id6744711451) (iPad, one round per day over a week). So async demand is real,
  but none is a web link that works in a WhatsApp/Android group with no install. Sources: search-result summaries; the
  listings were not opened.
- **How people do it now:** live sessions on a Discord or video call, or the paper version at a
  party. Nothing in the results serves "play it in the WhatsApp group during the day".

## Our edge

- **Loop: needs others.**
- **K estimate ≈ 1.6** = 6 people invited per game × 75% who play (it is a 1-minute turn from a
  friend, and the preview nags) × 35% of players who later start one in another group. Reason: the
  reveal is funny enough to forward, and the "start one in your other chat" moment comes right
  after it. Weakest factor: joiner → creator; design the reveal page around that button.
- **Async by design**: one turn whenever you like, parallel chains so no one blocks the game, reveal
  at a fixed time if someone never plays. This is the gap left by the live incumbents.
- **Zero-friction join**: no install, no account, works in WhatsApp/Instagram in-app browsers.
- **Live link preview** (dynamic Open Graph image: "4 of 7 drew").
- **Shareable reveal** (image strip or GIF) that is the ad for the product.
- **Cheap to host**: drawings stored as stroke vectors (JSON, a few KB) in D1, rendered client-side;
  no image storage, so it is not blocked on R2 billing like photo-drop.
- **Honest risk:** drawing on a phone is fiddly; the canvas must be excellent at 360 px wide. And
  private drawings can be crude; no public feed, report/hide per game, creator can remove a turn.

## Status

**Live: https://pb-draw-telephone.pages.dev** (brand **Doodlechain**). Product/privacy/support page on GitHub Pages:
https://janwan2003.github.io/draw-telephone/. Search Console: site verified (META) and sitemap submitted 2026-11-21.

What exists (Cloudflare Pages + Functions + D1 `pb-draw-telephone`, free plan, no build step):
- Create a game (name, host nickname, reveal: when everyone has played / tonight 9 pm / tomorrow 9 pm / in 3 days,
  chain length 4/6/8) → one link. Join with a nickname (duplicates rejected, max 30 players), no account; the device
  keeps a random key (stored server-side as SHA-256).
- Each player writes a starting phrase (🎲 suggests one of ~100 family-safe prompts), then plays turns on other
  chains: the server assigns the shortest waiting chain, locks it for 15 min (released on skip, back or page close),
  and returns **only the previous step**. Turns alternate draw/guess. Several chains run in parallel.
- Drawing pad: pointer events with coalesced points, 9 colours + eraser, 3 sizes, undo, clear; strokes stored as
  vectors on a 1000×1000 grid (max 60 KB), rendered client-side; drawings replay as an animation when shown.
- Auto-reveal when every chain is full or every player has played every chain (min. 3 chains), at the chosen time,
  or when the host taps "Reveal now". Reveal shows each chain step by step ("Show next") or all at once; "Save as
  image" renders a 1080-wide PNG strip and opens the phone's share sheet (download on desktop).
- Same link, next round: anyone can start round N+1 after a reveal; earlier reveals stay viewable.
  "Got another group chat? Start a new game" on every game page (joiner → creator step).
- Link preview per game with live state: "Smith family · Doodlechain" / "Round 1 · 3 of 5 players have played ·
  reveal in 6 hours. Tap to draw and guess, no sign-up." Static og.png image (not yet per game).
- Host moderation: remove a step after the reveal, remove players, delete the game. Players can leave.
- Rate limits per IP in D1 (create 20/h, join 60/h, turns 400/h, other writes 200/h); CSP + security headers;
  games inactive 90 days are deleted.

Verified 2026-11-21:
- `node --test tests/unit/*.test.js`: 6/6 pass (whole-round simulation for 3–20 players × chain length 4/6/8 × 20
  seeds: every round completes, chains alternate text/draw, nobody plays a chain twice; locks; skip; validation).
- `tests/e2e/run.mjs` in real Chromium, 5 separate browser contexts (390 px phone, 360 px phone, 1280 px desktop),
  **passes on local `wrangler pages dev` and on production** (deploy 59992387): create with validation, OG text
  before/during/after, joins with a duplicate nickname, start phrases + dice, turn API exposes only the previous step and
  state leaks no phrases, 12 turns until auto-reveal, 4 chains × 4 steps by 4 different people, step-by-step reveal,
  share PNG download (>20 KB), host removes a step, late joiner sees the reveal, non-host starts round 2, past round
  viewable, host reveal-now, delete → 404, privacy page, **zero console errors**. Test games are deleted afterwards.
- Screenshots checked by eye: landing desktop, draw screen at 360 px, guess screen desktop, reveal phone, host page
  phone, OG image. Fixed: colour row overflowing at 360 px, brush colour leaking into Undo/Clear text, truncated selects,
  empty host card, cluttered remove links.
- Rate limit checked locally: creates 201 until 20/h, then 429.

Not covered yet: real iOS Safari / Android Chrome, and the WhatsApp / Instagram / iMessage in-app browsers (drawing
feel, share sheet with files, link preview rendering): asked in the inbox.

## Metrics

- 2026-11-21 (D1 `pb-draw-telephone`, after deleting test data): 0 games, 0 players. Launched today; no promotion yet.

## Next steps

1. Real-device check (operator, inbox): draw a turn on iPhone and Android inside WhatsApp; paste a game link in a chat
   and check the preview text. Fix whatever it finds first.
2. Dynamic OG image per game (e.g. "3 of 5 drew" + the latest revealed drawing for revealed rounds), rendered in the
   Function from stroke data (SVG → PNG, or serve an SVG-based card). This is the strongest pull for stragglers.
3. Animated share (GIF/WebM of the chain replay) next to the PNG strip; a "send this chain to the group" button.
4. Seasonal prompt packs (December/holiday pack now), and a "prompt of the day" option where every chain starts from
   the host's or a daily prompt.
5. Turn reminders without accounts: after your turn, offer "remind me at 8 pm" via a calendar file (.ics), no push.
6. Launch posts from the operator's accounts (only if they agree): r/WhatsApp-style communities are spam-sensitive,
   so prefer Product Hunt / AlternativeTo listings next to Gartic Phone.

## Monetization plan

None until the operator enables it (charter rule 4). Later options: premium prompt packs and
brushes, an ad-free "classroom" mode for teachers, printed reveal posters. Never paywall joining,
the reveal or group size.

## Log

- 2026-11-20 scout: created idea. Evidence from web searches (Semrush snippets, Gartic guides,
  Wikipedia, App Store listings). Did not open vendor pages or verify traffic in a first-party tool.
- 2026-11-21 builder: re-checked evidence (found install-only async apps Doodle Party, Etch, DoodleLoop; gap for a
  no-install web link holds). Built and launched Doodlechain on Cloudflare (pb-draw-telephone): game rules + API + D1,
  drawing pad, reveal + share image, rounds, OG preview, privacy, GitHub Pages, Search Console. Verified: unit 6/6, e2e
  pass locally and on production (5 Chromium contexts, phone + desktop, zero console errors), screenshots by eye.
