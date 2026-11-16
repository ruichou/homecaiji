// 拟人化行为：只读操作（滚动 / 停留 / 进视频 / 看评论 / 搜索）
import { connectAt, evaluate, attachSearchCapture, sleep } from '../../tools/lib.mjs';

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

/** 看门狗：连续 CDP 超时说明页面已经卡死，立刻中止，别空转 */
function stallGuard(page) {
  if (page?.stats && page.stats.timeouts >= 6) {
    throw new Error('页面连续无响应（CDP 超时 6 次），本轮中止');
  }
}

export async function openSession(acc) {
  const page = await connectAt(acc.port);
  await page.send('Page.enable');
  await page.send('Network.enable');
  return page;
}

export async function goto(page, url, settleMs = 2500) {
  await page.send('Page.navigate', { url });
  await sleep(settleMs);
}

/** 鼠标轨迹：分步插值移动，带轻微抖动和过冲 */
export async function mouseMoveTo(page, x, y) {
  let from = { x: 0, y: 0 };
  try {
    from = await evaluate(page.send, `({x: window.__mx ?? Math.round(innerWidth/2), y: window.__my ?? Math.round(innerHeight/2)})`);
  } catch {}
  const steps = randInt(8, 15);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = 1 - Math.pow(1 - t, 3);
    const nx = from.x + (x - from.x) * ease + rand(-4, 4);
    const ny = from.y + (y - from.y) * ease + rand(-4, 4);
    if (i % 4 === 0) stallGuard(page);
    try {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(nx), y: Math.round(ny) });
    } catch {}
    await sleep(rand(8, 26));
  }
  try { await evaluate(page.send, `window.__mx=${Math.round(x)}; window.__my=${Math.round(y)}`); } catch {}
}

/** 真实点击：先移过去，再按下抬起，坐标带偏移 */
export async function humanClick(page, x, y) {
  await mouseMoveTo(page, x, y);
  await sleep(rand(90, 260));
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(rand(55, 130));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** 滚动前暂停页面上的视频，避免解码占满渲染器导致输入事件超时 */
async function pauseVideos(page) {
  try {
    await evaluate(page.send, `(() => {
      let n = 0;
      document.querySelectorAll('video').forEach(v => { try { if (!v.paused) { v.pause(); n++; } } catch {} });
      return n;
    })()`);
  } catch {}
}

/** 滚动手势：一次下滑拆成多段，先快后慢，模拟惯性 */
export async function humanScroll(page, { rounds = 6, pauseMin = 800, pauseMax = 3200 } = {}) {
  let geo = { w: 900, h: 800 };
  try { geo = await evaluate(page.send, `({w: innerWidth, h: innerHeight})`); } catch {}
  await pauseVideos(page);

  for (let r = 0; r < rounds; r++) {
    stallGuard(page);
    const x = Math.round(geo.w / 2 + rand(-80, 80));
    const y = Math.round(geo.h * (0.45 + Math.random() * 0.2));

    // 8% 概率手滑往回滚
    const total = Math.round(rand(420, 1100)) * (Math.random() < 0.08 ? -1 : 1);
    const steps = randInt(4, 8);
    let sent = 0;
    for (let s = 0; s < steps; s++) {
      const t = (s + 1) / steps;
      const target = Math.round(total * (1 - Math.pow(1 - t, 2)));
      const dy = target - sent;
      sent = target;
      if (dy !== 0) {
        try {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse'
          });
        } catch {}
      }
      await sleep(rand(18, 70));
    }

    await sleep(rand(pauseMin, pauseMax));

    // 偶尔滚过头再拉回来一点
    if (Math.random() < 0.12) {
      try {
        await page.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x, y, deltaX: 0, deltaY: -Math.round(rand(120, 320)), pointerType: 'mouse'
        });
      } catch {}
      await sleep(rand(400, 1000));
    }
  }
}

/** 逐字输入：带随机停顿，偶尔打错再删 */
export async function typeText(page, text) {
  for (const ch of text) {
    if (Math.random() < 0.05) {
      await page.send('Input.insertText', { text: 'x' });
      await sleep(rand(90, 200));
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(rand(80, 170));
    }
    await page.send('Input.insertText', { text: ch });
    await sleep(rand(70, 190));
  }
}

/** 点左侧导航（推荐 / 精选 / 关注） */
export async function clickNav(page, text) {
  const hit = await evaluate(page.send, `(() => {
    const t = ${JSON.stringify(text)};
    const els = [...document.querySelectorAll('a,div,span,li')]
      .filter(e => (e.innerText || '').trim() === t && e.offsetParent !== null)
      .map(e => ({ r: e.getBoundingClientRect() }))
      .filter(x => x.r.left < 140 && x.r.top > 60 && x.r.width > 20 && x.r.width < 140)
      .sort((a, b) => a.r.top - b.r.top);
    if (!els.length) return null;
    const r = els[0].r;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!hit) return false;
  await humanClick(page, hit.x, hit.y);
  await sleep(rand(1800, 3000));
  return true;
}

/** 回推荐流：优先点导航，失败再跳 URL */
export async function goRecommend(page) {
  if (await clickNav(page, '推荐')) return true;
  await goto(page, 'https://www.douyin.com/?recommend=1&from_nav=1', randInt(2400, 3600));
  return false;
}

/** 按视频真实时长决定看多久：看 35%–75%，至少 6 秒，最多 3 分钟 */
export async function watchVideo(page, { minSec = 6, maxSec = 180 } = {}) {
  let dur = 0;
  try {
    dur = await evaluate(page.send, `(() => {
      const v = document.querySelector('video');
      return v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    })()`);
  } catch {}

  const target = dur > 0
    ? Math.min(Math.max(dur * rand(0.35, 0.75), minSec), maxSec)
    : rand(8, 25);

  await sleep(target * 1000);
  return { duration: Math.round(dur), watched: Math.round(target) };
}

const SEARCH_BOX_JS = `(() => {
  const el = document.querySelector('[data-e2e="searchbar-input"]')
          || document.querySelector('input[placeholder*="搜索"]')
          || document.querySelector('input[type="search"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 10) return null;
  return { x: Math.round(r.x + r.width * (0.25 + Math.random() * 0.5)),
           y: Math.round(r.y + r.height * (0.35 + Math.random() * 0.3)) };
})()`;

const READ_BOX_JS = `(() => {
  const el = document.querySelector('[data-e2e="searchbar-input"]') || document.querySelector('input[placeholder*="搜索"]');
  return el ? el.value : '';
})()`;

const ON_TARGET_JS = (kw) => `(() => {
  try {
    return location.pathname.startsWith('/search/') &&
           decodeURIComponent(location.pathname).includes(${JSON.stringify(kw)});
  } catch { return false; }
})()`;

async function pressEnter(page) {
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    text: '\r', unmodifiedText: '\r'
  });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}

/**
 * 像人一样搜索：点搜索框 → 逐字输入 → 等联想 → 回车
 * 会校验输入值和最终 URL，失败则重试，最后兜底直接跳转
 */
export async function humanSearch(page, keyword) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let box = null;
    try { box = await evaluate(page.send, SEARCH_BOX_JS); } catch {}
    if (!box) break;

    await humanClick(page, box.x, box.y);
    await sleep(rand(220, 500));

    // 清空原有内容
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await sleep(rand(60, 140));
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await sleep(rand(180, 400));

    await typeText(page, keyword);
    await sleep(rand(700, 1600));

    // 校验：输入框里是不是我们要的词
    let val = '';
    try { val = await evaluate(page.send, READ_BOX_JS); } catch {}
    if (!val || !String(val).includes(keyword)) {
      // 输入没进去，重试一次
      continue;
    }

    await pressEnter(page);

    // 等 URL 变成目标搜索页
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      try { if (await evaluate(page.send, ON_TARGET_JS(keyword))) return true; } catch {}
    }
  }

  // 兜底：直接跳转
  await goto(page, `https://www.douyin.com/search/${encodeURIComponent(keyword)}`, randInt(2400, 3600));
  return false;
}

/** 点顶部标签（视频 / 综合 等） */
export async function clickTab(page, text) {
  const hit = await evaluate(page.send, `(() => {
    const t = ${JSON.stringify(text)};
    const els = [...document.querySelectorAll('div,span,a,li')]
      .filter(e => (e.innerText || '').trim() === t && e.offsetParent !== null)
      .map(e => ({ r: e.getBoundingClientRect() }))
      .filter(x => x.r.top < 300 && x.r.width > 10 && x.r.height > 10)
      .sort((a, b) => a.r.top - b.r.top);
    if (!els.length) return null;
    const r = els[0].r;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!hit) return false;
  await humanClick(page, hit.x, hit.y);
  await sleep(rand(1600, 2800));
  return true;
}

async function countVideoAnchors(page) {
  try { return await evaluate(page.send, `document.querySelectorAll('a[href*="/video/"]').length`); } catch { return 0; }
}

/** 搜完之后确保在能点开卡片的视图上（综合页的卡片不是 <a>，得切到视频 tab） */
async function ensureVideoCards(page) {
  if (await countVideoAnchors(page) > 0) return true;
  const ok = await clickTab(page, '视频');
  await sleep(rand(1500, 2500));
  return ok && (await countVideoAnchors(page)) > 0;
}

/** 点进一条随机视频（元素内随机位置，带鼠标轨迹） */
export async function clickRandomVideo(page) {
  const hit = await evaluate(page.send, `(() => {
    const as = [...document.querySelectorAll('a[href*="/video/"]')].filter(a => {
      const r = a.getBoundingClientRect();
      return r.top > 120 && r.top < innerHeight - 160 && r.width > 80;
    });
    if (!as.length) return null;
    const a = as[Math.floor(Math.random() * as.length)];
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.x + r.width * (0.3 + Math.random() * 0.4)),
             y: Math.round(r.y + r.height * (0.3 + Math.random() * 0.4)) };
  })()`);
  if (!hit) return false;
  await humanClick(page, hit.x, hit.y);
  return true;
}

/** 在视频页往下滚，把评论区滚出来 */
export async function peekComments(page, ms = 6000) {
  await humanScroll(page, { rounds: randInt(2, 4), pauseMin: 500, pauseMax: 1500 });
  await sleep(ms);
}

export async function back(page) {
  await evaluate(page.send, 'history.back()').catch(() => {});
  await sleep(rand(1200, 2600));
}

const LOGIN_JS = `(() => {
  const t = document.body?.innerText || '';
  return { needLogin: /扫码登录|登录后|立即登录/.test(t.slice(0, 3000)), url: location.href,
           title: document.title };
})()`;

export async function loginState(page) {
  return evaluate(page.send, LOGIN_JS).catch(() => ({ needLogin: true }));
}

/** 进直播间待一段时间（只停留、轻微滚动，不发言不送礼） */
export async function watchLive(page, { minutes = 12, onEvent } = {}) {
  const emit = onEvent || (() => {});
  await goto(page, 'https://live.douyin.com/', randInt(2500, 4000));
  await sleep(randInt(1500, 3000));

  const hit = await evaluate(page.send, `(() => {
    const as = [...document.querySelectorAll('a[href^="https://live.douyin.com/"]')]
      .filter(a => /\\/\\d{5,}/.test(a.getAttribute('href') || ''));
    if (!as.length) return null;
    const a = as[Math.floor(Math.random() * as.length)];
    const r = a.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), href: a.getAttribute('href') };
  })()`);

  if (!hit) { emit({ type: 'log', message: '页面上没找到可进的直播间' }); return false; }

  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y });
  await sleep(randInt(150, 380));
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
  await sleep(randInt(70, 140));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
  await sleep(randInt(3000, 5000));

  emit({ type: 'log', message: `进了直播间 ${hit.href}，待 ${minutes} 分钟` });

  const endAt = Date.now() + minutes * 60_000;
  while (Date.now() < endAt) {
    const left = Math.ceil((endAt - Date.now()) / 1000);
    await sleep(Math.min(randInt(45, 110), left) * 1000);
    try {
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: randInt(100, 460), y: randInt(150, 760)
      });
    } catch {}
    if (Math.random() < 0.3) await humanScroll(page, { rounds: 1, pauseMin: 300, pauseMax: 900 });
  }
  return true;
}

/**
 * 日常闲逛：刷推荐、点视频、看评论、偶尔进直播间。不采集，纯保持账号活跃。
 */
export async function idleSession(acc, opts = {}) {
  const emit = opts.onEvent || (() => {});
  const minutes = opts.minutes || randInt(15, 35);
  const allowLive = opts.allowLive !== false;
  const page = await openSession(acc);
  const endAt = Date.now() + minutes * 60_000;
  const stat = { minutes, videos: 0, comments: 0, lives: 0 };

  try {
    const st = await loginState(page);
    if (st.needLogin) { emit({ type: 'error', message: '未登录，需要扫码' }); return stat; }

    await goRecommend(page);

    while (Date.now() < endAt) {
      await humanScroll(page, { rounds: randInt(2, 5) });

      if (Math.random() < 0.35 && await clickRandomVideo(page)) {
        const w = await watchVideo(page);
        emit({ type: 'log', message: `看一条视频 ${w.watched}s` });
        if (Math.random() < 0.4) { await peekComments(page, randInt(3000, 9000)); stat.comments++; }
        await back(page);
        stat.videos++;
      }

      // 剩的时间还够，就进直播间待一会儿
      const leftMin = Math.floor((endAt - Date.now()) / 60_000);
      if (allowLive && leftMin >= 6 && Math.random() < 0.18) {
        const liveMin = Math.min(randInt(5, 12), leftMin - 2);
        if (liveMin >= 3) {
          if (await watchLive(page, { minutes: liveMin, onEvent: emit })) stat.lives++;
          await goRecommend(page);
        }
      }

      await sleep(randInt(2000, 6000));
    }

    emit({ type: 'log', message: `闲逛结束：视频 ${stat.videos} 条 · 评论 ${stat.comments} 次 · 直播 ${stat.lives} 场` });
    return stat;
  } catch (e) {
    emit({ type: 'error', message: '闲逛异常: ' + e.message });
    return { ...stat, error: e.message };
  } finally {
    try { page.close(); } catch {}
  }
}

/**
 * 碎片化采集：搜行业词 → 滚几屏 → 点开看看 → 再滚 → 采够就停
 * 一次只要 15–25 条，剩下的留给下一轮
 */
export async function collectIndustry(page, keyword, opts = {}) {
  const emit = opts.onEvent || (() => {});
  const target = opts.target || randInt(15, 25);
  const keep = opts.keep || (() => true);
  const found = new Map();
  const cap = attachSearchCapture(page.send, page.on, found);

  // 只把符合行业特征的结果计入目标，避免热点残留占额度
  const useful = () => {
    let n = 0;
    for (const it of found.values()) if (keep(it)) n++;
    return n;
  };

  try {
    await humanSearch(page, keyword);

    // 校验：确实停在这个关键词的搜索页，否则宁可不采
    let onTarget = false;
    try { onTarget = await evaluate(page.send, ON_TARGET_JS(keyword)); } catch {}
    if (!onTarget) {
      let now = '';
      try { now = await evaluate(page.send, 'location.href'); } catch {}
      emit({ type: 'error', message: `搜索未生效，当前页面 ${now}，本轮不采集` });
      return { items: [], captcha: false, rounds: 0, failed: true };
    }

    await ensureVideoCards(page);

    // 等首批结果
    for (let i = 0; i < 20 && found.size === 0; i++) await sleep(500);

    let round = 0;
    while (useful() < target && round < 10) {
      round++;
      await humanScroll(page, { rounds: randInt(2, 4), pauseMin: 700, pauseMax: 2200 });

      // 穿插点进视频，不要连着滚到底
      if (Math.random() < 0.45 && await clickRandomVideo(page)) {
        await watchVideo(page, { maxSec: 90 });
        if (Math.random() < 0.35) await peekComments(page, randInt(3000, 8000));
        await back(page);
        await sleep(randInt(1200, 2500));
      }

      await sleep(randInt(800, 2200));
    }

    const captcha = await evaluate(page.send, `(() => /请选择所有|拖拽到下方|完成验证|安全验证/.test(document.body.innerText || ''))()`).catch(() => false);
    const all = [...found.values()];
    const items = all.filter(keep);
    emit({ type: 'log', message: `采集了 ${round} 轮，拿到 ${items.length} 条相关（另有 ${all.length - items.length} 条无关已剔除）` });
    return { items, captcha, rounds: round };
  } finally {
    cap.off();
  }
}

/**
 * 跑一轮完整会话
 * @param {object} acc
 * @param {{hotTopics:string[], industry:string, onEvent?:Function}} opts
 */
export async function runSession(acc, opts = {}) {
  const emit = opts.onEvent || (() => {});
  const hotPool = opts.hotTopics || [];
  const keyword = opts.keyword || acc.industry;
  const industry = keyword;
  const page = await openSession(acc);
  const started = Date.now();
  const result = { links: [], searched: [], videos: 0, comments: 0 };

  try {
    const st = await loginState(page);
    if (st.needLogin) { emit({ type: 'error', message: '未登录，需要扫码' }); return result; }

    // ① 热身：精选页（网格布局，比推荐流的直播预览轻很多）
    emit({ type: 'log', message: '热身：刷精选' });
    try {
      await goto(page, 'https://www.douyin.com/jingxuan', randInt(2500, 3500));
      await humanScroll(page, { rounds: randInt(3, 5), pauseMin: 1200, pauseMax: 2800 });
      emit({ type: 'log', message: '热身完成' });
    } catch (e) {
      emit({ type: 'log', message: `热身跳过: ${e.message}` });
    }

    // ② 热点搜索（不记录）
    const budgetMs = (opts.durationMin || 0) * 60_000;
    const hotN = randInt(2, 4);
    const picked = [...hotPool].sort(() => Math.random() - 0.5).slice(0, hotN);
    let hotWatchSec = 0;

    for (const kw of picked) {
      // 热点阶段最多看 4 分钟，且不能挤占采集预算
      if (hotWatchSec > 240) { emit({ type: 'log', message: '热点看得差不多了，进入正事' }); break; }
      if (budgetMs && Date.now() - started > budgetMs * 0.55) { emit({ type: 'log', message: '时间到，跳过剩余热点' }); break; }

      const isInterest = (acc.interests || []).includes(kw);
      emit({ type: 'log', message: `热点搜索：${kw}${isInterest ? '（本号兴趣，多看点）' : ''}` });
      await humanSearch(page, kw);
      emit({ type: 'log', message: `搜索完成：${kw}` });
      await ensureVideoCards(page);
      await humanScroll(page, { rounds: randInt(2, 4) });

      // 兴趣词追着看 2–4 条，普通热点 0–1 条
      const watchTarget = isInterest ? randInt(2, 4) : (Math.random() < 0.6 ? 1 : 0);
      for (let v = 0; v < watchTarget; v++) {
        emit({ type: 'log', message: `  尝试点开第 ${v + 1} 条` });
        if (!(await clickRandomVideo(page))) { emit({ type: 'log', message: '  没找到可点的卡片' }); break; }
        const w = await watchVideo(page);
        hotWatchSec += w.watched;
        emit({ type: 'log', message: `  看了 ${w.watched}s（时长 ${w.duration}s）` });
        if (Math.random() < (isInterest ? 0.6 : 0.4)) {
          await peekComments(page, randInt(3000, 9000));
          result.comments++;
        }
        await back(page);
        result.videos++;
        await sleep(randInt(800, 2200));
        if (hotWatchSec > 240) break;
      }
      result.searched.push(kw);
    }

    // ③ 正事：行业词碎片化采集
    emit({ type: 'log', message: `行业搜索：${industry}` });
    const search = await collectIndustry(page, industry, {
      onEvent: emit,
      target: opts.targetLinks || randInt(15, 25),
      keep: (it) => {
        const t = (it.desc || '') + (it.author || '');
        return t.includes(acc.industry) || t.includes(industry);
      }
    });
    if (search.captcha) {
      emit({ type: 'error', message: '出现验证码，本轮中止' });
      return { ...result, captcha: true };
    }
    result.links = search.items;
    emit({ type: 'log', message: `行业搜索拿到 ${search.items.length} 条` });

    // ④ 收尾：回推荐页刷两下
    emit({ type: 'log', message: '收尾：回推荐页' });
    await goRecommend(page);
    await humanScroll(page, { rounds: randInt(2, 4) });

    // ⑤ 补足时长：真人不会搜完就关，继续待着看
    const targetMs = (opts.durationMin || 0) * 60_000;
    const elapsed = Date.now() - started;
    if (targetMs > elapsed + 30_000) {
      const remainMin = Math.round((targetMs - elapsed) / 60_000);
      emit({ type: 'log', message: `继续浏览约 ${remainMin} 分钟补足时长` });
      const endAt = started + targetMs;
      while (Date.now() < endAt) {
        await humanScroll(page, { rounds: randInt(2, 4) });
        if (Math.random() < 0.5 && await clickRandomVideo(page)) {
          const w = await watchVideo(page);
          if (Math.random() < 0.35) { await peekComments(page, randInt(3000, 8000)); result.comments++; }
          await back(page);
          result.videos++;
        }
        await sleep(randInt(1500, 4000));
      }
    }

    result.durationSec = Math.round((Date.now() - started) / 1000);
    return result;
  } catch (e) {
    emit({ type: 'error', message: '会话异常: ' + e.message });
    return { ...result, error: e.message };
  } finally {    try { page.close(); } catch {}
  }
}
