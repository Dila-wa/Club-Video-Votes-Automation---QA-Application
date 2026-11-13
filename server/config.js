const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

module.exports = {
  FORM_URL: process.env.FORM_URL || 'https://lionsclubs.jotform.com/253014062956050',
  PORT: Number(process.env.PORT) || 4300,
  DATA_DIR,
  SCREENSHOT_DIR: path.join(DATA_DIR, 'screenshots'),
  STATE_FILE: path.join(DATA_DIR, 'job-state.json'),
  LOG_FILE: path.join(DATA_DIR, 'activity.log'),
  DEFAULT_SETTINGS: {
    videoLabel: 'Video 1',
    headless: true,
    delayMs: 2500,
  },
};
