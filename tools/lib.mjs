// 抖音采集公共库：CDP 连接、搜索接口拦截、数据提取
import { spawn } from 'node:child_process';

export const PORT = 9222;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function cdpUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

export async function ensureChrome(opts = {}) {
  const profileDir = opts.profileDir || 'D:\\抖音auto\\chrome-profile';
  const chrome = opts.chrome || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (await cdpUp()) return { launched: false };

  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    'https://www.douyin.com/'
  ];
  if (opts.headless) args.unshift('--headless=new');

  const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(700);
    if (await cdpUp()) return { launched: true };
  }
  throw new Error('Chrome 启动超时，CDP 端口仍不可用');
}

async function pickPage(port = PORT) {
  // 页面刚打开时可能是 about:blank，等一下真正带 URL 的页面
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
    const t = await r.json();
    const pages = t.filter((x) => x.type === 'page');
    const http = pages.filter((x) => /^https?:\/\//.test(x.url || ''));
    const dy = http.find((x) => /douyin\.com/.test(x.url));
    if (dy) return dy;
    if (http.length) return http[0];
    if (attempt === 19) return pages[0];
    await new Promise((res) => setTimeout(res, 500));
  }
}

export async function connectAt(port = PORT) {
  const target = await pickPage(port);
  if (!target) throw new Error(`端口 ${port} 没有可用的 page target`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const listeners = new Map();

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method) {
      const arr = listeners.get(m.method);
      if (arr) for (const fn of [...arr]) { try { fn(m.params); } catch {} }
    }
  };

  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 30000);
  });

  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
    return () => {
      const a = listeners.get(method);
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    };
  };

  return { send, on, ws, close: () => ws.close() };
}

export async function evaluate(send, expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS 异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

export function extractAwemes(root, out) {
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    const id = o.aweme_id;
    if (typeof id === 'string' && /^\d{10,}$/.test(id) && !out.has(id)) {
      const isImage = o.aweme_type === 68 || (Array.isArray(o.images) && o.images.length > 0);
      out.set(id, {
        id,
        type: isImage ? '图文' : '视频',
        desc: (o.desc || '').replace(/\s+/g, ' ').slice(0, 200),
        author: o.author?.nickname || '',
        secUid: o.author?.sec_uid || '',
        digg: o.statistics?.digg_count ?? null,
        comment: o.statistics?.comment_count ?? null,
        createTime: o.create_time ? new Date(o.create_time * 1000).toISOString() : null,
        url: (isImage ? 'https://www.douyin.com/note/' : 'https://www.douyin.com/video/') + id
      });
    }
    for (const k in o) walk(o[k]);
  };
  walk(root);
}

const SEARCH_RE = /\/aweme\/v1\/web\/(general\/search\/single|search\/item|search\/single)/;

export function attachSearchCapture(send, on, found) {
  const urlById = new Map();
  const stats = { packets: 0, reqUrls: [] };

  const off1 = on('Network.requestWillBeSent', (p) => { urlById.set(p.requestId, p.request.url); });
  const off2 = on('Network.responseReceived', (p) => {
    if (SEARCH_RE.test(p.response.url)) stats.reqUrls.push(p.response.url);
  });
  const off3 = on('Network.loadingFinished', (p) => {
    const url = urlById.get(p.requestId);
    if (!url || !SEARCH_RE.test(url)) return;
    (async () => {
      try {
        const r = await send('Network.getResponseBody', { requestId: p.requestId });
        const txt = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
        extractAwemes(JSON.parse(txt), found);
        stats.packets++;
      } catch {}
    })();
  });

  return { stats, off: () => { off1(); off2(); off3(); } };
}

export const CAPTCHA_JS = `(() => /请选择所有|拖拽到下方|拖动到下方|完成验证|安全验证/.test(document.body.innerText || ''))()`;
export const END_JS = `({y: scrollY, h: document.documentElement.scrollHeight, end: /暂时没有更多|没有更多了|到底了/.test((document.body.innerText||'').slice(-400))})`;
export const LOGIN_JS = `(() => ({ needLogin: /扫码登录|登录后|立即登录/.test((document.body.innerText||'').slice(0,3000)), hasAvatar: !!document.querySelector('[data-e2e="user-avatar"], img[src*="aweme-avatar"]') }))()`;

/**
 * 跑一次关键词搜索并采集（接口拦截）
 * @returns {Promise<{url, items, stats, captcha, needLogin, rounds}>}
 */
export async function runSearch(page, keyword, opts = {}) {
  const { send, on } = page;
  const { publishTime = null, maxRounds = 40, interval = 700 } = opts;

  const found = new Map();
  const cap = attachSearchCapture(send, on, found);

  const enc = encodeURIComponent(keyword);
  const qs = publishTime ? `?publish_time=${publishTime}` : '';
  const url = `https://www.douyin.com/search/${enc}${qs}`;

  await send('Page.enable');
  await send('Network.enable');
  await send('Page.navigate', { url });
  await sleep(3500);

  const geo = await evaluate(send, `({w: innerWidth, h: innerHeight})`);
  const cx = Math.round(geo.w / 2), cy = Math.round(geo.h / 2);
  const wheel = async (dy = 800) => {
    try {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: dy, modifiers: 0, pointerType: 'mouse' });
    } catch {}
  };

  let stale = 0, rounds = 0, captcha = false, needLogin = false;

  for (; rounds < maxRounds; rounds++) {
    const before = found.size;
    for (let k = 0; k < 3; k++) { await wheel(800); await sleep(interval); }
    await sleep(500);

    const grew = found.size > before;
    stale = grew ? 0 : stale + 1;

    captcha = await evaluate(send, CAPTCHA_JS).catch(() => false);
    if (captcha) break;

    const st = await evaluate(send, END_JS).catch(() => ({}));
    if (st.end && stale >= 1) break;
    if (stale >= 5) break;
  }

  if (found.size === 0) {
    const lg = await evaluate(send, LOGIN_JS).catch(() => ({}));
    needLogin = !!lg.needLogin && !lg.hasAvatar;
  }

  cap.off();
  return { url, items: [...found.values()], stats: cap.stats, captcha, needLogin, rounds };
}

export function toCsv(rows, headers) {
  const esc = (s) => {
    s = (s ?? '').toString().replace(/\r?\n/g, ' ').trim();
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return '\ufeff' + lines.join('\r\n');
}
