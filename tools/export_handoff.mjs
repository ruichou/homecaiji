// 生成给「引潮」项目的交接文件：链接清单 + 关键词清单
import fs from 'node:fs';
import path from 'node:path';

const DATA = 'D:\\抖音auto\\data';
const OUT = 'D:\\引潮\\引潮项目完整交接包-20261112\\引潮项目完整交接包-20261112\\交接-抖音链接-20261114';

const sources = [
  { file: path.join(DATA, '膜结构_合并_2026-11-14T10-07-27.json'), label: '膜结构' },
  { file: path.join(DATA, '浙江膜结构_2026-11-14T10-18-57.json'), label: '浙江膜结构' }
];

const merged = new Map();
const stats = [];

for (const s of sources) {
  const data = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  const items = data.items || [];
  let added = 0;
  for (const it of items) {
    const id = String(it.id);
    if (!id) continue;
    if (!merged.has(id)) {
      merged.set(id, {
        id,
        type: it.type === '图文' ? '图文' : '视频',
        url: it.url || `https://www.douyin.com/video/${id}`,
        author: it.author || '',
        desc: (it.desc || '').slice(0, 120),
        source: s.label
      });
      added++;
    }
  }
  stats.push({ label: s.label, count: items.length, added });
}

const all = [...merged.values()];
const videos = all.filter(x => x.type === '视频');
const notes = all.filter(x => x.type === '图文');

fs.mkdirSync(OUT, { recursive: true });

// 1) 纯链接清单（一行一个，直接粘进「手动采集池」）
fs.writeFileSync(path.join(OUT, '抖音链接清单.txt'), all.map(x => x.url).join('\r\n') + '\r\n', 'utf8');

// 2) 带元数据的 CSV
const esc = (s) => {
  s = (s ?? '').toString().replace(/\r?\n/g, ' ').trim();
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const head = '序号,类型,ID,链接,作者,来源,标题片段';
const rows = all.map((a, i) => [i + 1, a.type, a.id, a.url, esc(a.author), esc(a.source), esc(a.desc)].join(','));
fs.writeFileSync(path.join(OUT, '抖音链接清单.csv'), '\ufeff' + [head, ...rows].join('\r\n'), 'utf8');

// 3) 关键词清单：江浙沪 + 山东
const cities = {
  '上海': ['上海'],
  '江苏': ['南京', '苏州', '无锡', '常州', '南通', '扬州', '泰州', '镇江', '盐城', '淮安', '徐州', '连云港', '宿迁'],
  '浙江': ['杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '台州', '丽水', '衢州', '舟山'],
  '山东': ['济南', '青岛', '烟台', '潍坊', '临沂', '淄博', '济宁', '泰安', '威海', '日照', '东营', '德州', '聊城', '滨州', '菏泽', '枣庄']
};
const keywordLines = [];
for (const [prov, list] of Object.entries(cities)) {
  for (const c of list) keywordLines.push(`${c}膜结构`);
}
fs.writeFileSync(path.join(OUT, '关键词清单-城市矩阵.txt'), keywordLines.join('\r\n') + '\r\n', 'utf8');

console.log('来源:');
for (const s of stats) console.log(`  ${s.label}: ${s.count} 条，新增 ${s.added}`);
console.log('');
console.log(`合并去重: ${all.length} 条 (视频 ${videos.length} / 图文 ${notes.length})`);
console.log(`关键词: ${keywordLines.length} 个城市`);
console.log('输出目录:', OUT);
