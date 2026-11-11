const socket = io();

let state = null;
let logs = [];
let currentFilter = 'all';

const els = {
  statusBadge: document.getElementById('statusBadge'),
  uploadForm: document.getElementById('uploadForm'),
  fileInput: document.getElementById('fileInput'),
  videoLabel: document.getElementById('videoLabel'),
  headless: document.getElementById('headless'),
  delayMs: document.getElementById('delayMs'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  progressBar: document.getElementById('progressBar'),
  countTotal: document.getElementById('countTotal'),
  countPending: document.getElementById('countPending'),
  countApproved: document.getElementById('countApproved'),
  countFailed: document.getElementById('countFailed'),
  resultsBody: document.getElementById('resultsBody'),
  terminal: document.getElementById('terminal'),
  modal: document.getElementById('resumeModal'),
  modalText: document.getElementById('modalText'),
  modalResume: document.getElementById('modalResume'),
  modalCancel: document.getElementById('modalCancel'),
  filterTabs: document.querySelectorAll('.filter-tab'),
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function appendLogLine(entry) {
  const line = document.createElement('div');
  line.className = `log-line log-${entry.level}`;
  line.textContent = `[${new Date(entry.ts).toLocaleTimeString()}] ${entry.msg}`;
  els.terminal.appendChild(line);
  els.terminal.scrollTop = els.terminal.scrollHeight;
}

function renderLogs() {
  els.terminal.innerHTML = '';
  logs.forEach(appendLogLine);
}

function maybeShowResumeModal() {
  if (state && state.status === 'paused-disconnect') {
    const done = state.currentIndex;
    const total = state.emails.length;
    els.modalText.textContent = `The automation paused because the dashboard disconnected (refresh/close) while it was running. It stopped after processing ${done} of ${total} emails. Resume from where it left off, or cancel and start a new batch?`;
    els.modal.classList.remove('hidden');
  } else {
    els.modal.classList.add('hidden');
  }
}

function render() {
  if (!state) return;

  els.statusBadge.textContent = state.status;
  els.statusBadge.className = `badge badge-${state.status}`;

  const total = state.emails.length;
  const approved = state.emails.filter((e) => e.status === 'approved').length;
  const failed = state.emails.filter((e) => e.status === 'failed').length;
  const pending = total - approved - failed;

  els.countTotal.textContent = total;
  els.countPending.textContent = pending;
  els.countApproved.textContent = approved;
  els.countFailed.textContent = failed;

  const pct = total ? Math.round(((approved + failed) / total) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.textContent = `${pct}%`;

  els.startBtn.disabled = !(state.status === 'idle' && total > 0);
  els.pauseBtn.disabled = state.status !== 'running';
  els.resumeBtn.disabled = !['paused-manual', 'paused-disconnect'].includes(state.status);
  els.cancelBtn.disabled = !(state.status === 'running' || state.status === 'paused-manual' || state.status === 'paused-disconnect');

  const rows = state.emails
    .map((e, idx) => ({ ...e, idx }))
    .filter((e) => (currentFilter === 'all' ? true : e.status === currentFilter));

  els.resultsBody.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.idx + 1}</td>
      <td>${escapeHtml(r.email)}</td>
      <td><span class="pill pill-${r.status}">${r.status}</span></td>
      <td>${escapeHtml(r.message || '')}</td>
      <td>${r.timestamp ? new Date(r.timestamp).toLocaleString() : ''}</td>
    </tr>
  `).join('');

  maybeShowResumeModal();
}

socket.on('init', (payload) => {
  state = payload.state;
  logs = payload.logs;
  renderLogs();
  render();
});

socket.on('state', (newState) => {
  state = newState;
  render();
});

socket.on('log', (entry) => {
  logs.push(entry);
  appendLogLine(entry);
});

els.uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!els.fileInput.files[0]) return;
  const fd = new FormData();
  fd.append('file', els.fileInput.files[0]);
  fd.append('videoLabel', els.videoLabel.value || 'Video 1');
  fd.append('headless', els.headless.checked ? 'true' : 'false');
  fd.append('delayMs', els.delayMs.value || '2500');

  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) alert(data.error);
});

els.startBtn.addEventListener('click', async () => {
  const res = await fetch('/api/job/start', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error);
});

els.pauseBtn.addEventListener('click', () => fetch('/api/job/pause', { method: 'POST' }));

els.resumeBtn.addEventListener('click', async () => {
  const res = await fetch('/api/job/resume', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) alert(data.error);
});

els.cancelBtn.addEventListener('click', () => {
  if (confirm('Cancel the current job?')) fetch('/api/job/cancel', { method: 'POST' });
});

els.modalResume.addEventListener('click', async () => {
  await fetch('/api/job/resume', { method: 'POST' });
});

els.modalCancel.addEventListener('click', async () => {
  await fetch('/api/job/cancel', { method: 'POST' });
});

els.filterTabs.forEach((tab) => tab.addEventListener('click', () => {
  currentFilter = tab.dataset.filter;
  els.filterTabs.forEach((t) => t.classList.toggle('active', t === tab));
  render();
}));
