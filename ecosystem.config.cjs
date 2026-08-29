// PM2 process config for a single manually-provisioned VPS (no Docker, no Redis, no Postgres —
// see docs/PHASE_16_DEPLOYMENT_READINESS.md). MongoDB stays a managed Atlas replica set.
//
// instances: 1 / exec_mode: 'fork' is NOT a performance default here — it's a correctness
// requirement. src/jobs/offer-expiry.cron.js registers an in-process node-cron job with no
// distributed lock; running this file in PM2 cluster mode would schedule that sweep once per
// worker process, hitting the database N times on every tick instead of once. Do not change this
// to cluster mode without first moving the cron job to a leader-election scheme or migrating it to
// the BullMQ-based worker planned for Phase 12.
module.exports = {
  apps: [
    {
      name: 'murafiq-api',
      script: 'src/server.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      // Same directory the app's own Winston logger already writes to (see logger.config.js).
      // PM2's transport captures anything written straight to stdout/stderr (e.g. an uncaught
      // exception before Winston initializes) that the app's own log files would otherwise miss.
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      time: true,
      // SIGINT/SIGTERM handling already exists in server.js (mongoose.connection.close(), a 10s
      // forced-exit timer) — give PM2 enough headroom to let that graceful shutdown finish before
      // it escalates to SIGKILL.
      kill_timeout: 12000,
    },
  ],
};
