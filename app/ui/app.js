const $ = (s) => document.querySelector(s);
let cfg = null;
let statusMap = {};

function statusDot(alive, rt) {
  const running = rt?.status === 'running' || rt?.status === 'idle-run';
  const cls = running ? 'run' : rt?.status === 'captcha' ? 'bad' : rt?.status === 'error' ? 'bad' : alive ? 'ok' : 'off';
  return `<span class="dot ${cls}"></span>`;
}

function fmtTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function refresh() {
  cfg = await window.api.loadConfig();
  const st = await window.api.getState();
  const sts = await window.api.status();
  statusMap = Object.fromEntries(sts.map((s) => [s.id, s.alive]));

  const total = cfg.accounts.filter((a) => a.enabled).reduce((n, a) => n + a.dailyLinks, 0);
  let got = 0;
  for (const a of cfg.accounts) got += st.state.accounts?.[a.id]?.links || 0;
  $('#todaySummary').textContent = `今日 ${got} / ${total} 条`;

  $('#accList').innerHTML = cfg.accounts.map((a) => {
    const rt = st.state.accounts?.[a.id] || {};
    const alive = statusMap[a.id];
    return `
      <div class="acc">
        <div class="acc-main">
          ${statusDot(alive, rt)}
          <div>
            <div class="acc-name">${a.label || a.id} <span class="muted">:${a.port}</span></div>
            <div class="muted small">${a.industry} · 目标 ${a.dailyLinks} 条 · 今日 ${rt.links || 0}</div>
          </div>
        </div>
        <div class="acc-actions">
          <button class="btn small" data-open="${a.id}">开窗</button>
          <button class="btn small ghost" data-close="${a.id}">关窗</button>
          <button class="btn small ghost" data-idle="${a.id}" ${rt.status === 'idle-run' ? 'disabled' : ''}>闲逛</button>
          <button class="btn small primary" data-run="${a.id}" ${rt.status === 'running' ? 'disabled' : ''}>跑一轮</button>
        </div>
      </div>`;
  }).join('');

  const { plan, next } = await window.api.todayPlan();
  $('#planMeta').textContent = `${plan.workWindow} · 夜间休息 ${plan.nightRest}${next !== null ? ` · 距下一轮 ${next} 分钟` : ''}`;
  $('#planList').innerHTML = plan.sessions.map((s) => `
    <div class="plan-row">
      <span class="time">${s.start}–${s.end}</span>
      <span class="who">${s.account}</span>
      <span class="tag ${s.type === 'idle' ? 'idle' : ''}">${s.type === 'idle' ? '闲逛' : '采集'}</span>
      <span class="muted small">${s.durationMin}分${s.type === 'idle' ? '' : ` · 热点 ${s.hotTopics.length} 个 · 点进 ${s.clicks} 条`}</span>
    </div>`).join('') || '<div class="muted">今天没有排期</div>';
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.open) { await window.api.openWindow(t.dataset.open); refresh(); }
  if (t.dataset.close) { await window.api.closeWindow(t.dataset.close); refresh(); }
  if (t.dataset.run) { t.disabled = true; await window.api.runOnce(t.dataset.run); refresh(); }
  if (t.dataset.idle) { t.disabled = true; await window.api.runIdle(t.dataset.idle); refresh(); }
});

$('#btnOpenAll').onclick = async () => { await window.api.openAll(); setTimeout(refresh, 1500); };
$('#btnCloseAll').onclick = async () => { await window.api.closeAll(); setTimeout(refresh, 800); };
$('#btnClear').onclick = () => { $('#logBox').innerHTML = ''; };
$('#autoToggle').onchange = async (e) => {
  const r = await window.api.setAuto(e.target.checked);
  appendLog({ t: fmtTime(new Date()), msg: `自动模式：${r.auto ? '已开启' : '已关闭'}`, level: 'info' });
};

function appendLog({ t, msg, level }) {
  const box = $('#logBox');
  const row = document.createElement('div');
  row.className = 'log-row ' + (level || 'info');
  row.innerHTML = `<span class="log-t">${t}</span><span class="log-m">${msg}</span>`;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

window.api.onLog(appendLog);
window.api.onProgress(() => refresh());

setInterval(() => { $('#clock').textContent = fmtTime(new Date()); }, 1000);
setInterval(refresh, 15000);
refresh();
