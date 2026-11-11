const fs = require('fs');
const config = require('./config');
const store = require('./store');

const MAX_BUFFER = 1000;

class Logger {
  constructor(io) {
    this.io = io;
    this.buffer = [];
    store.ensureDirs();
  }

  _emit(level, msg) {
    const entry = { ts: Date.now(), level, msg };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();

    try {
      fs.appendFileSync(config.LOG_FILE, `[${new Date(entry.ts).toISOString()}] [${level}] ${msg}\n`);
    } catch {
      // best-effort file logging only
    }

    if (this.io) this.io.emit('log', entry);
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : 'log'](`[${level}] ${msg}`);
  }

  info(msg) { this._emit('info', msg); }
  warn(msg) { this._emit('warn', msg); }
  error(msg) { this._emit('error', msg); }
  success(msg) { this._emit('success', msg); }

  getBuffer() {
    return this.buffer;
  }
}

module.exports = Logger;
