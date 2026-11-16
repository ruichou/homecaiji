// 配置与运行状态的持久化
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CFG_PATH = path.join(ROOT, 'config', 'accounts.json');
const STATE_PATH = path.join(ROOT, 'data', 'app-state.json');
const LOG_DIR = path.join(ROOT, 'data', 'logs');

export { ROOT, CFG_PATH, STATE_PATH, LOG_DIR };

export function loadConfig() {
  const raw = fs.readFileSync(CFG_PATH, 'utf8');
  return JSON.parse(raw);
}

export function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { accounts: {}, day: null, history: [] };
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_PATH);
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** 每个账号的运行态：今天采了多少、跑了哪些轮次 */
export function accountRuntime(state, id) {
  const day = todayStr();
  if (state.day !== day) {
    state.day = day;
    state.accounts = {};
  }
  if (!state.accounts[id]) {
    state.accounts[id] = { links: 0, sessions: 0, lastRunAt: null, lastError: null, status: 'idle' };
  }
  return state.accounts[id];
}
