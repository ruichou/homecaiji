// 分时调度：把每天的目标链接数和会话均匀铺开到工作时段
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** 当天整体时间漂移：-40 ~ +40 分钟，避免每天同一分钟开工 */
function dayOffset(dateStr) {
  const rnd = mulberry32(hash(dateStr + '|offset'));
  return Math.round(rnd() * 80 - 40);
}

/** 按账号兴趣挑热点词：约 7 成来自本号兴趣，3 成来自全网热点 */
function pickHotTopics(cfg, acc, n, rnd) {
  const interest = acc.interests || [];
  const global = cfg.hotTopics || [];
  const nInterest = Math.min(interest.length, Math.round(n * 0.7));
  const out = [];

  const pool = [...interest].sort(() => rnd() - 0.5);
  for (const w of pool) { if (out.length >= nInterest) break; out.push(w); }

  const rest = [...global, ...interest]
    .filter((w) => !out.includes(w))
    .sort(() => rnd() - 0.5);
  for (const w of rest) { if (out.length >= n) break; out.push(w); }

  return out;
}

/** 每天会话数在 3–5 之间浮动，避免结构固定 */
function sessionCount(acc, dateStr) {
  const rnd = mulberry32(hash(dateStr + acc.id + '|cnt'));
  const base = acc.sessionsPerDay || 4;
  const delta = Math.floor(rnd() * 3) - 1; // -1, 0, +1
  return Math.max(3, Math.min(5, base + delta));
}

/** 行业词轮换：大词 + 长尾矩阵，按日期和轮次错开 */
function pickKeyword(cfg, acc, dateStr, idx) {
  const list = (cfg.industryKeywords && cfg.industryKeywords.length)
    ? cfg.industryKeywords
    : [acc.industry];
  const h = hash(dateStr + acc.id + '|kw' + idx);
  return list[h % list.length];
}

export function planAccount(acc, cfg, dateStr, offsetMin = 0) {
  const rnd = mulberry32(hash(dateStr + acc.id));
  const G = cfg.global;
  const count = sessionCount(acc, dateStr);
  const start = toMin(G.workStart) + offsetMin;
  const end = toMin(G.workEnd) + offsetMin;
  const sessions = [];
  const perSession = Math.max(10, Math.round(acc.dailyLinks / count));

  const totalSessionMin = count * 32;
  const span = Math.max(count * 40, end - start);
  const seg = span / count;

  for (let i = 0; i < count; i++) {
    // 每个时段内落一次，前后带抖动，保证不会因为游标累计而少排
    const segStart = start + i * seg;
    const dur = Math.round(Math.min(25 + rnd() * 15, seg - 12));
    const st = Math.round(segStart + Math.min(seg - dur - 4, rnd() * 16));

    const clicks = G.clickIntoVideos[0] + Math.floor(rnd() * (G.clickIntoVideos[1] - G.clickIntoVideos[0] + 1));
    const comments = G.commentChecks[0] + Math.floor(rnd() * (G.commentChecks[1] - G.commentChecks[0] + 1));
    const hotN = G.hotSearchesPerSession[0] + Math.floor(rnd() * (G.hotSearchesPerSession[1] - G.hotSearchesPerSession[0] + 1));
    const hot = pickHotTopics(cfg, acc, hotN, rnd);

    sessions.push({
      type: 'collect',
      account: acc.id,
      index: i + 1,
      start: toHHMM(st),
      end: toHHMM(st + dur),
      durationMin: dur,
      targetLinks: perSession,
      clicks,
      commentChecks: comments,
      hotTopics: hot,
      keyword: pickKeyword(cfg, acc, dateStr, i)
    });
  }
  return sessions;
}

/** 日常闲逛：每天 2 段，避开采集轮次 */
function planIdle(acc, cfg, dateStr, offsetMin = 0) {
  const rnd = mulberry32(hash(dateStr + acc.id + 'idle'));
  const G = cfg.global;
  const [lo, hi] = G.idleMinutesRange || [15, 35];
  const slots = ['10:30', '18:40'];
  const out = [];
  for (const slot of slots) {
    const base = toMin(slot) + offsetMin;
    const start = base + Math.round(rnd() * 20 - 10);
    const dur = Math.round(lo + rnd() * (hi - lo));
    out.push({
      type: 'idle',
      account: acc.id,
      index: out.length + 1,
      start: toHHMM(start),
      end: toHHMM(start + dur),
      durationMin: dur,
      targetLinks: 0,
      clicks: 0,
      commentChecks: 0,
      hotTopics: pickHotTopics(cfg, acc, 2, rnd)
    });
  }
  return out;
}

export function buildDayPlan(cfg, dateStr) {
  const accounts = cfg.accounts.filter((a) => a.enabled);
  const offset = dayOffset(dateStr);
  const collect = accounts.flatMap((a) => planAccount(a, cfg, dateStr, offset));
  const idle = accounts.flatMap((a) => planIdle(a, cfg, dateStr, offset));
  const sessions = [...collect, ...idle].sort((a, b) => a.start.localeCompare(b.start));

  const breaks = [];
  for (let i = 1; i < sessions.length; i++) {
    const prevEnd = toMin(sessions[i - 1].end);
    const nextStart = toMin(sessions[i].start);
    if (nextStart - prevEnd >= 30) breaks.push({ from: toHHMM(prevEnd), to: toHHMM(nextStart), min: nextStart - prevEnd });
  }

  return {
    date: dateStr,
    workWindow: `${cfg.global.workStart}–${cfg.global.workEnd}`,
    nightRest: `${cfg.global.nightRestStart}–${cfg.global.nightRestEnd}`,
    targetLinks: accounts.reduce((n, a) => n + a.dailyLinks, 0),
    sessions,
    breaks
  };
}

/** 距离下一个会话开始还有多少分钟（没有则 null） */
export function minutesToNext(plan, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const s of plan.sessions) {
    const st = toMin(s.start);
    if (st >= cur) return st - cur;
  }
  return null;
}
