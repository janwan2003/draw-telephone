// End-to-end test in real Chromium: Anna creates a game, Ben, Cleo and Dan join from their
// own browsers, everyone writes a phrase, then draws and guesses until the round reveals
// itself. Checks turn privacy, the reveal, share image, next round and delete.
// Screenshots at phone and desktop width go to shots/.
// Usage: BASE=http://127.0.0.1:8790 node tests/e2e/run.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const SHOTS = process.env.SHOTS || 'shots';
fs.mkdirSync(SHOTS, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), '.cache/ms-playwright');
  for (const d of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux64/chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SMALL = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 860 } };
const errors = [];
const browser = await chromium.launch({ executablePath: findChrome() });

async function person(label, opts) {
  const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    // Expected HTTP errors in this test (duplicate nickname 409) are logged by the browser; ignore those only.
    if (m.type() === 'error' && !/status of 409/.test(m.text())) errors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { label, ctx, page };
}
const shot = (p, name, full = true) => p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
const shots = new Set();
const once = async (p, name, full) => { if (!shots.has(name)) { shots.add(name); await shot(p, name, full); } };

async function scribble(page, seed) {
  const box = await page.locator('canvas.pad').boundingBox();
  const pts = [];
  for (let i = 0; i < 14; i++) {
    pts.push([box.x + box.width * (0.2 + 0.6 * ((i * 37 + seed * 13) % 100) / 100), box.y + box.height * (0.2 + 0.6 * ((i * 53 + seed * 29) % 100) / 100)]);
  }
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
  // second stroke in another colour
  await page.click('.sw[data-c="1"]');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8, { steps: 8 });
  await page.mouse.up();
}

// Play every available turn for this person; returns the number of turns played.
async function playAll(p, n) {
  let played = 0;
  await p.page.goto(p.url);
  for (let guard = 0; guard < 20; guard++) {
    const state = await p.page.waitForSelector('#readyCard, #doneCard, #reveal, #turnDraw, #turnGuess', { timeout: 15000 });
    const id = await state.getAttribute('id') || (await state.getAttribute('class'));
    if (id === 'readyCard') { await p.page.click('[data-act=play]'); continue; }
    if (id === 'doneCard' || id === 'reveal') return played;
    if (id === 'turnDraw') {
      const phrase = await p.page.textContent('#phrase');
      assert.ok(phrase.length >= 2, 'phrase shown');
      assert.ok(await p.page.isDisabled('[data-act=submit]'), 'submit disabled until something is drawn');
      await scribble(p.page, n * 7 + played);
      await once(p.page, `phone-draw-${p.label}`, false);
      await p.page.click('[data-act=submit]');
    } else {
      await p.page.waitForSelector('#guessArt canvas');
      await p.page.fill('#guessText', `${p.label} guess ${played + 1}`);
      await once(p.page, `phone-guess-${p.label}`, false);
      await p.page.click('#guessForm [data-act=submit]');
    }
    // Wait until the submitted turn screen is replaced (next turn, done card or reveal).
    await state.evaluate((el) => new Promise((res) => { const t = setInterval(() => { if (!el.isConnected) { clearInterval(t); res(); } }, 50); }));
    played++;
  }
  throw new Error(`${p.label}: too many turns`);
}

const tokenOf = (p, gid) => p.page.evaluate((g) => JSON.parse(localStorage.getItem('doodlechain:' + g)).token, gid);
const apiAs = (p, gid, sub = '') => p.page.evaluate(async ([g, s]) => {
  const t = JSON.parse(localStorage.getItem('doodlechain:' + g)).token;
  const r = await fetch('/api/groups/' + g + s, { headers: { 'x-member-token': t } });
  return r.json();
}, [gid, sub]);

let step = 'start';
try {
  // 1. Landing + create
  step = 'landing';
  const desk = await person('visitor', DESKTOP);
  await desk.page.goto(BASE + '/');
  await desk.page.waitForTimeout(300);
  await shot(desk.page, 'desktop-landing');
  const anna = await person('Anna', PHONE);
  await anna.page.goto(BASE + '/');
  await shot(anna.page, 'phone-landing');
  await anna.page.click('#createBtn');
  assert.match(await anna.page.textContent('#createError'), /name/i);
  await anna.page.fill('#gName', 'Smith family');
  await anna.page.fill('#hName', 'Anna');
  await anna.page.selectOption('#steps', '4');
  await anna.page.click('#createBtn');
  step = 'created';
  await anna.page.waitForURL(/\/g\/[A-Za-z0-9]+$/);
  await anna.page.waitForSelector('#inviteCard.big');
  const url = anna.page.url();
  const gid = url.split('/g/')[1];
  anna.url = url;
  await shot(anna.page, 'phone-host-created');

  let og = await (await fetch(url)).text();
  assert.match(og, /og:title" content="Smith family · Doodlechain"/);
  assert.match(og, /0 of 1 player has played/);

  // 2. Three people join
  step = 'join';
  const ben = await person('Ben', PHONE);
  const cleo = await person('Cleo', SMALL);
  const dan = await person('Dan', DESKTOP);
  for (const p of [ben, cleo, dan]) {
    p.url = url;
    await p.page.goto(url);
    await p.page.waitForSelector('#joinForm');
    if (p === ben) await shot(ben.page, 'phone-join');
    await p.page.fill('#joinName', p === dan ? 'anna' : p.label);
    await p.page.click('#joinForm button[type=submit]');
    if (p === dan) {
      await p.page.waitForFunction(() => /already uses/.test(document.getElementById('joinError').textContent));
      await p.page.fill('#joinName', 'Dan');
      await p.page.click('#joinForm button[type=submit]');
    }
    await p.page.waitForSelector('#startForm');
  }

  // 3. Everyone writes a starting phrase (Cleo uses the dice)
  step = 'start-phrases';
  const players = [anna, ben, cleo, dan];
  for (const p of players) {
    await p.page.goto(url);
    await p.page.waitForSelector('#startForm');
    if (p === cleo) {
      await p.page.click('#dice');
      assert.ok((await p.page.inputValue('#startText')).length > 3, 'dice fills a phrase');
    } else {
      await p.page.click('#startForm button[type=submit]');
      assert.match(await p.page.textContent('#startError'), /few words/);
      await p.page.fill('#startText', `${p.label}'s phrase: a cat doing taxes`);
    }
    if (p === anna) await shot(anna.page, 'phone-start');
    await p.page.click('#startForm button[type=submit]');
    await p.page.waitForSelector('#turnDraw, #readyCard, #doneCard', { timeout: 15000 });
  }

  // Turn privacy: a claimed turn exposes only the previous step.
  step = 'privacy';
  const t = await ben.page.evaluate(async (g) => {
    const tok = JSON.parse(localStorage.getItem('doodlechain:' + g)).token;
    return (await fetch('/api/groups/' + g + '/turn', { headers: { 'x-member-token': tok } })).json();
  }, gid);
  assert.ok(t.turn, 'Ben has a turn');
  assert.deepEqual(Object.keys(t.turn.prev).sort(), ['body', 'kind']);
  assert.equal(t.turn.need, 'draw');
  const stBen = await apiAs(ben, gid);
  assert.equal(stBen.reveal, undefined, 'no reveal data while open');
  assert.ok(!JSON.stringify(stBen).includes('cat doing taxes'), 'state leaks no phrases');
  og = await (await fetch(url)).text();
  assert.match(og, /4 of 4 players have played/);

  // 4. Everyone plays until the round reveals itself (4 chains x 4 steps = 12 turns)
  step = 'play';
  let total = 0;
  for (let pass = 0; pass < 6; pass++) {
    let n = 0;
    for (const p of players) n += await playAll(p, pass);
    total += n;
    const st = await apiAs(anna, gid);
    if (st.round.status === 'revealed') break;
    if (pass === 0) {
      await cleo.page.goto(url);
      await cleo.page.waitForSelector('#doneCard, #readyCard, #reveal');
      if (await cleo.page.$('#doneCard')) await shot(cleo.page, 'phone-done');
    }
  }
  assert.equal(total, 12, 'each of 4 players took 3 turns');

  // 5. Reveal
  step = 'reveal';
  const st = await apiAs(anna, gid);
  assert.equal(st.round.status, 'revealed');
  assert.equal(st.reveal.length, 4);
  for (const c of st.reveal) {
    assert.equal(c.steps.length, 4);
    assert.deepEqual(c.steps.map((s) => s.kind), ['text', 'draw', 'text', 'draw']);
    assert.equal(new Set(c.steps.map((s) => s.by)).size, 4, 'four different people per chain');
  }
  await anna.page.goto(url);
  await anna.page.waitForSelector('#reveal');
  assert.equal(await anna.page.locator('.chain').count(), 4);
  assert.equal(await anna.page.locator('.chain').first().locator('.step').count(), 1);
  await anna.page.locator('[data-next]').first().click();
  await anna.page.waitForTimeout(400);
  assert.equal(await anna.page.locator('.chain').first().locator('.step').count(), 2);
  await shot(anna.page, 'phone-reveal-stepwise');
  await anna.page.click('[data-act=showall]');
  assert.equal(await anna.page.locator('.chain').first().locator('.step').count(), 4);
  await anna.page.waitForTimeout(300);
  await shot(anna.page, 'phone-reveal-all');
  og = await (await fetch(url)).text();
  assert.match(og, /Round 1 is revealed/);

  await dan.page.goto(url);
  await dan.page.waitForSelector('#reveal');
  await dan.page.click('[data-act=showall]');
  await dan.page.waitForTimeout(300);
  await shot(dan.page, 'desktop-reveal');
  const [dl] = await Promise.all([dan.page.waitForEvent('download'), dan.page.locator('[data-save]').first().click()]);
  const file = path.join(SHOTS, 'share-chain.png');
  await dl.saveAs(file);
  assert.ok(fs.statSync(file).size > 20000, 'share image has content');

  // Host removes a step
  step = 'remove-step';
  await anna.page.locator('[data-rm]').nth(1).click();
  await anna.page.waitForSelector('.step.removed');

  // A late joiner sees the reveal after joining
  step = 'late-joiner';
  const eve = await person('Eve', PHONE);
  await eve.page.goto(url);
  await eve.page.waitForSelector('#joinForm');
  assert.match(await eve.page.textContent('#joinCard h2'), /reveal is ready/i);
  await eve.page.fill('#joinName', 'Eve');
  await eve.page.click('#joinForm button[type=submit]');
  await eve.page.waitForSelector('#reveal');

  // 6. Next round on the same link (by a non-host)
  step = 'next-round';
  await ben.page.goto(url);
  await ben.page.waitForSelector('#nextRound');
  await ben.page.click('[data-act=nextround]');
  await ben.page.waitForSelector('#startForm');
  const st2 = await apiAs(ben, gid);
  assert.equal(st2.round.n, 2);
  assert.equal(st2.pastRounds.length, 1);
  await ben.page.click('[data-past]');
  await ben.page.waitForSelector('#reveal');
  assert.equal(await ben.page.locator('.chain').count(), 4);

  // Host reveal-now with a single chain
  step = 'host-reveal';
  await anna.page.goto(url);
  await anna.page.waitForSelector('#startForm');
  await anna.page.fill('#startText', 'a snowman at the beach');
  await anna.page.click('#startForm button[type=submit]');
  await anna.page.waitForSelector('#turnDraw, #doneCard');
  await anna.page.goto(url);
  await anna.page.waitForSelector('[data-act=reveal]');
  await anna.page.click('[data-act=reveal]');
  await anna.page.waitForSelector('#reveal');

  // 7. Delete
  step = 'delete';
  await anna.page.click('[data-act=delete]');
  await anna.page.waitForURL(BASE + '/');
  const gone = await fetch(`${BASE}/api/groups/${gid}`);
  assert.equal(gone.status, 404);

  // Privacy page
  await desk.page.goto(BASE + '/privacy.html');
  assert.match(await desk.page.textContent('h1'), /Privacy/);

  assert.deepEqual(errors, [], 'no console errors');
  console.log('E2E PASS', BASE);
} catch (e) {
  console.error('E2E FAIL at step', step);
  console.error(e);
  console.error('console errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
