const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

const config = require('./config');
const store = require('./store');
const Logger = require('./logger');
const JobManager = require('./jobManager');

store.ensureDirs();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const logger = new Logger(io);
const jobManager = new JobManager({ store, logger, io });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/screenshots', express.static(config.SCREENSHOT_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function parseEmails(text) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seen = new Set();
  const result = [];
  text.split(/\r?\n|,/).forEach((line) => {
    const value = line.trim().replace(/^["']|["']$/g, '');
    if (!value) return;
    if (/^email$/i.test(value)) return;
    if (!emailRegex.test(value)) return;
    const lower = value.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    result.push(value);
  });
  return result;
}

app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const text = req.file.buffer.toString('utf-8');
    const emails = parseEmails(text);
    if (!emails.length) return res.status(400).json({ error: 'No valid email addresses found in that file.' });

    const settings = {
      videoLabel: (req.body.videoLabel || 'Video 1').trim(),
      headless: req.body.headless === 'true',
      delayMs: Math.max(500, Number(req.body.delayMs) || 2500),
    };

    jobManager.createJob(emails, settings);
    return res.json({ ok: true, count: emails.length, state: jobManager.getState() });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

function wrapAction(fn) {
  return (req, res) => {
    try {
      fn();
      res.json({ ok: true, state: jobManager.getState() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

app.post('/api/job/start', wrapAction(() => jobManager.start()));
app.post('/api/job/pause', wrapAction(() => jobManager.requestPause('paused-manual')));
app.post('/api/job/resume', wrapAction(() => jobManager.resume()));
app.post('/api/job/cancel', wrapAction(() => jobManager.cancel()));

app.get('/api/job/state', (req, res) => {
  res.json({ state: jobManager.getState(), logs: logger.getBuffer() });
});

app.get('/api/job/export', (req, res) => {
  const type = req.query.type || 'all';
  const state = jobManager.getState();
  const rows = state.emails.filter((e) => (type === 'all' ? true : e.status === type));
  const csvLines = ['email,status,message,timestamp'].concat(
    rows.map((r) => {
      const message = (r.message || '').replace(/"/g, '""');
      const ts = r.timestamp ? new Date(r.timestamp).toISOString() : '';
      return `${r.email},${r.status},"${message}",${ts}`;
    }),
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${type}-emails.csv"`);
  res.send(csvLines.join('\n'));
});

let controllerSocketId = null;

io.on('connection', (socket) => {
  controllerSocketId = socket.id;
  socket.emit('init', { state: jobManager.getState(), logs: logger.getBuffer() });
  logger.info('Dashboard connected.');

  socket.on('disconnect', () => {
    if (socket.id !== controllerSocketId) return;
    if (jobManager.getState().status === 'running') {
      jobManager.requestPause('paused-disconnect');
    } else {
      logger.info('Dashboard disconnected.');
    }
  });
});

server.listen(config.PORT, () => {
  logger.info(`QA dashboard running at http://localhost:${config.PORT}`);
});
