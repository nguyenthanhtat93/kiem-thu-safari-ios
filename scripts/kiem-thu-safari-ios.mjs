/** Kiểm thử Safari thật trong iOS Simulator (máy macOS, safaridriver). Chỉ đọc website thật.
 * node scripts/kiem-thu-safari-ios.mjs <tên simulator> — kết quả .scratch/safari-ios/<máy>/ (ảnh + report.json).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const device = process.argv[2];
if (!device) throw new Error('Thiếu tên simulator');
const out = `.scratch/safari-ios/${device.replace(/[^\w]+/g, '-')}`;
mkdirSync(out, { recursive: true });
const pages = [
  ['duoc365', 'https://duoc365.com/'],
  ['duoc365', 'https://duoc365.com/dang-nhap'],
  ['duoc365', 'https://duoc365.com/dang-ky-tai-khoan'],
  ['duoc365', 'https://duoc365.com/ho-tro'],
  ['duoc365', 'https://duoc365.com/chinh-sach-bao-mat'],
  ['thanhtat', 'https://thanhtat.com/'],
  ['thanhtat', 'https://thanhtat.com/login'],
  ['thanhtat', 'https://thanhtat.com/register'],
  ['thanhtat', 'https://thanhtat.com/ho-tro'],
  ['thanhtat', 'https://thanhtat.com/chinh-sach-bao-mat'],
];
const port = 4444;
const driver = spawn('safaridriver', ['-p', String(port)], { stdio: 'inherit' });
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wd(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value).slice(0, 400)}`);
  return json.value;
}
const results = [];
let session;
try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/status'); break; } catch { await sleep(500); } }
  session = (await wd('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'Safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceName': device,
  } } })).sessionId;
  console.log('Phiên Safari iOS:', device);
  for (const [site, url] of pages) {
    const name = `${site}-${new URL(url).pathname.replace(/\//g, '') || 'trang-chu'}`;
    try {
      await wd('POST', `/session/${session}/url`, { url });
      await sleep(4000);
      const m = await wd('POST', `/session/${session}/execute/sync`, { args: [], script: `
        const input = document.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio])');
        const h = document.querySelector('h1,h2');
        const small = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')]
          .filter(e => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.name || e.id || e.placeholder || e.type);
        const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; })
          .slice(0, 5).map(e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''));
        return { title: document.title, heading: h && h.textContent.trim().slice(0, 80), width: innerWidth, scroll: document.documentElement.scrollWidth,
          ua: navigator.userAgent, safeTop: getComputedStyle(document.documentElement).getPropertyValue('--top-safe'), smallInputs: small, wide,
          viewport: document.querySelector('meta[name=viewport]')?.content, input: input && getComputedStyle(input).fontSize };` });
      const shot = await wd('GET', `/session/${session}/screenshot`);
      writeFileSync(`${out}/${name}.png`, Buffer.from(shot, 'base64'));
      const problems = [];
      if (m.scroll > m.width + 1) problems.push(`tràn ngang ${m.scroll} > ${m.width}: ${m.wide.join(', ')}`);
      if (m.smallInputs.length) problems.push(`ô nhập < 16px (Safari tự phóng to): ${m.smallInputs.join(', ')}`);
      if (!m.heading) problems.push('không thấy tiêu đề trang');
      results.push({ device, url, ok: !problems.length, problems, ...m });
      console.log(problems.length ? 'LỖI' : 'ĐẠT', device, url, problems.join('; '));
    } catch (e) {
      results.push({ device, url, ok: false, problems: [String(e.message || e)] });
      console.log('LỖI', device, url, String(e.message || e).slice(0, 300));
    }
  }
} finally {
  if (session) await wd('DELETE', `/session/${session}`).catch(() => {});
  driver.kill();
  writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
}
const failed = results.filter(r => !r.ok).length;
console.log(`${device}: ${results.length - failed} đạt, ${failed} lỗi`);
if (failed || !results.length) process.exitCode = 1;
