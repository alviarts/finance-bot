/**
 * ecosystem.config.js — PM2 process configuration untuk Finance Bot
 *
 * Cara pakai:
 *   pm2 start ecosystem.config.js                    (start semua app)
 *   pm2 start ecosystem.config.js --only finance-bot-tg  (Telegram saja)
 *   pm2 start ecosystem.config.js --only finance-bot-wa  (WhatsApp saja)
 *   pm2 restart ecosystem.config.js
 *   pm2 reload ecosystem.config.js                   (zero-downtime untuk cluster)
 *
 * Memory tuning:
 *   --max-old-space-size  : batas heap V8 (MB). Default Node.js ~1.5GB. Kita
 *                            limit kecil supaya bot ringan di VPS dengan RAM
 *                            <1GB. Kalau out-of-memory, naikkan ke 192/256.
 *   max_memory_restart    : kalau total RSS process lewat batas ini, PM2
 *                            otomatis restart — proteksi dari memory leak.
 *
 * Log rotation: pakai plugin `pm2-logrotate` (lihat scripts/deploy-vps.sh).
 */

module.exports = {
  apps: [
    {
      name:               'finance-bot-tg',
      script:             'src/bot-tg.js',
      cwd:                __dirname,

      // Memory limits — Telegraf + googleapis cukup ringan, 128MB heap aman.
      node_args:          '--max-old-space-size=128',
      max_memory_restart: '150M',

      // Restart behavior
      autorestart:        true,
      restart_delay:      3000,         // tunggu 3 detik sebelum restart
      max_restarts:       10,
      min_uptime:         '30s',

      // Logs
      out_file:           './logs/tg-out.log',
      error_file:         './logs/tg-err.log',
      merge_logs:         true,
      time:               true,         // prefix tiap baris log dengan timestamp

      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name:               'finance-bot-wa',
      script:             'src/bot-wa.js',
      cwd:                __dirname,

      // Baileys + qrcode + pino butuh sedikit lebih banyak RAM dari Telegraf.
      // Kalau VPS-mu sangat ketat memory, set ENABLE_WA=0 di deploy-vps.sh
      // dan jalanin Telegram aja.
      node_args:          '--max-old-space-size=160',
      max_memory_restart: '200M',

      autorestart:        true,
      restart_delay:      5000,         // WA rate-limit reconnect
      max_restarts:       10,
      min_uptime:         '30s',

      out_file:           './logs/wa-out.log',
      error_file:         './logs/wa-err.log',
      merge_logs:         true,
      time:               true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
