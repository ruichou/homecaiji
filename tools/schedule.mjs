// 生成当天的拟人化时间表：把目标链接数均匀分到工作时段，中间穿插休息
// 用法: node tools/schedule.mjs [YYYY-MM-DD] [--json]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\抖音auto';
const CFG = path.join(ROOT, 'config', 'accounts.json');
const OUT_DIR = path.join(ROOT, 'data', 'schedule');

const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const dateArg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const wantJson = process.argv.includes('--json');

const d = dateArg ? new Date(dateArg + 'T00:00:00') : new Date();
const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 可复现的伪随机
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const G = cfg.global;
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

function planAccount(acc) {
  const rnd = mulberry32(hash(dateStr + acc.id));
  const start = toMin(G.workStart);
  const end = toMin(G.workEnd);
  const sessions = [];
  const perSessionLinks = Math.round(acc.dailyLinks / acc.sessionsPerDay);

  // 会话时长 25–40 分钟；用总时长减去休息得到起点
  const totalSessionMin = acc.sessionsPerDay * 32;
  const span = end - start - totalSessionMin - 30;
  const gapBase = Math.max(G.minSessionGapMin, Math.floor(span / Math.max(1, acc.sessionsPerDay - 1)));

  let cursor = start + Math.round(rnd() * 20);
  for (let i = 0; i < acc.sessionsPerDay; i++) {
    const dur = 25 + Math.round(rnd() * 15);           // 25–40 分钟
    const warm = 3 + Math.round(rnd() * 3);            // 3–6 分钟
    const close = 2 + Math.round(rnd() * 2);           // 2–4 分钟
    const hotN = G.hotSearchesPerSession[0] + Math.floor(rnd() * (G.hotSearchesPerSession[1] - G.hotSearchesPerSession[0] + 1));
    const clicks = 2 + Math.round(rnd() * 3);          // 点击进视频 2–5 条
    const commentChecks = 1 + Math.round(rnd() * 2);   // 看评论 1–2 次

    const hotPool = [...cfg.hotTopics].sort(() => rnd() - 0.5);
    const hotPicked = hotPool.slice(0, hotN);
    const interest = acc.interests[Math.floor(rnd() * acc.interests.length)];

    sessions.push({
      account: acc.id,
      start: toHHMM(cursor),
      end: toHHMM(cursor + dur),
      durationMin: dur,
      targetLinks: perSessionLinks,
      script: {
        warmupMin: warm,
        hotSearches: hotPicked,
        interestBrowse: interest,
        industrySearch: true,
        clickIntoVideos: clicks,
        commentChecks,
        closeMin: close
      }
    });

    const gap = Math.round(gapBase * (0.75 + rnd() * 0.5));
    cursor += dur + gap;
    if (cursor > end - 30) break;
  }
  return sessions;
}

const all = [];
const perAccount = [];
for (const acc of cfg.accounts.filter((a) => a.enabled)) {
  const s = planAccount(acc);
  all.push(...s);
  perAccount.push({ account: acc.id, sessions: s, links: s.reduce((n, x) => n + x.targetLinks, 0) });
}

all.sort((a, b) => a.start.localeCompare(b.start));

// 休息段 = 两个会话之间的空档
const breaks = [];
for (let i = 1; i < all.length; i++) {
  const prevEnd = toMin(all[i - 1].end);
  const nextStart = toMin(all[i].start);
  if (nextStart - prevEnd >= 30) breaks.push({ from: toHHMM(prevEnd), to: toHHMM(nextStart), min: nextStart - prevEnd });
}

const plan = {
  date: dateStr,
  generatedAt: new Date().toISOString(),
  workWindow: `${G.workStart}–${G.workEnd}`,
  nightRest: `${G.nightRestStart}–${G.nightRestEnd}`,
  targetLinks: perAccount.reduce((n, a) => n + a.links, 0),
  accounts: perAccount,
  sessions: all,
  breaks
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `${dateStr}.json`), JSON.stringify(plan, null, 2), 'utf8');

if (wantJson) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }

console.log(`日期 ${dateStr} | 工作窗口 ${plan.workWindow} | 夜间休息 ${plan.nightRest}`);
console.log(`目标 ${plan.targetLinks} 条 | 会话 ${all.length} 轮 | 休息 ${breaks.length} 段`);
console.log('');
for (const s of all) {
  console.log(`${s.start}–${s.end}  ${s.account}  ${String(s.durationMin).padStart(2)}分  → ${s.targetLinks} 条`);
  console.log(`      热身${s.script.warmupMin}分 · 热点[${s.script.hotSearches.join('/')}] · 兴趣[${s.script.interestBrowse}] · 行业1次 · 点进${s.script.clickIntoVideos}条 · 评论${s.script.commentChecks}次 · 收尾${s.script.closeMin}分`);
}
console.log('');
if (breaks.length) {
  console.log('休息段:');
  for (const b of breaks) console.log(`  ${b.from}–${b.to}  (${b.min} 分钟)`);
}
console.log('');
console.log('已写入:', path.join(OUT_DIR, `${dateStr}.json`));
