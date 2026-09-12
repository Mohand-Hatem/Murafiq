// PM2 process config for a single manually-provisioned VPS (no Docker, no Redis, no Postgres —
// see docs/PHASE_16_DEPLOYMENT_READINESS.md). MongoDB stays a managed Atlas replica set.
//
// instances: 1 / exec_mode: 'fork' is NOT a performance default here — it is a strict correctness
// requirement pinning four load-bearing in-process dependencies (see Simplification Plan D.17):
//   1. The six crons' re-entrancy: in-process node-cron sweeps run without distributed locks; cluster
//      mode would trigger duplicate concurrent executions on every worker tick.
//   2. The tokenVersionCache 30s in-process revocation cache (auth.middleware.js): token invalidation
//      on one cluster worker would not invalidate tokens verified by peer workers within the cache TTL.
//   3. The session-reminder reminderSentAt guard: avoids duplicate reminder dispatch races across instances.
//   4. The moderation blocked-word in-memory cache (blocked-words.service.js): dictionary reloads
//      remain local to a single process.
// Do not change this to cluster mode without a Redis SET NX PX leader lock for crons (or migrating
// to BullMQ background workers) and migrating tokenVersionCache and moderation dictionaries to Redis.
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
