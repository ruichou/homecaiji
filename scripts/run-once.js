// 真实跑一轮完整会话（与界面「跑一轮」同一套逻辑），带阶段计时和即时日志
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, todayStr, ensureDir, ROOT } from '../app/core/store.js';
import { restartWindow } from '../app/core/chrome.js';
import { runSession } from '../app/core/behavior.js';
import { buildDayPlan } from '../app/core/scheduler.js';
import { filterItems, loadTaxonomy } from '../tools/relevance.mjs';
import { pickNextKeyword, markKeywordUsed } from '../app/core/keywords.js';

const t0 = Date.now();
const LOG = path.join(ROOT, 'data', 'run.log');
fs.writeFileSync(LOG, '', 'utf8');

const say = (s) => {
  const line = `[${String(((Date.now() - t0) / 1000).toFixed(0)).padStart(4)}s] ${s}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n', 'utf8');
};

const cfg = loadConfig();
const acc = cfg.accounts[0];
const plan = buildDayPlan(cfg, todayStr());
const session = plan.sessions.find((s) => s.type === 'collect') || { hotTopics: cfg.hotTopics.slice(0, 3), targetLinks: 20 };
const keyword = process.env.KEYWORD && process.env.KEYWORD !== 'auto'
  ? process.env.KEYWORD
  : pickNextKeyword(cfg);
say(`账号 ${acc.id} · 关键词 ${keyword} · 目标 ${session.targetLinks} 条`);
say(`热点词: ${session.hotTopics.join(', ')}`);

await restartWindow(acc, { width: 520, height: 900 });
say('窗口就绪（已重启浏览器）');

const res = await runSession(acc, {
  hotTopics: session.hotTopics,
  industry: acc.industry,
  keyword,
  targetLinks: session.targetLinks,
  durationMin: Number(process.env.MINUTES || 8),
  onEvent: (e) => say(e.type === 'error' ? `错误 ${e.message}` : `     ${e.message}`)
});

say(`会话结束: 视频 ${res.videos} 条 / 评论 ${res.comments} 次 / 时长 ${res.durationSec}s / 验证码 ${res.captcha ? '有' : '无'}`);
say(`原始链接 ${res.links.length} 条`);

const tax = loadTaxonomy();
const ind = tax.industries[acc.industry];
const { kept, dropped, stats } = filterItems(res.links, ind, null, 60);
say(`过滤: 保留 ${stats.kept} / 丢弃 ${stats.dropped} (${stats.rate}%)`);

const dir = path.join(ROOT, 'data', 'collected');
ensureDir(dir);
const file = path.join(dir, `${todayStr()}_${acc.id}.json`);
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).items || [] : [];
const merged = new Map(prev.map((x) => [String(x.id), x]));
for (const k of kept) merged.set(String(k.id), k);
fs.writeFileSync(file, JSON.stringify({
  account: acc.id, date: todayStr(), savedAt: new Date().toISOString(), items: [...merged.values()]
}, null, 2), 'utf8');
say(`已落盘（累计 ${merged.size} 条）`);
markKeywordUsed(keyword, { produced: kept.length });

if (kept.length) {
  const { pushLinks } = await import('../app/core/push.js');
  const pr = await pushLinks(kept, { source: `agent-${acc.id}` });
  if (pr.ok) say(`推送: 接受 ${pr.accepted} / 重复 ${pr.duplicates} / 本地跳过 ${pr.skipped}`);
  else say(`推送失败: ${pr.error}`);
}

for (const k of kept.slice(0, 5)) say(`保留 ${k.relevance}分 | ${(k.desc || '').slice(0, 45)}`);
for (const d of dropped.slice(0, 5)) say(`丢弃 ${d.relevance}分 | ${(d.desc || '').slice(0, 45)}`);
