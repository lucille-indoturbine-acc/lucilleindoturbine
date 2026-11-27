/** Project details' Starts field opens the app's calendar (DateField), a pick
 *  lands in the database, and picking the old date through the same panel puts
 *  it back with the week grid unchanged. Usage:
 *    node scripts/_press-project-dates.mjs <width> <height> <out-prefix>
 *  PRESS_BASE picks the server (default http://localhost:3213). Signs in with a
 *  ten-minute session in data/auth.json and removes it. Exits 1 on any failure. */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const B = process.env.PRESS_BASE || 'http://localhost:3213';
const W = Number(process.argv[2] || 1280);
const H = Number(process.argv[3] || 900);
const OUT = process.argv[4] || 'shot';
const PROJECT = 'pdemo-merbau';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUTH = 'data/auth.json';
const token = randomBytes(32).toString('base64url');
const editAuth = (fn) => {
  const doc = JSON.parse(readFileSync(AUTH, 'utf8'));
  fn(doc);
  writeFileSync(AUTH, JSON.stringify(doc));
};
editAuth((d) => (d.sessions[token] = { id: d.accounts[0].id, exp: Date.now() + 600_000 }));

const read = () => {
  const db = new Database('data/report.db', { readonly: true });
  const start = db.prepare('select start_date as s from projects where id = ?').get(PROJECT).s;
  const weeks = db.prepare('select week_no, start_date, end_date from weeks where project_id = ? order by week_no').all(PROJECT);
  db.close();
  return { start, weeks: JSON.stringify(weeks) };
};

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed++;
  console.log(ok ? '  ok  ' : '  FAIL', what);
};

const before = read();
const [y, mo, d] = before.start.split('-').map(Number);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const other = d < 28 ? d + 1 : d - 1;
const otherIso = `${y}-${String(mo).padStart(2, '0')}-${String(other).padStart(2, '0')}`;

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: exe, headless: true });
try {
  const p = await b.newPage();
  const mobile = W < 600;
  await p.setViewport({ width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await p.setCookie({ name: 'lucille_session', value: token, url: B });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));

  const trigger = '#pd-startDate';
  const triggerText = () => p.$eval(trigger, (el) => el.textContent.trim());
  const openDetails = async () => {
    await p.goto(`${B}/projects/${PROJECT}`, { waitUntil: 'networkidle0', timeout: 90_000 });
    await p.waitForSelector('button[aria-label="Project details"]', { visible: true });
    await sleep(500);
    await p.click('button[aria-label="Project details"]');
    await p.waitForSelector(trigger, { visible: true });
    await sleep(600);
  };
  const pick = async (day) => {
    await p.$eval(trigger, (el) => el.scrollIntoView({ block: 'center' }));
    await sleep(200);
    await p.click(trigger);
    await p.waitForSelector('[role=dialog][aria-label="Choose a date"]', { visible: true });
    await sleep(400);
    return `[role=dialog][aria-label="Choose a date"] [aria-label="${day} ${MONTHS[mo - 1]} ${y}"]`;
  };

  await openDetails();
  check((await p.$eval(trigger, (el) => el.tagName)) === 'BUTTON', 'Starts is a button (our trigger), not <input type=date>');
  check((await p.$$('input[type=date]')).length === 0, 'no native date input on the page');
  const label0 = await triggerText();

  const dayCell = await pick(other);
  const panel = await p.$eval('[role=dialog][aria-label="Choose a date"]', (el) => {
    const r = el.getBoundingClientRect();
    return {
      text: el.textContent,
      prev: !!el.querySelector('[aria-label=Previous]'),
      next: !!el.querySelector('[aria-label=Next]'),
      inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    };
  });
  check(/Mo\s*Tu\s*We\s*Th\s*Fr\s*Sa\s*Su/.test(panel.text), 'weekdays Mo..Su');
  check(panel.prev && panel.next, 'chevrons Previous / Next');
  check(/Today/.test(panel.text), 'Today button');
  check(panel.inView, `panel fits the ${W}px viewport`);
  await p.screenshot({ path: `${OUT}-${W}.png` });

  await p.click(dayCell);
  await p.waitForFunction((sel, old) => document.querySelector(sel)?.textContent.trim() !== old, { timeout: 20_000 }, trigger, label0);
  await sleep(800);
  const mid = read();
  check(mid.start === otherIso, `database start ${mid.start} = ${otherIso}`);
  console.log('  trigger', label0, '->', await triggerText());

  // Put it back through the same panel.
  const backCell = await pick(d);
  await p.click(backCell);
  await p.waitForFunction((sel, old) => document.querySelector(sel)?.textContent.trim() === old, { timeout: 20_000 }, trigger, label0);
  await sleep(800);
  const after = read();
  check(after.start === before.start, `database start restored ${after.start}`);
  check(after.weeks === before.weeks, 'week grid identical to before');
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally {
  await b.close();
  editAuth((d) => delete d.sessions[token]);
}
process.exit(failed ? 1 : 0);
