// 冒烟测试：开窗 → 查登录态（不搜索）
import { loadConfig } from '../app/core/store.js';
import { openWindow, cdpAlive } from '../app/core/chrome.js';
import { connectAt, evaluate } from '../tools/lib.mjs';

const cfg = loadConfig();
const acc = cfg.accounts[0];

const r = await openWindow(acc, { width: 520, height: 900 });
console.log('开窗结果:', r);
console.log('CDP 存活:', await cdpAlive(acc.port));

const page = await connectAt(acc.port);
const st = await evaluate(page.send, `(() => {
  const t = document.body?.innerText || '';
  return {
    url: location.href,
    title: document.title,
    needLogin: /扫码登录|立即登录|登录后/.test(t.slice(0, 3000)),
    hasAvatar: !!document.querySelector('[data-e2e="user-avatar"], img[src*="aweme-avatar"]')
  };
})()`);
console.log('页面状态:', st);
page.close();
