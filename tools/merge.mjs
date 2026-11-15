// 合并多个采集结果并按 ID 去重，输出统一的 CSV / JSON
// 用法: node tools/merge.mjs <关键词> <file1.json> <file2.json> ...
import fs from 'node:fs';
import path from 'node:path';

const [keyword, ...files] = process.argv.slice(2);
if (!keyword || files.length === 0) {
  console.log('用法: node tools/merge.mjs <关键词> <file1.json> ...');
  process.exit(1);
}

const OUT_DIR = 'D:\\抖音auto\\data';

function guessAuthor(text) {
  const m = (text || '').match(/@([^\s·@]+)/);
  return m ? m[1] : '';
}

const merged = new Map();
const sources = [];

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  sources.push({ file: path.basename(f), tab: data.tab || '-', count: (data.items || []).length });
  for (const it of data.items || []) {
    const id = String(it.id);
    if (!id) continue;
    const isObj = it.type === '图文' || it.type === '视频';
    const rec = {
      id,
      type: isObj ? it.type : '视频',
      url: it.url || `https://www.douyin.com/video/${id}`,
      author: it.author || guessAuthor(it.text),
      desc: it.desc || (it.text || '').replace(/^\S+\s+\S+\s+/, '').slice(0, 200),
      digg: it.digg ?? null,
      comment: it.comment ?? null,
      createTime: it.createTime || null
    };
    const old = merged.get(id);
    if (!old) merged.set(id, rec);
    else {
      // 合并：优先保留字段更全的那份
      for (const k of Object.keys(rec)) {
        if ((old[k] === null || old[k] === '' || old[k] === undefined) && rec[k]) old[k] = rec[k];
      }
    }
  }
}

const arr = [...merged.values()];
const videoN = arr.filter(x => x.type === '视频').length;
const imageN = arr.filter(x => x.type === '图文').length;

fs.mkdirSync(OUT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const safe = keyword.replace(/[\\/:*?"<>|]/g, '_');
const jsonPath = path.join(OUT_DIR, `${safe}_合并_${ts}.json`);
const csvPath = path.join(OUT_DIR, `${safe}_合并_${ts}.csv`);

fs.writeFileSync(jsonPath, JSON.stringify({ keyword, collectedAt: new Date().toISOString(), sources, count: arr.length, video: videoN, image: imageN, items: arr }, null, 2), 'utf8');

const esc = (s) => {
  s = (s ?? '').toString().replace(/\r?\n/g, ' ').trim();
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const lines = ['序号,类型,ID,链接,作者,标题,点赞数,评论数,发布时间'];
arr.forEach((a, i) => lines.push([i + 1, a.type, a.id, a.url, esc(a.author), esc(a.desc), a.digg ?? '', a.comment ?? '', a.createTime ?? ''].join(',')));
fs.writeFileSync(csvPath, '\ufeff' + lines.join('\r\n'), 'utf8');

console.log('来源:');
for (const s of sources) console.log(`  ${s.file}  tab=${s.tab}  ${s.count} 条`);
console.log('');
console.log(`合并去重后: ${arr.length} 条 (视频 ${videoN} / 图文 ${imageN})`);
console.log('JSON:', jsonPath);
console.log('CSV :', csvPath);
