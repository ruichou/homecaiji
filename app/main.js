// Electron 主进程：窗口管理 + 调度 + 会话执行
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

import { loadConfig, saveConfig, loadState, saveState, accountRuntime, todayStr, ensureDir, ROOT } from './core/store.js';
import { openWindow, closeWindow, cdpAlive, tileLayout } from './core/chrome.js';
import { buildDayPlan, minutesToNext } from './core/scheduler.js';
import { runSession, idleSession } from './core/behavior.js';
import { filterItems, loadTaxonomy } from '../tools/relevance.mjs';

const DATA = path.join(ROOT, 'data');
const COLLECT_DIR = path.join(DATA, 'collected');

let win = null;
let state = loadState();
let cfg = loadConfig();
let autoTimer = null;
const running = new Map();

const log = (msg, level = 'info') => {
  win?.webContents.send('log', { t: new Date().toLocaleTimeString(), msg, level });
  console.log(`[${level}] ${msg}`);
};
const progress = (data) => win?.webContents.send('progress', data);

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    title: '抖音采集台',
    backgroundColor: '#11141a',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(import.meta.dirname, 'ui', 'index.html'));
  win.on('closed', () => { win = null; });
}

function accById(id) {
  return cfg.accounts.find((a) => a.id === id);
}

function layoutFor(id) {
  const list = cfg.accounts.filter((a) => a.enabled);
  const idx = Math.max(0, list.findIndex((a) => a.id === id));
  return tileLayout(list.length, screen.getPrimaryDisplay().workArea)[idx];
}

async function openAndTrack(id) {
  const acc = accById(id);
  if (!acc) throw new Error('账号不存在: ' + id);
  const r = await openWindow(acc, layoutFor(id));
  log(`${acc.label || acc.id} 窗口${r.already ? '已存在' : '已打开'} (端口 ${acc.port})`);
  return r;
}

async function runOne(id, opts = {}) {
  if (running.has(id)) { log('该账号正在跑，跳过', 'warn'); return { skipped: true }; }
  const acc = accById(id);
  if (!acc) throw new Error('账号不存在');

  running.set(id, { startedAt: Date.now() });
  const rt = accountRuntime(state, id);
  rt.status = 'running';
  saveState(state);
  progress({ id, status: 'running' });

  try {
    await openAndTrack(id);
    log(`—— ${acc.label || acc.id} 开始一轮会话 ——`);

    const res = await runSession(acc, {
      hotTopics: opts.hotTopics || cfg.hotTopics,
      industry: acc.industry,
      onEvent: (e) => {
        if (e.type === 'log') log(`${acc.label || acc.id}: ${e.message}`);
        if (e.type === 'error') log(`${acc.label || acc.id}: ${e.message}`, 'error');
      }
    });

    // 过滤
    const tax = loadTaxonomy();
    const ind = tax.industries[acc.industry];
    const { kept, stats } = ind
      ? filterItems(res.links || [], ind, null, 60)
      : { kept: res.links || [], stats: { kept: (res.links || []).length, total: (res.links || []).length, rate: 100 } };

    // 落盘
    ensureDir(COLLECT_DIR);
    const file = path.join(COLLECT_DIR, `${todayStr()}_${acc.id}.json`);
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).items || [] : [];
    const merged = new Map(prev.map((x) => [String(x.id), x]));
    for (const k of kept) merged.set(String(k.id), k);
    fs.writeFileSync(file, JSON.stringify({
      account: acc.id, date: todayStr(), savedAt: new Date().toISOString(),
      items: [...merged.values()]
    }, null, 2), 'utf8');

    rt.links = merged.size;
    rt.sessions += 1;
    rt.lastRunAt = new Date().toISOString();
    rt.lastError = res.captcha ? '验证码' : null;
    rt.status = res.captcha ? 'captcha' : 'idle';
    saveState(state);

    log(`${acc.label || acc.id} 本轮完成：原始 ${stats.total} → 保留 ${stats.kept}，累计 ${merged.size} 条`);
    progress({ id, status: rt.status, links: rt.links, today: merged.size });
    return { kept: stats.kept, total: stats.total, today: merged.size };
  } catch (e) {
    const rt2 = accountRuntime(state, id);
    rt2.status = 'error';
    rt2.lastError = e.message;
    saveState(state);
    log(`${acc.label || acc.id} 失败: ${e.message}`, 'error');
    progress({ id, status: 'error' });
    return { error: e.message };
  } finally {
    running.delete(id);
  }
}

async function idleOne(id, opts = {}) {
  if (running.has(id)) { log('该账号正在跑，跳过', 'warn'); return { skipped: true }; }
  const acc = accById(id);
  if (!acc) throw new Error('账号不存在');

  const [lo, hi] = cfg.global.idleMinutesRange || [15, 35];
  const minutes = opts.minutes || Math.round(lo + Math.random() * (hi - lo));

  running.set(id, { startedAt: Date.now() });
  const rt = accountRuntime(state, id);
  rt.status = 'idle-run';
  saveState(state);
  progress({ id, status: 'idle-run' });

  try {
    await openAndTrack(id);
    log(`—— ${acc.label || acc.id} 开始闲逛（约 ${minutes} 分钟）——`);
    const stat = await idleSession(acc, {
      minutes,
      allowLive: true,
      onEvent: (e) => {
        if (e.type === 'log') log(`${acc.label || acc.id}: ${e.message}`);
        if (e.type === 'error') log(`${acc.label || acc.id}: ${e.message}`, 'error');
      }
    });
    rt.status = 'idle';
    rt.idleAt = new Date().toISOString();
    saveState(state);
    progress({ id, status: 'idle' });
    return stat;
  } catch (e) {
    rt.status = 'idle-error';
    rt.lastError = e.message;
    saveState(state);
    log(`${acc.label || acc.id} 闲逛失败: ${e.message}`, 'error');
    return { error: e.message };
  } finally {
    running.delete(id);
  }
}

function startAuto() {  if (autoTimer) return;
  autoTimer = setInterval(async () => {
    if (!cfg || !cfg.accounts.some((a) => a.enabled)) return;
    const plan = buildDayPlan(cfg, todayStr());
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const dayKey = todayStr();
    state.autoRun = state.autoRun || {};
    state.autoRun[dayKey] = state.autoRun[dayKey] || [];

    for (const s of plan.sessions) {
      const [h, m] = s.start.split(':').map(Number);
      const startMin = h * 60 + m;
      const key = `${s.account}#${s.index}`;
      if (cur >= startMin && cur <= startMin + 20 && !state.autoRun[dayKey].includes(key) && !running.has(s.account)) {
        state.autoRun[dayKey].push(key);
        saveState(state);
        if (s.type === 'idle') {
          log(`自动触发：${s.account} 闲逛（计划 ${s.start}）`);
          await idleOne(s.account, { minutes: s.durationMin });
        } else {
          log(`自动触发：${s.account} 第 ${s.index} 轮（计划 ${s.start}）`);
          await runOne(s.account, { hotTopics: s.hotTopics });
        }
      }
    }
  }, 60_000);
  log('自动模式已开启（每分钟检查一次计划）');
}

function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; log('自动模式已关闭'); }
}

app.whenReady().then(() => {
  ensureDir(DATA);
  createWindow();

  ipcMain.handle('cfg:load', () => cfg);
  ipcMain.handle('cfg:save', (_e, next) => { cfg = next; saveConfig(cfg); return { ok: true }; });

  ipcMain.handle('acc:status', async () => {
    const out = [];
    for (const a of cfg.accounts) {
      out.push({ id: a.id, alive: await cdpAlive(a.port), port: a.port });
    }
    return out;
  });

  ipcMain.handle('acc:open', (_e, id) => openAndTrack(id));
  ipcMain.handle('acc:close', (_e, id) => closeWindow(accById(id)));
  ipcMain.handle('acc:openAll', async () => {
    for (const a of cfg.accounts.filter((x) => x.enabled)) {
      try { await openAndTrack(a.id); } catch (e) { log(`${a.id} 打开失败: ${e.message}`, 'error'); }
    }
    return { ok: true };
  });
  ipcMain.handle('acc:closeAll', () => {
    for (const a of cfg.accounts) closeWindow(a);
    return { ok: true };
  });

  ipcMain.handle('plan:today', () => ({ plan: buildDayPlan(cfg, todayStr()), next: minutesToNext(buildDayPlan(cfg, todayStr())) }));
  ipcMain.handle('state:get', () => ({ state, today: todayStr() }));
  ipcMain.handle('run:once', (_e, id) => runOne(id));
  ipcMain.handle('run:idle', (_e, id) => idleOne(id));
  ipcMain.handle('run:stop', (_e, id) => { running.delete(id); return { ok: true }; });
  ipcMain.handle('auto:set', (_e, on) => { on ? startAuto() : stopAuto(); return { auto: !!autoTimer }; });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
