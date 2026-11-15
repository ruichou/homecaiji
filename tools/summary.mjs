// 汇总一份采集结果：条数、作者分布、样例
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.log('用法: node tools/summary.mjs <json文件>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const items = data.items || [];

const authors = new Map();
for (const it of items) {
  const m = (it.text || '').match(/@([^\s·@]+)/);
  const name = m ? m[1] : '(未识别)';
  authors.set(name, (authors.get(name) || 0) + 1);
}
const top = [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

const ids = new Set(items.map(x => x.id));
console.log('关键词 :', data.keyword);
console.log('标签   :', data.tab || '-');
console.log('采集时间:', data.collectedAt);
console.log('条数   :', items.length, '| 唯一ID:', ids.size);
console.log('');
console.log('作者数 :', authors.size, '| 发布≥2条的:', [...authors.values()].filter(v => v >= 2).length);
console.log('');
console.log('发布量 Top15:');
for (const [n, c] of top) console.log(`  ${String(c).padStart(3)}  ${n}`);
console.log('');
console.log('前 5 条:');
for (const it of items.slice(0, 5)) {
  console.log(`  [${it.seq}] ${it.url}`);
  console.log(`       ${(it.text || '').slice(0, 90)}`);
}
