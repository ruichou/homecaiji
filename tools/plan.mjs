// 生成 7 天采集计划：plan.json
// 用法: node tools/plan.mjs [起始日期YYYY-MM-DD] [每天任务数]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\抖音auto';
const PLAN = path.join(ROOT, 'data', 'batch', 'plan.json');

const CITIES = {
  '上海': ['上海'],
  '江苏': ['南京', '苏州', '无锡', '常州', '南通', '扬州', '泰州', '镇江', '盐城', '淮安', '徐州', '连云港', '宿迁'],
  '浙江': ['杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '台州', '丽水', '衢州', '舟山'],
  '山东': ['济南', '青岛', '烟台', '潍坊', '临沂', '淄博', '济宁', '泰安', '威海', '日照', '东营', '德州', '聊城', '滨州', '菏泽', '枣庄']
};

const BASE = '膜结构';
const WINDOWS = [
  { name: '一周内', publishTime: 7 },
  { name: '半年内', publishTime: 180 }
];

const startArg = process.argv[2];
const perDay = process.argv[3] ? parseInt(process.argv[3], 10) : 12;
const DAYS = 7;

// 默认从明天开始
const start = startArg ? new Date(startArg + 'T00:00:00') : (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
})();

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 展开成任务序列：每个城市两个时间窗，交替排列
const seq = [];
for (const [prov, list] of Object.entries(CITIES)) {
  for (const city of list) {
    for (const w of WINDOWS) {
      seq.push({ province: prov, city, keyword: city + BASE, window: w.name, publishTime: w.publishTime });
    }
  }
}

const tasks = seq.map((t, i) => {
  const dayIdx = Math.min(Math.floor(i / perDay), DAYS - 1);
  const d = new Date(start);
  d.setDate(d.getDate() + dayIdx);
  return { id: i + 1, day: dayIdx + 1, date: fmt(d), ...t, status: 'pending', doneAt: null, count: null, note: '' };
});

const plan = {
  createdAt: new Date().toISOString(),
  base: BASE,
  days: DAYS,
  perDay,
  time: '09:30',
  startDate: fmt(start),
  endDate: fmt(new Date(start.getTime() + (DAYS - 1) * 86400000)),
  pacing: { minGapSec: 20, maxGapSec: 45 },
  windows: WINDOWS,
  totalTasks: tasks.length,
  tasks
};

fs.mkdirSync(path.dirname(PLAN), { recursive: true });
fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2), 'utf8');

const byDay = {};
for (const t of tasks) byDay[t.date] = (byDay[t.date] || 0) + 1;

console.log(`计划已生成: ${PLAN}`);
console.log(`共 ${tasks.length} 个任务，${DAYS} 天，每天约 ${perDay} 个`);
console.log('');
for (const [d, n] of Object.entries(byDay)) console.log(`  ${d}  ${n} 个任务`);
