// Renders public/og.png (1200x630) and the PNG icons from tools/og.html and public/icon.svg.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const root = path.join(os.homedir(), '.cache/ms-playwright');
const d = fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()[0];
const b = await chromium.launch({ executablePath: path.join(root, d, 'chrome-linux64/chrome') });
const here = path.resolve('tools');
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + path.join(here, 'og.html'));
await p.waitForTimeout(300);
await p.screenshot({ path: 'public/og.png' });
for (const s of [180, 512]) {
  const q = await b.newPage({ viewport: { width: s, height: s } });
  await q.goto('file://' + path.resolve('public/icon.svg'));
  await q.waitForTimeout(150);
  await q.screenshot({ path: `public/icon-${s}.png`, omitBackground: true });
}
await b.close();
