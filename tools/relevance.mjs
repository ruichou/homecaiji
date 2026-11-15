// 相关性过滤：判断一条视频/图文是否属于目标行业
// 用法: node tools/relevance.mjs <json文件> [行业]
import fs from 'node:fs';
import path from 'node:path';

const KW_PATH = 'D:\\抖音auto\\data\\keywords.json';

export function loadTaxonomy() {
  return JSON.parse(fs.readFileSync(KW_PATH, 'utf8'));
}

/**
 * 给单条内容打分
 * @param {{desc?:string, author?:string, createTime?:string}} item
 * @param {{terms:string[], exclude:string[]}} tax
 * @param {string} [city] 目标城市，命中加分
 */
export function scoreItem(item, tax, city) {
  const title = (item.desc || '').replace(/\s+/g, ' ');
  const author = item.author || '';

  const hitTerms = tax.terms.filter((t) => title.includes(t) || author.includes(t));
  const hitExclude = tax.exclude.filter((t) => title.includes(t));

  let score = 0;
  if (hitTerms.length > 0) score = 60 + Math.min(hitTerms.length - 1, 3) * 8; // 60–84
  if (hitTerms.length >= 2) score = Math.max(score, 72);
  if (title.includes('膜结构') || title.includes('推拉棚') || title.includes('地坪') || title.includes('冷库')) {
    score = Math.max(score, 85); // 精确命中行业主词
  }

  const cityHit = city ? (title.includes(city) || author.includes(city)) : false;
  if (cityHit) score = Math.min(100, score + 20);

  if (hitExclude.length > 0) score = Math.max(0, score - 45);

  return { score: Math.round(score), hitTerms, hitExclude, cityHit };
}

/** 过滤一整批，返回 {kept, dropped, stats} */
export function filterItems(items, tax, city, threshold = 60) {
  const kept = [];
  const dropped = [];
  for (const it of items) {
    const r = scoreItem(it, tax, city);
    const rec = { ...it, relevance: r.score, hitTerms: r.hitTerms, cityHit: r.cityHit };
    if (r.score >= threshold) kept.push(rec);
    else dropped.push(rec);
  }
  const stats = {
    total: items.length,
    kept: kept.length,
    dropped: dropped.length,
    rate: items.length ? +(kept.length / items.length * 100).toFixed(1) : 0
  };
  return { kept, dropped, stats };
}

// CLI 自测
if (process.argv[1] && process.argv[1].endsWith('relevance.mjs')) {
  const file = process.argv[2];
  const industry = process.argv[3] || '膜结构';
  if (!file) { console.log('用法: node tools/relevance.mjs <json文件> [行业]'); process.exit(1); }

  const tax = loadTaxonomy();
  const ind = tax.industries[industry];
  if (!ind) { console.log('未知行业:', industry, '可选:', Object.keys(tax.industries).join(', ')); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = data.items || data;
  const { kept, dropped, stats } = filterItems(items, ind, data.city);

  console.log(`行业: ${industry} | 文件: ${path.basename(file)}`);
  console.log(`总数 ${stats.total} | 保留 ${stats.kept} (${stats.rate}%) | 丢弃 ${stats.dropped}`);
  console.log('');
  console.log('丢弃样例:');
  for (const d of dropped.slice(0, 8)) console.log(`  ${d.relevance}分 | ${(d.desc || '').slice(0, 60)}`);
}
