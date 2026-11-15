// 采集执行器：按 plan.json 跑当天任务，可断点续跑
// 用法:
//   node tools/batch.mjs --dry            只看今天要跑什么，不发请求
//   node tools/batch.mjs --today          跑今天的任务
//   node tools/batch.mjs --date 2026-11-16
//   node tools/batch.mjs --today --limit 2
import fs from 'node:fs';
import path from 'node:path';
import { ensureChrome, connect, runSearch, toCsv, sleep, cdpUp } from './lib.mjs';

const ROOT = 'D:\\抖音auto';
const PLAN_PATH = path.join(ROOT, 'data', 'batch', 'plan.json');
const LOG_DIR = path.join(ROOT, 'data', 'batch', 'logs');
const FLAG = path.join(ROOT, 'data', 'batch', 'NEED-MANUAL.flag');

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const val = (k, d = null) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const dry = has('--dry');
const limit = val('--limit') ? parseInt(val('--limit'), 10) : Infinity;
const dateArg = val('--date');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const targetDate = dateArg || (val('--day') ? null : todayStr());

if (!fs.existsSync(PLAN_PATH)) {
  console.error('找不到计划文件:', PLAN_PATH);
  console.error('先生成计划: node tools/plan.mjs');
  process.exit(1);
}

const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));

// --day N 时取第 N 天的日期
let date = targetDate;
if (val('--day')) {
  const n = parseInt(val('--day'), 10);
  const t = plan.tasks.find((x) => x.day === n);
  date = t ? t.date : targetDate;
}

const todays = plan.tasks.filter((t) => t.date === date);
const pending = todays.filter((t) => t.status === 'pending');

fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `${date}.log`);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\r\n', 'utf8'); } catch {}
}

function savePlan() {
  const tmp = PLAN_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(plan, null, 2), 'utf8');
  fs.renameSync(tmp, PLAN_PATH);
}

log(`===== 批次开始 | 日期 ${date} | 计划内 ${todays.length} 个 | 待跑 ${pending.length} 个 =====`);

if (has('--status')) {
  const byDay = {};
  for (const t of plan.tasks) {
    byDay[t.date] = byDay[t.date] || { total: 0, done: 0, pending: 0, bad: 0 };
    byDay[t.date].total++;
    if (t.status === 'done') byDay[t.date].done++;
    else if (t.status === 'pending') byDay[t.date].pending++;
    else byDay[t.date].bad++;
  }
  log('===== 全局进度 =====');
  for (const [d, s] of Object.entries(byDay)) {
    log(`  ${d}  完成 ${s.done}/${s.total}  待跑 ${s.pending}  异常 ${s.bad}`);
  }
  const td = plan.tasks.filter((t) => t.status === 'done').reduce((a, t) => a + (t.count || 0), 0);
  log(`累计采集 ${td} 条`);
  process.exit(0);
}

if (has('--reset-failed')) {
  const bad = todays.filter((t) => ['failed', 'captcha', 'need_login'].includes(t.status));
  for (const t of bad) { t.status = 'pending'; t.note = ''; }
  savePlan();
  log(`已把 ${bad.length} 个异常任务重置为待跑: ${bad.map((t) => '#' + t.id).join(', ')}`);
  process.exit(0);
}

if (todays.length === 0) {
  log('这一天没有排任务，结束。');
  process.exit(0);
}

if (pending.length === 0) {
  log('今天任务已全部完成，结束。');
  process.exit(0);
}

if (dry) {
  log('[DRY] 不会发任何请求。今天要跑：');
  for (const t of pending) log(`  #${t.id} ${t.keyword} | ${t.window} (publish_time=${t.publishTime})`);
  const ok = await cdpUp();
  log(`[DRY] Chrome CDP ${ok ? '在线' : '离线（正式运行时会自动拉起）'}`);
  process.exit(0);
}

let page;
try {
  // 防并发：已有批次在跑就直接退出
  const LOCK = path.join(ROOT, 'data', 'batch', 'RUNNING.lock');
  if (fs.existsSync(LOCK)) {
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (age < 3 * 3600 * 1000) {
      log(`已有一个批次在运行（锁文件 ${Math.round(age / 60000)} 分钟前创建），本次退出。`);
      process.exit(0);
    }
    log('清理过期的锁文件');
    fs.unlinkSync(LOCK);
  }
  fs.writeFileSync(LOCK, String(process.pid), 'utf8');
  process.on('exit', () => { try { fs.unlinkSync(LOCK); } catch {} });

  const r = await ensureChrome({ headless: has('--headless') });
  if (r.launched) log('已自动拉起 Chrome');
  page = await connect();
  await page.send('Page.enable');
  await page.send('Network.enable');
  log('CDP 已连接');
} catch (e) {
  log('浏览器启动失败: ' + e.message);
  process.exit(1);
}

let done = 0, failed = 0, totalItems = 0;
const runList = pending.slice(0, limit);

for (const t of runList) {
  log(`--- #${t.id} ${t.keyword} | ${t.window} ---`);
  const t0 = Date.now();
  let res;
  try {
    res = await runSearch(page, t.keyword, { publishTime: t.publishTime, maxRounds: 40 });
  } catch (e) {
    log(`  失败: ${e.message}`);
    t.status = 'failed';
    t.note = e.message.slice(0, 120);
    failed++;
    savePlan();
    continue;
  }

  if (res.captcha) {
    log('  !! 出现验证码，停止本轮，等待人工处理');
    t.status = 'captcha';
    savePlan();
    fs.writeFileSync(FLAG, [
      `时间: ${new Date().toISOString()}`,
      `任务: #${t.id} ${t.keyword} ${t.window}`,
      '',
      '请在 Chrome 窗口里手动过掉验证码，然后重新运行:',
      '  node tools/batch.mjs --date ' + date,
      ''
    ].join('\r\n'), 'utf8');
    process.exit(2);
  }

  if (res.needLogin) {
    log('  !! 登录态失效，需要扫码');
    t.status = 'need_login';
    savePlan();
    fs.writeFileSync(FLAG, `时间: ${new Date().toISOString()}\n需要扫码登录抖音，然后重跑: node tools/batch.mjs --date ${date}\n`, 'utf8');
    process.exit(3);
  }

  const items = res.items;
  totalItems += items.length;

  // 相关性自检：行业词命中率太低，说明搜索已被降权（不是关键词噪音那么简单）
  const terms = plan.industryTerms || ['膜', '棚', '钢构', '张拉', '雨棚'];
  const junk = items.filter((x) => !terms.some((w) => ((x.desc || '') + (x.author || '')).includes(w))).length;
  const junkRate = items.length ? junk / items.length : 0;
  if (items.length >= 10 && junkRate > 0.4) {
    log(`  !! 相关性异常：${items.length} 条里 ${junk} 条不含行业词 (${(junkRate * 100).toFixed(0)}%)`);
    t.status = 'suspicious';
    t.note = `相关性 ${(100 - junkRate * 100).toFixed(0)}%，疑似降权`;
    savePlan();
    fs.writeFileSync(FLAG, `时间: ${new Date().toISOString()}\n任务 #${t.id} ${t.keyword} 相关性只有 ${(100 - junkRate * 100).toFixed(0)}%，疑似账号降权。\n建议停机观察 1-2 天后再试。\n`, 'utf8');
    process.exit(4);
  }

  const dir = path.join(ROOT, 'data', 'batch', t.window);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${t.city}_${plan.base}_${date}`;
  const jsonPath = path.join(dir, base + '.json');
  const csvPath = path.join(dir, base + '.csv');

  fs.writeFileSync(jsonPath, JSON.stringify({
    keyword: t.keyword, window: t.window, publishTime: t.publishTime,
    city: t.city, province: t.province, collectedAt: new Date().toISOString(),
    count: items.length, items
  }, null, 2), 'utf8');

  const rows = items.map((a, i) => [i + 1, a.type, a.id, a.url, a.author, a.desc, a.digg ?? '', a.comment ?? '', a.createTime ?? '']);
  fs.writeFileSync(csvPath, toCsv(rows, ['序号', '类型', 'ID', '链接', '作者', '标题', '点赞数', '评论数', '发布时间']), 'utf8');

  // 校验时间窗是否真的生效：不看 URL 参数，直接看采集到内容的发布时间
  let paramOk = true;
  let dateNote = '';
  if (t.publishTime) {
    const times = items.map((x) => (x.createTime ? new Date(x.createTime).getTime() : null)).filter(Boolean);
    if (times.length >= 5) {
      const cutoff = Date.now() - t.publishTime * 86400000 - 86400000;
      const fresh = times.filter((x) => x >= cutoff).length;
      paramOk = fresh / times.length >= 0.6;
      dateNote = `时间窗内 ${fresh}/${times.length}`;
      log(`  发布时间校验: ${dateNote} ${paramOk ? 'OK' : '!! 大量内容超出时间窗'}`);
    }
  }

  t.status = 'done';
  t.doneAt = new Date().toISOString();
  t.count = items.length;
  t.note = paramOk ? dateNote : `时间窗疑似未生效 (${dateNote})`;
  savePlan();

  done++;
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  log(`  完成 ${items.length} 条 (${sec}s) | 接口包 ${res.stats.packets} 个`);

  if (t !== runList[runList.length - 1]) {
    const gap = Math.round(plan.pacing.minGapSec + Math.random() * (plan.pacing.maxGapSec - plan.pacing.minGapSec));
    log(`  冷却 ${gap}s`);
    await sleep(gap * 1000);
  }
}

log(`===== 批次结束 | 成功 ${done} | 失败 ${failed} | 新增 ${totalItems} 条 =====`);
savePlan();
try { page.close(); } catch {}
process.exit(0);
