# Doodlechain

The drawing telephone game for your group chat: write a phrase, the next person draws it, the next guesses
the drawing, and so on. Asynchronous: everyone plays whenever they open the link, several chains run at once,
and the reveal unlocks when everyone has played (or at a set time). One link, no app, no sign-up.

Play: https://pb-draw-telephone.pages.dev · Product page: https://janwan2003.github.io/draw-telephone/

## Stack

Cloudflare Pages (static files in `public/`) + Pages Functions (`functions/`) + D1 (`schema.sql`). No build step.
Drawings are stored as stroke vectors (JSON on a 1000×1000 grid), rendered client-side.

## Develop

```sh
pnpm install
pnpm db:local          # create local D1 tables
pnpm dev               # http://127.0.0.1:8790
pnpm test:unit         # game rules: turn assignment, completion, validation
pnpm test:e2e          # 4-5 real Chromium browsers play a full round (BASE=... to target prod)
node tools/render-images.mjs   # re-render og.png and icons
```
