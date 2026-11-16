// 把采集到的链接推给引潮 /api/ingest/links
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.js';

const BASE = process.env.INGEST_URL || 'http://103.236.69.137:8000';
const KEY_FILE = path.join(ROOT, 'data', 'ingest.key');
const LEDGER = path.join(ROOT, 'data', 'pushed_ids.json');
const BATCH = 100;

function readKey() {
  if (process.env.INGEST_KEY) return process.env.INGEST_KEY.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; }
}

function loadLedger() {
  try { return new Set(JSON.parse(fs.readFileSync(LEDGER, 'utf8'))); } catch { return new Set(); }
}

function saveLedger(set) {
  try { fs.writeFileSync(LEDGER, JSON.stringify([...set]), 'utf8'); } catch {}
}

/**
 * @param {Array<{id:string,url?:string}>} items
 * @param {{source?:string, force?:boolean}} opts
 */
export async function pushLinks(items, opts = {}) {
  const key = readKey();
  if (!key) return { ok: false, error: '缺少 data/ingest.key', accepted: 0, duplicates: 0, skipped: 0 };

  const ledger = loadLedger();
  const queue = [];
  let skipped = 0;
  for (const it of items) {
    const id = String(it.id || '');
    if (!/^\d{10,}$/.test(id)) continue;
    if (!opts.force && ledger.has(id)) { skipped++; continue; }
    queue.push({ id, url: it.url || `https://www.douyin.com/video/${id}` });
  }
  if (!queue.length) return { ok: true, accepted: 0, duplicates: 0, skipped };

  let accepted = 0, duplicates = 0;
  for (let i = 0; i < queue.length; i += BATCH) {
    const chunk = queue.slice(i, i + BATCH);
    const body = JSON.stringify({ source: opts.source || 'agent-home', links: chunk.map((c) => c.url) });
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const res = await fetch(`${BASE}/api/ingest/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': key },
          body,
          signal: AbortSignal.timeout(30000)
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
        const json = JSON.parse(text);
        accepted += json.accepted || 0;
        duplicates += json.duplicates || 0;
        for (const c of chunk) ledger.add(c.id);
        saveLedger(ledger);
        done = true;
      } catch (e) {
        if (attempt === 3) return { ok: false, error: e.message, accepted, duplicates, skipped };
        await new Promise((r) => setTimeout(r, 1200 * attempt));
      }
    }
  }
  return { ok: true, accepted, duplicates, skipped };
}
