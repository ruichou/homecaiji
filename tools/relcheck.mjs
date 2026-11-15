// 检查一批结果与关键词的相关性
import fs from 'node:fs';

const file = process.argv[2];
const kw = process.argv[3] || '膜结构';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const items = data.items || [];

const hasMain = (s) => new RegExp(kw).test(s);
const hasChar = (s) => /膜|棚|钢构|张拉|雨棚|车棚/.test(s);

let mainHit = 0, charHit = 0, none = 0;
const bad = [];
for (const it of items) {
  const t = (it.desc || '') + ' ' + (it.author || '');
  if (hasMain(t)) mainHit++;
  else if (hasChar(t)) charHit++;
  else { none++; bad.push(it); }
}

console.log('文件:', file.split('\\').pop());
console.log('关键词:', kw, '| 总数:', items.length);
console.log(`  标题直接含"${kw}": ${mainHit}`);
console.log(`  含相关字(膜/棚/钢构/雨棚): ${charHit}`);
console.log(`  完全无关: ${none}  (${(none / items.length * 100).toFixed(0)}%)`);
console.log('');
console.log('无关样例（最多 12 条）:');
for (const it of bad.slice(0, 12)) {
  console.log(`  [${it.type}] @${(it.author || '').slice(0, 14)} | ${(it.desc || '').slice(0, 70)}`);
}
