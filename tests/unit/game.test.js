import test from 'node:test';
import assert from 'node:assert/strict';
import { pickChain, roundComplete, validateDrawing, validateText, nextKind } from '../../functions/_game.js';

// Simulate a whole round: n players start chains, then play turns in random order.
function simulate(n, maxSteps, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const members = Array.from({ length: n }, (_, i) => 'm' + i);
  const chains = members.map((m, i) => ({ id: 'c' + i, len: 1, lock_member: null, lock_until: 0, updated_at: i, kinds: ['text'], who: [m] }));
  const playedBy = new Map(chains.map((c) => [c.id, new Set(c.who)]));
  let t = 100;
  for (let guard = 0; guard < 10000; guard++) {
    if (roundComplete(chains, members, playedBy, maxSteps)) return { chains, done: true };
    const m = members[Math.floor(rnd() * n)];
    const played = new Set(chains.filter((c) => playedBy.get(c.id).has(m)).map((c) => c.id));
    const c = pickChain(chains, m, played, new Set(), t, maxSteps);
    t++;
    if (!c) continue;
    c.kinds.push(nextKind(c.kinds[c.kinds.length - 1]));
    c.who.push(m);
    c.len++;
    c.updated_at = t;
    playedBy.get(c.id).add(m);
  }
  return { chains, done: false };
}

test('rounds complete; chains alternate text/draw; nobody plays a chain twice', () => {
  for (const n of [3, 4, 5, 7, 10, 20]) {
    for (const maxSteps of [4, 6, 8]) {
      for (let seed = 1; seed <= 20; seed++) {
        const { chains, done } = simulate(n, maxSteps, seed);
        assert.ok(done, `n=${n} max=${maxSteps} seed=${seed} did not finish`);
        for (const c of chains) {
          assert.equal(c.len, Math.min(n, maxSteps));
          assert.equal(new Set(c.who).size, c.who.length);
          c.kinds.forEach((k, i) => assert.equal(k, i % 2 === 0 ? 'text' : 'draw'));
        }
      }
    }
  }
});

test('round is not complete with fewer than 3 chains or a player still to go', () => {
  const chains = [{ id: 'a', len: 2 }, { id: 'b', len: 2 }];
  const pb = new Map([['a', new Set(['x', 'y'])], ['b', new Set(['x', 'y'])]]);
  assert.equal(roundComplete(chains, ['x', 'y'], pb, 6), false);
  const c3 = [...chains, { id: 'c', len: 2 }];
  pb.set('c', new Set(['x', 'y']));
  assert.equal(roundComplete(c3, ['x', 'y'], pb, 6), true);
  assert.equal(roundComplete(c3, ['x', 'y', 'z'], pb, 6), false); // z joined but has not played
});

test('locks: a chain held by someone else is not offered until the lock expires', () => {
  const chains = [{ id: 'a', len: 1, lock_member: 'other', lock_until: 200, updated_at: 0 }];
  assert.equal(pickChain(chains, 'me', new Set(), new Set(), 150, 6), null);
  assert.equal(pickChain(chains, 'me', new Set(), new Set(), 201, 6).id, 'a');
  assert.equal(pickChain(chains, 'other', new Set(), new Set(), 150, 6).id, 'a');
});

test('skip prefers another chain but falls back when it is the only one', () => {
  const chains = [{ id: 'a', len: 1, updated_at: 0 }, { id: 'b', len: 1, updated_at: 1 }];
  assert.equal(pickChain(chains, 'me', new Set(), new Set(['a']), 0, 6).id, 'b');
  assert.equal(pickChain(chains.slice(0, 1), 'me', new Set(), new Set(['a']), 0, 6).id, 'a');
});

test('drawing validation', () => {
  assert.equal(validateDrawing(null), null);
  assert.equal(validateDrawing({ s: [] }), null);
  assert.equal(validateDrawing({ s: [[9, 1, 10, 10, 20, 20]] }), null, 'eraser only = blank');
  assert.equal(validateDrawing({ s: [[10, 1, 10, 10]] }), null, 'bad colour');
  assert.equal(validateDrawing({ s: [[0, 3, 10, 10]] }), null, 'bad size');
  assert.equal(validateDrawing({ s: [[0, 1, 10, 10, 20]] }), null, 'odd coords');
  assert.equal(validateDrawing({ s: [[0, 1, 'x', 10]] }), null);
  assert.equal(validateDrawing({ s: [[0, 1, -5, 2000.4]] }), '{"s":[[0,1,0,1000]]}');
  const big = { s: [[0, 1, ...Array.from({ length: 30000 }, (_, i) => i % 1000)]] };
  assert.equal(validateDrawing(big), null, 'too many points');
});

test('text validation', () => {
  assert.equal(validateText('  a   cat\n doing taxes '), 'a cat doing taxes');
  assert.equal(validateText('x'), null);
  assert.equal(validateText(42), null);
  assert.equal(validateText('y'.repeat(200)).length, 80);
});
