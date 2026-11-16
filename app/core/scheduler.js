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

export function planAccount(acc, cfg, dateStr) {
  const rnd = mulberry32(hash(dateStr + acc.id));
  const G = cfg.global;
  const start = toMin(G.workStart);
  const end = toMin(G.workEnd);
  const sessions = [];
  const perSession = Math.max(10, Math.round(acc.dailyLinks / acc.sessionsPerDay));

  const totalSessionMin = acc.sessionsPerDay * 32;
  const span = Math.max(60, end - start - totalSessionMin - 30);
  const gapBase = Math.max(G.minSessionGapMin, Math.floor(span / Math.max(1, acc.sessionsPerDay - 1)));

  let cursor = start + Math.round(rnd() * 25);
  for (let i = 0; i < acc.sessionsPerDay; i++) {
    const dur = 25 + Math.round(rnd() * 15);
    const clicks = G.clickIntoVideos[0] + Math.floor(rnd() * (G.clickIntoVideos[1] - G.clickIntoVideos[0] + 1));
    const comments = G.commentChecks[0] + Math.floor(rnd() * (G.commentChecks[1] - G.commentChecks[0] + 1));
    const hotN = G.hotSearchesPerSession[0] + Math.floor(rnd() * (G.hotSearchesPerSession[1] - G.hotSearchesPerSession[0] + 1));
    const hot = [...cfg.hotTopics].sort(() => rnd() - 0.5).slice(0, hotN);

    sessions.push({
      account: acc.id,
      index: i + 1,
      start: toHHMM(cursor),
      end: toHHMM(cursor + dur),
      durationMin: dur,
      targetLinks: perSession,
      clicks,
      commentChecks: comments,
      hotTopics: hot
    });
    cursor += dur + Math.round(gapBase * (0.75 + rnd() * 0.5));
    if (cursor > end - 25) break;
  }
  return sessions;
}

export function buildDayPlan(cfg, dateStr) {
  const accounts = cfg.accounts.filter((a) => a.enabled);
  const sessions = accounts.flatMap((a) => planAccount(a, cfg, dateStr));
  sessions.sort((a, b) => a.start.localeCompare(b.start));

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
