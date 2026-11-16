// 用已有的 Electron 运行时启动，避免重复下载
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const CANDIDATES = [
  path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  'D:\\douyinAuto\\node_modules\\electron\\dist\\electron.exe'
];

const exe = CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) {
  console.error('找不到 electron.exe。装一下：npm i -D electron@43.3.0');
  process.exit(1);
}

console.log('使用 Electron:', exe);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;   // 否则 electron 会退化成普通 node
const child = spawn(exe, [ROOT], { stdio: 'inherit', cwd: ROOT, env });
child.on('exit', (code) => process.exit(code ?? 0));
