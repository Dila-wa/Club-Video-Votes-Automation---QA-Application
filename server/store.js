const fs = require('fs');
const config = require('./config');

function ensureDirs() {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  fs.mkdirSync(config.SCREENSHOT_DIR, { recursive: true });
}

function load() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(config.STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function save(state) {
  ensureDirs();
  const tmp = `${config.STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, config.STATE_FILE);
}

module.exports = { load, save, ensureDirs };
