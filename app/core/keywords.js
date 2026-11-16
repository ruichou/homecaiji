// 关键词台账：记录每个词用过几次、最后一次什么时候，选词时优先没用过的
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.js';

const FILE = path.join(ROOT, 'data', 'keyword_usage.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(data) {
  try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 选下一个关键词：先排掉近 3 天用过的，再按使用次数从少到多 */
export function pickNextKeyword(cfg, forcedList) {
  const list = forcedList || cfg.industryKeywords || [];
  const usage = load();
  const now = Date.now();
  const threeDays = 3 * 86400000;

  const scored = list.map((k) => {
    const u = usage[k] || { uses: 0, lastUsed: null };
    const last = u.lastUsed ? new Date(u.lastUsed + 'T00:00:00').getTime() : 0;
    const recent = last && now - last < threeDays;
    return { keyword: k, uses: u.uses || 0, last: last || 0, recent };
  });

  const fresh = scored.filter((s) => !s.recent).sort((a, b) => a.uses - b.uses || a.last - b.last);
  if (fresh.length) return fresh[0].keyword;

  // 全用过了，就挑最久没用的
  scored.sort((a, b) => a.last - b.last || a.uses - b.uses);
  return scored[0]?.keyword || cfg.industryKeywords?.[0] || '';
}

export function markKeywordUsed(keyword, info = {}) {
  if (!keyword) return;
  const usage = load();
  const u = usage[keyword] || { uses: 0, lastUsed: null, produced: 0 };
  u.uses = (u.uses || 0) + 1;
  u.lastUsed = today();
  u.produced = (u.produced || 0) + (info.produced || 0);
  if (info.note) u.note = info.note;
  usage[keyword] = u;
  save(usage);
}

export function usageSnapshot() {
  return load();
}
