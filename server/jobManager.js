const crypto = require('crypto');
const config = require('./config');
const { submitVote } = require('./automation');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ACTIVE_STATUSES = ['running'];
const PAUSED_STATUSES = ['paused-manual', 'paused-disconnect'];
const TERMINAL_STATUSES = ['completed', 'cancelled'];

class JobManager {
  constructor({ store, logger, io }) {
    this.store = store;
    this.logger = logger;
    this.io = io;
    this.workerRunning = false;
    this.pauseRequested = false;
    this.pendingPauseStatus = null;
    this.state = this.store.load() || this.emptyState();

    // If the process was killed/crashed while a job was mid-run, the last
    // persisted status can still say "running" even though nothing is
    // actually looping in this fresh process. Surface that the same way a
    // dashboard disconnect does, instead of leaving the job stuck with no
    // control that can touch it.
    if (this.state.status === 'running') {
      this.state.status = 'paused-disconnect';
      this.logger.warn(
        `Server restarted while a job was running - resuming the automation loop automatically did not happen. Paused after email ${this.state.currentIndex} of ${this.state.emails.length}.`,
      );
      this.persist();
    }
  }

  emptyState() {
    return {
      id: null,
      status: 'idle',
      emails: [],
      currentIndex: 0,
      settings: { ...config.DEFAULT_SETTINGS },
      createdAt: null,
      updatedAt: null,
    };
  }

  getState() {
    return this.state;
  }

  persist() {
    this.state.updatedAt = Date.now();
    this.store.save(this.state);
    if (this.io) this.io.emit('state', this.state);
  }

  createJob(emails, settings) {
    if (ACTIVE_STATUSES.includes(this.state.status) || PAUSED_STATUSES.includes(this.state.status)) {
      throw new Error('A job is currently running or paused. Cancel it before starting a new batch.');
    }
    this.state = {
      id: crypto.randomUUID(),
      status: 'idle',
      emails: emails.map((email) => ({ email, status: 'pending', message: '', timestamp: null })),
      currentIndex: 0,
      settings: { ...config.DEFAULT_SETTINGS, ...settings },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.pauseRequested = false;
    this.pendingPauseStatus = null;
    this.persist();
    this.logger.info(`New job created with ${emails.length} email(s). Video choice: "${this.state.settings.videoLabel}".`);
  }

  start() {
    if (!this.state.id || this.state.emails.length === 0) {
      throw new Error('No email list loaded. Upload a list first.');
    }
    if (this.state.status === 'running') return;
    if (TERMINAL_STATUSES.includes(this.state.status)) {
      throw new Error('This job already finished. Upload a new list to start again.');
    }
    this.state.status = 'running';
    this.pauseRequested = false;
    this.pendingPauseStatus = null;
    this.persist();
    this.logger.info(`Job started/resumed from email ${this.state.currentIndex + 1} of ${this.state.emails.length}.`);
    this.runLoop();
  }

  requestPause(targetStatus) {
    if (this.state.status !== 'running') return;
    this.pauseRequested = true;
    this.pendingPauseStatus = targetStatus;
    if (targetStatus === 'paused-disconnect') {
      this.logger.warn('Dashboard disconnected while running - will pause once the current submission finishes.');
    } else {
      this.logger.warn('Pause requested - will pause once the current submission finishes.');
    }
  }

  resume() {
    if (!PAUSED_STATUSES.includes(this.state.status)) {
      throw new Error('Job is not paused.');
    }
    this.start();
  }

  cancel() {
    if (ACTIVE_STATUSES.includes(this.state.status)) {
      this.pauseRequested = true;
    }
    this.state.status = 'cancelled';
    this.persist();
    this.logger.warn('Job cancelled. Upload a new list to start a fresh batch.');
  }

  async runLoop() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      while (this.state.currentIndex < this.state.emails.length) {
        if (this.pauseRequested) {
          if (this.state.status !== 'cancelled') {
            this.state.status = this.pendingPauseStatus || 'paused-manual';
          }
          this.pauseRequested = false;
          this.pendingPauseStatus = null;
          this.persist();
          return;
        }

        const entry = this.state.emails[this.state.currentIndex];
        const position = `${this.state.currentIndex + 1}/${this.state.emails.length}`;
        this.logger.info(`Processing ${entry.email} (${position})`);

        try {
          const result = await submitVote(entry.email, this.state.settings, this.logger);
          entry.status = result.success ? 'approved' : 'failed';
          entry.message = result.message;
          entry.timestamp = Date.now();
          this.logger[result.success ? 'success' : 'error'](
            `${entry.email}: ${result.success ? 'APPROVED' : 'FAILED'} - ${result.message}`,
          );
        } catch (err) {
          entry.status = 'failed';
          entry.message = err.message;
          entry.timestamp = Date.now();
          this.logger.error(`${entry.email}: ERROR - ${err.message}`);
        }

        this.state.currentIndex += 1;
        this.persist();

        if (this.state.currentIndex < this.state.emails.length && !this.pauseRequested) {
          await delay(this.state.settings.delayMs);
        }
      }

      if (this.state.status === 'running' && this.state.currentIndex >= this.state.emails.length) {
        this.state.status = 'completed';
        this.persist();
        this.logger.success('Job completed. All emails processed.');
      }
    } finally {
      this.workerRunning = false;
    }
  }
}

module.exports = JobManager;
