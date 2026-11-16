// 拟人化行为：只读操作（滚动 / 停留 / 进视频 / 看评论 / 搜索）
import { connectAt, evaluate, runSearch, sleep } from '../../tools/lib.mjs';

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

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

/** 真实滚轮，带随机步长和停顿 */
export async function humanScroll(page, { rounds = 6, pauseMin = 800, pauseMax = 3200 } = {}) {
  const geo = await evaluate(page.send, `({w: innerWidth, h: innerHeight})`);
  const x = Math.round(geo.w / 2 + rand(-60, 60));
  const y = Math.round(geo.h * 0.55);
  for (let i = 0; i < rounds; i++) {
    const dy = Math.round(rand(420, 900));
    try {
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse'
      });
    } catch {}
    await sleep(rand(pauseMin, pauseMax));
    // 偶尔往回滚一点，像人在找东西
    if (Math.random() < 0.15) {
      try {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: -Math.round(rand(150, 400)), pointerType: 'mouse' });
      } catch {}
      await sleep(rand(400, 1200));
    }
  }
}

/** 点进一条随机视频（用真实鼠标事件点坐标） */
export async function clickRandomVideo(page) {
  const hit = await evaluate(page.send, `(() => {
    const as = [...document.querySelectorAll('a[href*="/video/"]')].filter(a => {
      const r = a.getBoundingClientRect();
      return r.top > 120 && r.top < innerHeight - 160 && r.width > 80;
    });
    if (!as.length) return null;
    const a = as[Math.floor(Math.random() * as.length)];
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!hit) return false;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y });
  await sleep(rand(120, 400));
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
  await sleep(rand(60, 140));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
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

/**
 * 跑一轮完整会话
 * @param {object} acc
 * @param {{hotTopics:string[], industry:string, onEvent?:Function}} opts
 */
export async function runSession(acc, opts = {}) {
  const emit = opts.onEvent || (() => {});
  const hotPool = opts.hotTopics || [];
  const industry = opts.industry || acc.industry;
  const page = await openSession(acc);
  const started = Date.now();
  const result = { links: [], searched: [], videos: 0, comments: 0 };

  try {
    const st = await loginState(page);
    if (st.needLogin) { emit({ type: 'error', message: '未登录，需要扫码' }); return result; }

    // ① 热身：首页推荐随便看看
    emit({ type: 'log', message: '热身：刷推荐' });
    await goto(page, 'https://www.douyin.com/', randInt(2200, 3600));
    await humanScroll(page, { rounds: randInt(6, 10) });

    // 热身时点进 1–2 条看一会儿
    for (let i = 0; i < randInt(1, 2); i++) {
      if (await clickRandomVideo(page)) {
        const sec = randInt(8, 25);
        emit({ type: 'log', message: `点进一条视频，看 ${sec}s` });
        await sleep(sec * 1000);
        if (Math.random() < 0.5) { await peekComments(page, randInt(4000, 9000)); result.comments++; }
        await back(page);
        result.videos++;
      }
    }

    // ② 热点搜索（不记录）
    const hotN = randInt(2, 4);
    const picked = [...hotPool].sort(() => Math.random() - 0.5).slice(0, hotN);
    for (const kw of picked) {
      emit({ type: 'log', message: `热点搜索：${kw}` });
      await goto(page, `https://www.douyin.com/search/${encodeURIComponent(kw)}`, randInt(2000, 3000));
      await humanScroll(page, { rounds: randInt(2, 4) });
      if (Math.random() < 0.6 && await clickRandomVideo(page)) {
        await sleep(randInt(6, 18) * 1000);
        if (Math.random() < 0.4) { await peekComments(page, randInt(3000, 8000)); result.comments++; }
        await back(page);
        result.videos++;
      }
      result.searched.push(kw);
    }

    // ③ 正事：行业词搜索 + 接口拦截采集
    emit({ type: 'log', message: `行业搜索：${industry}` });
    const search = await runSearch(page, industry, { maxRounds: opts.maxRounds || 12, interval: 900 });
    if (search.captcha) {
      emit({ type: 'error', message: '出现验证码，本轮中止' });
      return { ...result, captcha: true };
    }
    result.links = search.items;
    emit({ type: 'log', message: `行业搜索拿到 ${search.items.length} 条` });

    // ④ 收尾：回首页刷两下
    emit({ type: 'log', message: '收尾：回首页' });
    await goto(page, 'https://www.douyin.com/', randInt(1800, 2800));
    await humanScroll(page, { rounds: randInt(2, 4) });

    result.durationSec = Math.round((Date.now() - started) / 1000);
    return result;
  } catch (e) {
    emit({ type: 'error', message: '会话异常: ' + e.message });
    return { ...result, error: e.message };
  } finally {
    try { page.close(); } catch {}
  }
}
