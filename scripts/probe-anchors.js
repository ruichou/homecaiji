// 诊断：指定页面上的视频链接情况 + 左侧导航的「推荐」入口
import { loadConfig } from '../app/core/store.js';
import { connectAt, evaluate, sleep } from '../tools/lib.mjs';

const cfg = loadConfig();
const acc = cfg.accounts[0];
const page = await connectAt(acc.port);

const target = process.argv[2];
if (target) {
  await page.send('Page.navigate', { url: target });
  await sleep(3500);
}

const info = await evaluate(page.send, `(() => {
  const as = [...document.querySelectorAll('a[href*="/video/"]')];
  const rows = as.slice(0, 12).map(a => {
    const r = a.getBoundingClientRect();
    return { top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
             pass: r.top > 120 && r.top < innerHeight - 160 && r.width > 80 };
  });
  const navs = [...document.querySelectorAll('a[href]')]
    .filter(a => /推荐|精选|关注|朋友/.test(a.innerText || ''))
    .slice(0, 8)
    .map(a => ({ text: (a.innerText || '').trim().slice(0, 8), href: a.getAttribute('href') }));
  return { url: location.href, innerH: innerHeight, total: as.length,
           pass: rows.filter(r => r.pass).length, sample: rows, navs };
})()`);
console.log(JSON.stringify(info, null, 2));
page.close();
