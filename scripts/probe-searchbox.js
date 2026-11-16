// 探测：搜索框能不能被点到、逐字输入是否生效（不发搜索，输完就清掉）
import { loadConfig } from '../app/core/store.js';
import { openWindow } from '../app/core/chrome.js';
import { connectAt, evaluate, sleep } from '../tools/lib.mjs';
import { humanClick, typeText, mouseMoveTo } from '../app/core/behavior.js';

const cfg = loadConfig();
const acc = cfg.accounts[0];
await openWindow(acc, { width: 520, height: 900 });

const page = await connectAt(acc.port);
await page.send('Page.enable');
await page.send('Input.enable').catch(() => {});

// 确保在首页
await page.send('Page.navigate', { url: 'https://www.douyin.com/' });
await sleep(3500);

const box = await evaluate(page.send, `(() => {
  const el = document.querySelector('[data-e2e="searchbar-input"]') || document.querySelector('input[placeholder*="搜索"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: r.width, h: r.height,
           tag: el.tagName, e2e: el.getAttribute('data-e2e') };
})()`);
console.log('搜索框:', box);

if (box) {
  await humanClick(page, box.x, box.y);
  await sleep(400);
  await typeText(page, 'BLG');
  await sleep(900);
  const value = await evaluate(page.send, `(() => {
    const el = document.querySelector('[data-e2e="searchbar-input"]') || document.querySelector('input[placeholder*="搜索"]');
    return el ? el.value : null;
  })()`);
  console.log('输入框当前值:', JSON.stringify(value));

  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync('D:\\抖音auto\\data\\probe-searchbox.png', Buffer.from(shot.data, 'base64'));
  console.log('截图已存');

  // 清空，不留痕迹
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await sleep(300);
  const after = await evaluate(page.send, `(() => {
    const el = document.querySelector('[data-e2e="searchbar-input"]') || document.querySelector('input[placeholder*="搜索"]');
    return el ? el.value : null;
  })()`);
  console.log('清空后:', JSON.stringify(after));
}
page.close();
