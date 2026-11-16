// Chrome 窗口管理：每个账号一个独立 profile + 独立调试端口 + 独立窗口
import { spawn, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './store.js';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
];

export function findChrome() {
  for (const p of CHROME_CANDIDATES) if (p && fs.existsSync(p)) return p;
  throw new Error('找不到 chrome.exe');
}

const procs = new Map(); // accountId -> ChildProcess

export async function cdpAlive(port, timeoutMs = 1500) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 打开账号窗口
 * @param {object} acc 账号配置
 * @param {{x?:number,y?:number,width?:number,height?:number,startUrl?:string}} opts
 */
export async function openWindow(acc, opts = {}) {
  if (await cdpAlive(acc.port)) return { already: true, port: acc.port };

  ensureDir(acc.profile);
  const chrome = findChrome();
  const args = [
    `--remote-debugging-port=${acc.port}`,
    `--user-data-dir=${acc.profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--disable-features=Translate,MediaRouter',
    `--window-size=${opts.width || 520},${opts.height || 900}`
  ];
  if (opts.x !== undefined) args.push(`--window-position=${opts.x},${opts.y ?? 0}`);
  args.push(opts.startUrl || 'https://www.douyin.com/');

  const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
  child.unref();
  procs.set(acc.id, child);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(acc.port)) {
      // 等页面真正开始导航，避免抓到 about:blank
      for (let j = 0; j < 20; j++) {
        try {
          const list = await (await fetch(`http://127.0.0.1:${acc.port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
          if (list.some((x) => x.type === 'page' && /^https?:\/\//.test(x.url || ''))) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      return { launched: true, port: acc.port, pid: child.pid };
    }
  }
  throw new Error(`账号 ${acc.id} 的 Chrome 启动超时（端口 ${acc.port}）`);
}

export function closeWindow(acc) {
  const child = procs.get(acc.id);
  if (child?.pid) {
    exec(`taskkill /PID ${child.pid} /T /F`, () => {});
    procs.delete(acc.id);
    return true;
  }
  return false;
}

/** 按账号数把窗口横向铺开 */
export function tileLayout(count, workArea) {
  const n = Math.max(1, count);
  const w = Math.floor(workArea.width / n);
  const h = workArea.height;
  return Array.from({ length: n }, (_, i) => ({
    x: workArea.x + i * w,
    y: workArea.y,
    width: w,
    height: h
  }));
}
