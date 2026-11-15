// 链接推送客户端：把采集结果过滤后推到引潮 /api/ingest/links
//
// 用法:
//   node tools/push.mjs --stats                         看服务端待处理数量
//   node tools/push.mjs --dry data/a.json               只预览，不发送
//   node tools/push.mjs data/a.json data/b.json         过滤后推送
//   node tools/push.mjs data/a.json --industry 地坪 --batch 100
//
// key 不写死在代码里：优先读环境变量 INGEST_KEY，其次读 data/ingest.key
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\抖音auto';
const BASE = process.env.INGEST_URL || 'http://103.236.69.137:8000';
const KEY_FILE = path.join(ROOT, 'data', 'ingest.key');
const TAX = path.join(ROOT, 'data', 'keywords.json');
const LOG_DIR = path.join(ROOT, 'data', 'push_logs');

function loadKey() {
  if (process.env.INGEST_KEY) return process.env.INGEST_KEY.trim();
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, 'utf8').trim();
  return '';
}

const KEY = loadKey();

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const val = (k, d = null) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const files = args.filter((a) => !a.startsWith('--') && fs.existsSync(a));

const industry = val('--industry', '膜结构');
const batchSize = parseInt(val('--batch', '100'), 10);
const limit = val('--limit') ? parseInt(val('--limit'), 10) : Infinity;
const source = val('--source', 'agent-home');
const dry = has('--dry');

function die(msg) { console.error(msg); process.exit(1); }
if (!KEY) die('缺少 key：请设置环境变量 INGEST_KEY，或写入 ' + KEY_FILE);

async function api(pathname, init = {}) {
  const res = await fetch(BASE + pathname, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': KEY, ...(init.headers || {}) },
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

if (has('--stats')) {
  const s = await api('/api/ingest/stats', { method: 'GET' });
  console.log('服务端状态:', JSON.stringify(s));
  process.exit(0);
}

if (files.length === 0) die('用法: node tools/push.mjs <结果json...> [--industry 膜结构] [--batch 100] [--dry]');

// ---- 载入词表 ----
const tax = JSON.parse(fs.readFileSync(TAX, 'utf8'));
const ind = tax.industries[industry];
if (!ind) die(`词表里没有行业「${industry}」，可选: ${Object.keys(tax.industries).join(', ')}`);
const terms = ind.terms || [];
const excludes = ind.exclude || [];

// ---- 载入候选项 ----
const candidates = new Map();
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const items = data.items || (Array.isArray(data) ? data : []);
  for (const it of items) {
    const id = String(it.id || it.aweme_id || '');
    if (!/^\d{10,}$/.test(id)) continue;
    const title = (it.desc || it.title || '');
    const author = it.author || '';
    if (!candidates.has(id)) {
      candidates.set(id, { id, title, author, url: it.url || '', type: it.type || '视频' });
    }
  }
}

// 本地已推台账：防止同一批链接反复推给服务端（服务端只按自己的表去重）
const LEDGER = path.join(ROOT, 'data', 'pushed_ids.json');
const pushed = new Set(fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : []);
const beforeLedger = candidates.size;
let ledgerSkipped = 0;
if (!has('--force')) {
  for (const id of [...candidates.keys()]) {
    if (pushed.has(id)) { candidates.delete(id); ledgerSkipped++; }
  }
}

// ---- 过滤 ----
const kept = [];
const dropped = { noTerm: [], excluded: [] };
for (const c of candidates.values()) {
  const text = c.title + ' ' + c.author;
  const bad = excludes.find((w) => c.title.includes(w));
  if (bad) { dropped.excluded.push({ ...c, why: bad }); continue; }
  if (!terms.some((w) => text.includes(w))) { dropped.noTerm.push(c); continue; }
  kept.push(c);
}

const list = kept.slice(0, limit);

console.log(`行业: ${industry}`);
console.log(`候选 ${beforeLedger} 条 → 已推过跳过 ${ledgerSkipped} → 保留 ${kept.length}，排除词命中 ${dropped.excluded.length}，不含行业词 ${dropped.noTerm.length}`);
console.log(`本次推送 ${list.length} 条（批大小 ${batchSize}）`);
if (dropped.excluded.length) {
  console.log('  排除样例:', dropped.excluded.slice(0, 3).map((d) => `${d.why} | ${d.title.slice(0, 30)}`).join(' ; '));
}

if (dry) {
  console.log('\n[DRY] 不发送。前 5 条:');
  for (const c of list.slice(0, 5)) console.log(`  ${c.type} ${c.id} | ${c.title.slice(0, 50)}`);
  process.exit(0);
}

// ---- 分批推送 ----
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
const logLine = (s) => { console.log(s); try { fs.appendFileSync(logFile, s + '\r\n', 'utf8'); } catch {} };

let accepted = 0, duplicates = 0, failed = 0;
for (let i = 0; i < list.length; i += batchSize) {
  const chunk = list.slice(i, i + batchSize);
  const payload = { source, links: chunk.map((c) => c.url || c.id) };
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      const r = await api('/api/ingest/links', { method: 'POST', body: JSON.stringify(payload) });
      accepted += r.accepted || 0;
      duplicates += r.duplicates || 0;
      for (const c of chunk) pushed.add(c.id);
      fs.writeFileSync(LEDGER, JSON.stringify([...pushed]), 'utf8');
      logLine(`[批次 ${Math.floor(i / batchSize) + 1}] 推 ${chunk.length} → accepted ${r.accepted} / duplicates ${r.duplicates} / 待处理 ${r.total_new}`);
      ok = true;
    } catch (e) {
      if (attempt === 3) { failed += chunk.length; logLine(`[批次 ${Math.floor(i / batchSize) + 1}] 失败: ${e.message}`); }
      else await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
  if (i + batchSize < list.length) await new Promise((res) => setTimeout(res, 800));
}

logLine(`\n完成: 接受 ${accepted} | 重复 ${duplicates} | 失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
