// 抖音搜索页视频链接采集器 —— 直连本地 Chrome 的 CDP，无需任何第三方依赖
// 用法:
//   node tools/dy.mjs status
//   node tools/dy.mjs nav "https://www.douyin.com/search/保洁?type=video"
//   node tools/dy.mjs collect "保洁" [maxRounds]
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9222;
const OUT_DIR = 'D:\\抖音auto\\data';

async function listTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

async function pickPage() {
  const t = await listTargets();
  const pages = t.filter(x => x.type === 'page');
  return pages.find(x => /douyin\.com/.test(x.url)) || pages[0];
}

async function connect() {
  const target = await pickPage();
  if (!target) throw new Error('没有找到可用的 page target，Chrome 是否启动？');
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
      if (arr) for (const fn of arr) { try { fn(m.params); } catch {} }
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
  };
  return { send, on, ws, target };
}

async function evaluate(send, expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise, userGesture: true
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error('JS 异常: ' + d);
  }
  return r.result.value;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 页面内函数（字符串形式注入） ----------
const HARVEST = `(() => {
  const seen = new Set();
  const items = [];
  document.querySelectorAll('a[href*="/video/"]').forEach(a => {
    const m = a.href.match(/\\/video\\/(\\d{5,})/);
    if (!m) return;
    const id = m[1];
    if (seen.has(id)) return;
    seen.add(id);
    let card = a.closest('li') || a.closest('[data-e2e]') || a.parentElement?.parentElement?.parentElement;
    let text = (card?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
    items.push({ id, url: 'https://www.douyin.com/video/' + id, text });
  });
  return items;
})()`;

const SCROLL = `(() => {
  const before = window.scrollY;
  const h0 = document.documentElement.scrollHeight;
  window.scrollTo(0, h0);
  const cands = [...document.querySelectorAll('div')]
    .filter(d => d.scrollHeight > d.clientHeight + 300)
    .slice(0, 6);
  for (const c of cands) { c.scrollTop = c.scrollHeight; }
  return { before, after: window.scrollY, h0, h1: document.documentElement.scrollHeight,
           title: document.title, url: location.href };
})()`;

const LOGIN_HINT = `(() => {
  const txt = document.body?.innerText || '';
  const hasLoginBtn = /登录|扫码登录|立即登录/.test(txt.slice(0, 3000));
  const hasAvatar = !!document.querySelector('[data-e2e="user-avatar"], img[src*="aweme-avatar"]');
  return { hasLoginBtn, hasAvatar, title: document.title, url: location.href,
           head: txt.replace(/\\s+/g, ' ').slice(0, 300) };
})()`;

function csvEscape(s) {
  s = (s ?? '').toString().replace(/\r?\n/g, ' ').trim();
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function cmdLogin() {
  const { send } = await connect();
  await send('Page.enable');
  const clicked = await evaluate(send, `(() => {
    const cands = [...document.querySelectorAll('div,button,span,a')]
      .filter(e => (e.innerText || '').trim() === '登录' && e.offsetParent !== null);
    if (!cands.length) return 'not-found';
    cands[cands.length - 1].click();
    return 'clicked:' + cands.length;
  })()`);
  console.log('点击登录按钮:', clicked);
  await sleep(2000);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = 'D:\\抖音auto\\data';
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'login.png');
  fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
  const modal = await evaluate(send, `(() => {
    const t = document.body.innerText || '';
    return { hasQrWord: /扫码|二维码|验证码/.test(t), url: location.href };
  })()`);
  console.log('二维码区域:', JSON.stringify(modal));
  console.log('截图:', p);
}

async function cmdShot(outPath) {
  const { send } = await connect();
  await send('Page.enable');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const p = outPath || 'D:\\抖音auto\\data\\shot.png';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
  console.log('saved', p);
}

async function cmdWheel(times = 12) {
  const { send } = await connect();
  await send('Page.enable');
  const geo = await evaluate(send, `({w: window.innerWidth, h: window.innerHeight, y: window.scrollY, sh: document.documentElement.scrollHeight})`);
  const cx = Math.round(geo.w / 2), cy = Math.round(geo.h / 2);
  console.log('视口', geo, '滚轮点', cx, cy);

  let last = -1;
  for (let i = 1; i <= times; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 700, modifiers: 0, pointerType: 'mouse'
    });
    await sleep(1200);
    const s = await evaluate(send, `({n: document.querySelectorAll('a[href*="/video/"]').length, y: window.scrollY, sh: document.documentElement.scrollHeight})`);
    console.log(`wheel ${i} | 链接 ${s.n} | scrollY ${s.y} | docH ${s.sh}`);
    if (s.n === last && i > 3) { console.log('连续不动，停止'); break; }
    last = s.n;
  }
}

async function cmdDump() {
  const { send } = await connect();
  const info = await evaluate(send, `(() => {
    const as = [...document.querySelectorAll('a')];
    const groups = {};
    as.forEach(a => {
      const h = a.getAttribute('href') || '';
      const k = h.replace(/\\d{6,}/g, '<id>').split('?')[0];
      groups[k] = (groups[k] || 0) + 1;
    });
    const groupsSorted = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const e2e = {};
    document.querySelectorAll('[data-e2e]').forEach(e => {
      const k = e.getAttribute('data-e2e');
      e2e[k] = (e2e[k] || 0) + 1;
    });
    const e2eSorted = Object.entries(e2e).sort((a, b) => b[1] - a[1]).slice(0, 30);
    const imgs = [...document.querySelectorAll('img')].map(i => i.src).filter(s => /aweme|douyinpic/.test(s)).slice(0, 3);
    return {
      anchors: as.length, divs: document.querySelectorAll('div').length,
      groups: groupsSorted, e2e: e2eSorted, sampleImg: imgs,
      scrollY: window.scrollY, docH: document.documentElement.scrollHeight
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
}

async function cmdInspect() {
  const { send } = await connect();
  const info = await evaluate(send, `(() => {
    const out = [];
    document.querySelectorAll('*').forEach(el => {
      const sh = el.scrollHeight, ch = el.clientHeight;
      if (sh > ch + 200 && ch > 200) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        out.push({
          tag: el.tagName,
          cls: (el.className || '').toString().slice(0, 70),
          sh, ch, oy: cs.overflowY,
          top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
          videos: el.querySelectorAll('a[href*="/video/"]').length
        });
      }
    });
    out.sort((a, b) => (b.sh - b.ch) - (a.sh - a.ch));
    return {
      innerH: window.innerHeight, docH: document.documentElement.scrollHeight,
      bodyH: document.body.scrollHeight,
      scrollables: out.length, top: out.slice(0, 12)
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
}

async function cmdStatus() {
  const { send } = await connect();
  const info = await evaluate(send, LOGIN_HINT);
  console.log(JSON.stringify(info, null, 2));
  const n = await evaluate(send, 'document.querySelectorAll(\'a[href*="/video/"]\').length');
  console.log('页面上现有视频链接数:', n);
}

async function cmdNav(url) {
  const { send } = await connect();
  await send('Page.enable');
  await send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const st = await evaluate(send, 'document.readyState');
      if (st === 'complete') break;
    } catch {}
  }
  console.log('已跳转:', await evaluate(send, 'location.href'));
}

// 从搜索接口 JSON 里递归挖出所有 aweme（视频 + 图文）
function extractAwemes(root, out) {
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    const id = o.aweme_id;
    if (typeof id === 'string' && /^\d{10,}$/.test(id) && !out.has(id)) {
      const isImage = o.aweme_type === 68 || Array.isArray(o.images) && o.images.length > 0;
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

// 挂上搜索接口监听：把命中的响应体解析成 aweme 塞进 found
function attachSearchCapture(send, on, found, onPacket) {
  const RE = /\/aweme\/v1\/web\/(general\/search\/single|search\/item|search\/single)/;
  const urlById = new Map();
  const stats = { packets: 0, reqUrls: [] };
  on('Network.requestWillBeSent', (p) => { urlById.set(p.requestId, p.request.url); });
  on('Network.responseReceived', (p) => {
    if (RE.test(p.response.url)) stats.reqUrls.push(p.response.url);
  });
  on('Network.loadingFinished', (p) => {
    const url = urlById.get(p.requestId);
    if (!url || !RE.test(url)) return;
    (async () => {
      try {
        const r = await send('Network.getResponseBody', { requestId: p.requestId });
        const txt = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
        const before = found.size;
        extractAwemes(JSON.parse(txt), found);
        stats.packets++;
        if (onPacket) onPacket(found.size - before, found.size);
      } catch {}
    })();
  });
  return stats;
}

const isCaptcha = `(() => /请选择所有|拖拽到下方|拖动到下方|完成验证|安全验证/.test(document.body.innerText || ''))()`;

async function cmdProbe(keyword) {
  const { send, on } = await connect();
  await send('Network.enable');
  await send('Page.enable');
  const enc = encodeURIComponent(keyword);

  for (const qs of ['?publish_time=7', '']) {
    const found = new Map();
    const stats = attachSearchCapture(send, on, found);
    const url = `https://www.douyin.com/search/${enc}${qs}`;
    console.log(`\n=== 测试 ${qs || '(无筛选)'} ===`);
    await send('Page.navigate', { url });
    await sleep(6000);
    // 滚两下，让首批结果都出来
    const geo = await evaluate(send, `({w: innerWidth, h: innerHeight})`);
    for (let i = 0; i < 2; i++) {
      try {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(geo.w / 2), y: Math.round(geo.h / 2), deltaX: 0, deltaY: 800, pointerType: 'mouse' });
      } catch {}
      await sleep(900);
    }
    await sleep(1200);
    console.log('拿到条数:', found.size);
    console.log('接口请求:');
    for (const u of [...new Set(stats.reqUrls)].slice(0, 4)) {
      const q = u.split('?')[1] || '';
      console.log('  ' + decodeURIComponent(q).slice(0, 300));
    }
    const cap = await evaluate(send, isCaptcha);
    if (cap) { console.log('!! 出现验证码，停止探测'); return; }
  }
}

async function cmdApi(keyword, maxRounds = 80, tab = '综合') {
  const { send, on } = await connect();
  await send('Network.enable');
  await send('Page.enable');

  const found = new Map();
  const endpoints = new Map();
  const urlById = new Map();
  let bodies = 0;
  const RE = /\/aweme\/v1\/web\/(general\/search\/single|search\/item|search\/single)/;

  on('Network.requestWillBeSent', (p) => { urlById.set(p.requestId, p.request.url); });
  on('Network.loadingFinished', (p) => {
    const url = urlById.get(p.requestId);
    if (!url || !RE.test(url)) return;
    const path = url.split('?')[0];
    endpoints.set(path, (endpoints.get(path) || 0) + 1);
    (async () => {
      try {
        const r = await send('Network.getResponseBody', { requestId: p.requestId });
        const txt = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
        const json = JSON.parse(txt);
        const before = found.size;
        extractAwemes(json, found);
        bodies++;
        console.log(`  ← 接口包 #${bodies}: +${found.size - before} 条 (累计 ${found.size})`);
      } catch (e) { console.log('  解析接口包失败:', e.message); }
    })();
  });

  const tabParam = { '视频': '?type=video', '用户': '?type=user', '直播': '?type=live' }[tab] || '';
  const url = `https://www.douyin.com/search/${encodeURIComponent(keyword)}${tabParam}`;
  console.log('打开:', url);
  await send('Page.navigate', { url });
  await sleep(3000);

  const geo = await evaluate(send, `({w: innerWidth, h: innerHeight})`);
  const cx = Math.round(geo.w / 2), cy = Math.round(geo.h / 2);
  const wheel = async (dy = 800) => {
    try {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: dy, modifiers: 0, pointerType: 'mouse' });
    } catch { console.log('  (滚轮超时)'); }
  };

  let stale = 0, round = 0;
  while (round < maxRounds) {
    round++;
    const before = found.size;
    for (let k = 0; k < 3; k++) { await wheel(800); await sleep(700); }
    await sleep(600);
    const grew = found.size > before;
    stale = grew ? 0 : stale + 1;
    const st = await evaluate(send, `({y: scrollY, h: document.documentElement.scrollHeight, end: /暂时没有更多|没有更多了|到底了/.test(document.body.innerText.slice(-400))})`).catch(() => ({}));
    console.log(`round ${String(round).padStart(2)} | 累计 ${found.size} | 新增 ${found.size - before} | stale ${stale} | y ${st.y ?? '?'}/${st.h ?? '?'}${st.end ? ' [列表到底]' : ''}`);
    if (st.end && stale >= 1) { console.log('页面提示「没有更多了」，停止。'); break; }
    if (stale >= 6) { console.log('连续 6 轮无新增，停止。'); break; }
  }

  console.log('');
  console.log('命中接口:');
  for (const [p, c] of endpoints) console.log(`  ${c} 次  ${p}`);
  console.log('接口包总数:', bodies);

  const arr = [...found.values()].map((x, i) => ({ seq: i + 1, ...x }));
  const videoN = arr.filter(x => x.type === '视频').length;
  const imageN = arr.filter(x => x.type === '图文').length;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = keyword.replace(/[\\/:*?"<>|]/g, '_');
  const jsonPath = path.join(OUT_DIR, `${safe}_${ts}.json`);
  const csvPath = path.join(OUT_DIR, `${safe}_${ts}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify({ keyword, tab, searchUrl: url, collectedAt: new Date().toISOString(), count: arr.length, video: videoN, image: imageN, items: arr }, null, 2), 'utf8');
  const lines = ['序号,类型,ID,链接,作者,标题,点赞数,评论数,发布时间'];
  for (const a of arr) lines.push([a.seq, a.type, a.id, a.url, csvEscape(a.author), csvEscape(a.desc), a.digg, a.comment, a.createTime].join(','));
  fs.writeFileSync(csvPath, '\ufeff' + lines.join('\r\n'), 'utf8');

  console.log('');
  console.log(`完成: 共 ${arr.length} 条 (视频 ${videoN} / 图文 ${imageN})`);
  console.log('JSON:', jsonPath);
  console.log('CSV :', csvPath);
}

async function cmdCollect(keyword, maxRounds = 80, tab = '综合') {
  const { send } = await connect();
  await send('Page.enable');

  const baseUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}`;
  const enc = encodeURIComponent(keyword);
  const cur = await evaluate(send, 'location.href');
  const onThisSearch = cur.includes(`/search/${enc}`);

  if (!onThisSearch) {
    console.log('打开搜索页:', baseUrl);
    await send('Page.navigate', { url: baseUrl });
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try { if (await evaluate(send, 'document.readyState') === 'complete') break; } catch {}
    }
    await sleep(2500);
  } else {
    console.log('已在该关键词的搜索页，直接切换标签:', tab);
  }

  // 点顶部标签（综合 / 视频 / 用户 / 直播），用真实鼠标事件而不是 el.click()
  const hit = await evaluate(send, `(() => {
    const target = ${JSON.stringify(tab)};
    const els = [...document.querySelectorAll('div,span,a,li')]
      .filter(e => (e.innerText || '').trim() === target && e.offsetParent !== null)
      .map(e => ({ e, r: e.getBoundingClientRect() }))
      .filter(x => x.r.top < 260 && x.r.width > 10 && x.r.height > 10)
      .sort((a, b) => a.r.top - b.r.top);
    if (!els.length) return null;
    const { r } = els[0];
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top) };
  })()`);

  const tabParam = { '视频': 'type=video', '用户': 'type=user', '直播': 'type=live' }[tab];
  const alreadyOnTab = tabParam ? cur.includes(tabParam) : !cur.includes('type=');

  if (hit && !alreadyOnTab) {
    try {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
      await sleep(80);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
      console.log(`已点击「${tab}」标签 @ ${hit.x},${hit.y}`);
      await sleep(2500);
    } catch (e) {
      console.log('点击标签失败（不致命）:', e.message);
    }
  } else if (alreadyOnTab) {
    console.log(`已经在「${tab}」标签，跳过点击`);
  } else {
    console.log(`没找到「${tab}」标签，按当前视图继续`);
  }

  // 等结果出现
  let firstCount = 0;
  for (let i = 0; i < 25; i++) {
    try { firstCount = await evaluate(send, 'document.querySelectorAll(\'a[href*="/video/"]\').length'); } catch {}
    if (firstCount > 0) break;
    await sleep(1000);
  }
  if (firstCount === 0) {
    const hint = await evaluate(send, LOGIN_HINT);
    console.log('没有读到视频链接，当前页面状态：');
    console.log(JSON.stringify(hint, null, 2));
    console.log('可能是验证码 / 未登录 / 结果区未渲染。');
    return;
  }
  console.log(`初始视频链接数: ${firstCount}，开始滚动加载...`);

  const geo = await evaluate(send, `({w: window.innerWidth, h: window.innerHeight})`);
  const cx = Math.round(geo.w / 2), cy = Math.round(geo.h / 2);
  const wheel = async (dy = 800) => {
    try {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: dy, modifiers: 0, pointerType: 'mouse'
      });
    } catch (e) {
      // 单次滚轮超时不致命（页面重渲染时偶发），跳过继续
      console.log('  (滚轮超时，跳过)');
    }
  };

  const map = new Map();
  let stale = 0;
  let round = 0;

  while (round < maxRounds) {
    round++;
    let items = [];
    try { items = await evaluate(send, HARVEST); } catch (e) { console.log('采集异常:', e.message); }
    const before = map.size;
    for (const it of items) if (!map.has(it.id)) map.set(it.id, it);
    const newCount = map.size - before;
    stale = newCount > 0 ? 0 : stale + 1;

    // 必须用真实滚轮事件，抖音的加载器不认 scrollTop 赋值
    for (let k = 0; k < 3; k++) { await wheel(800); await sleep(550); }
    let st = {};
    try {
      st = await evaluate(send, `({y: scrollY, h: document.documentElement.scrollHeight, n: document.querySelectorAll('a[href*="/video/"]').length})`);
    } catch {}
    const atBottom = st.h > 0 && st.y + geo.h >= st.h - 120;
    console.log(`round ${String(round).padStart(2)} | 累计 ${map.size} | 新增 ${newCount} | stale ${stale} | y ${st.y}/${st.h}${atBottom ? ' [底部]' : ''}`);

    if (stale >= 6) { console.log('连续 6 轮无新增，停止。'); break; }
    await sleep(700);
  }

  const arr = [...map.values()].map((x, i) => ({ seq: i + 1, ...x }));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = keyword.replace(/[\\/:*?"<>|]/g, '_');
  const jsonPath = path.join(OUT_DIR, `${safe}_${ts}.json`);
  const csvPath = path.join(OUT_DIR, `${safe}_${ts}.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify({ keyword, tab, searchUrl: baseUrl, collectedAt: new Date().toISOString(), count: arr.length, items: arr }, null, 2), 'utf8');
  const lines = ['序号,视频ID,视频链接,卡片文本'];
  for (const a of arr) lines.push([a.seq, a.id, a.url, csvEscape(a.text)].join(','));
  fs.writeFileSync(csvPath, '\ufeff' + lines.join('\r\n'), 'utf8');

  console.log('');
  console.log(`完成：共 ${arr.length} 条视频`);
  console.log('JSON:', jsonPath);
  console.log('CSV :', csvPath);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'status') await cmdStatus();
  else if (cmd === 'inspect') await cmdInspect();
  else if (cmd === 'dump') await cmdDump();
  else if (cmd === 'wheel') await cmdWheel(rest[0] ? parseInt(rest[0], 10) : 12);
  else if (cmd === 'shot') await cmdShot(rest[0]);
  else if (cmd === 'login') await cmdLogin();
  else if (cmd === 'nav') await cmdNav(rest[0]);
  else if (cmd === 'probe') await cmdProbe(rest[0]);
  else if (cmd === 'api') await cmdApi(rest[0], rest[1] ? parseInt(rest[1], 10) : 80, rest[2] || '综合');
  else if (cmd === 'collect') await cmdCollect(rest[0], rest[1] ? parseInt(rest[1], 10) : 80, rest[2] || '综合');
  else { console.log('用法: node tools/dy.mjs <status|nav|collect> ...'); process.exit(1); }
  process.exit(0);
} catch (e) {
  console.error('失败:', e.message);
  process.exit(1);
}
