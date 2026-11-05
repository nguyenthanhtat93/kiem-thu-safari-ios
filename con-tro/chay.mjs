/** Đo con trỏ trong textarea có chữ gợi ý trên Safari iOS thật: node con-tro/chay.mjs <tên simulator> <udid> */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const [device, udid] = process.argv.slice(2);
const out = `.scratch/con-tro`; mkdirSync(out, { recursive: true });
const http = spawn('python3', ['-m', 'http.server', '8123', '-d', 'con-tro'], { stdio: 'ignore' });
const driver = spawn('safaridriver', ['-p', '4444'], { stdio: 'inherit' });
const base = 'http://127.0.0.1:4444', sleep = ms => new Promise(r => setTimeout(r, ms));
async function wd(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json(); if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value).slice(0, 400)}`); return json.value;
}
let session;
try {
  for (let i = 0; i < 240; i++) { try { await fetch(base + '/status'); break; } catch { await sleep(500); } }
  session = (await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'Safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceName': device, 'safari:deviceUDID': udid } } })).sessionId;
  for (const v of ['a', 'b', 'c', 'd', 'e', 'f']) {
    await wd('POST', `/session/${session}/url`, { url: `http://127.0.0.1:8123/index.html?v=${v}` });
    await sleep(1500);
    const el = await wd('POST', `/session/${session}/element`, { using: 'css selector', value: '#t' });
    await wd('POST', `/session/${session}/element/${Object.values(el)[0]}/click`, {});
    for (let k = 0; k < 4; k++) { await sleep(280); execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', `${out}/${v}-${k}.png`], { stdio: 'ignore' }); }
    console.log('xong', v);
  }
} finally { if (session) await wd('DELETE', `/session/${session}`).catch(() => {}); driver.kill(); http.kill(); }
