/**
 * bot.js — Entry point Telegram Finance Bot
 *
 * Cara jalankan:
 *   node src/bot.js          (normal)
 *   node --watch src/bot.js  (auto-restart saat file berubah)
 *
 * Bot menggunakan long-polling, jadi tidak perlu setup webhook/HTTPS.
 * Pertama kali: dapatkan TELEGRAM_BOT_TOKEN dari @BotFather di Telegram,
 * lalu masukkan ke file .env.
 */

const { Telegraf } = require('telegraf');
require('dotenv').config();

const { processMessage } = require('./commands');

// ── Validasi env ─────────────────────────────────────────────────────────────
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ ERROR: TELEGRAM_BOT_TOKEN tidak ditemukan di file .env');
  console.error('   Salin .env.example ke .env dan isi TELEGRAM_BOT_TOKEN dari @BotFather.');
  process.exit(1);
}

if (!process.env.SPREADSHEET_ID) {
  console.error('❌ ERROR: SPREADSHEET_ID tidak ditemukan di file .env');
  console.error('   Salin .env.example ke .env dan isi SPREADSHEET_ID kamu.');
  process.exit(1);
}

// ── Bot setup ────────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
  handlerTimeout: 60_000, // beri waktu untuk Google Sheets API call
});

// /start dan /help → tampilkan panduan
bot.start(async ctx => {
  const reply = await processMessage(getUserId(ctx), 'help');
  return safeReply(ctx, reply ?? 'Halo!');
});

bot.help(async ctx => {
  const reply = await processMessage(getUserId(ctx), 'help');
  return safeReply(ctx, reply ?? 'Halo!');
});

// Handler utama: semua pesan teks (selain command yang ditangani di atas)
bot.on('text', async ctx => {
  const userId = getUserId(ctx);
  const text   = (ctx.message?.text || '').trim();

  if (!text) return;

  console.log(`📨 [${userId}] "${text}"`);

  try {
    const reply = await processMessage(userId, text);

    if (reply) {
      await safeReply(ctx, reply);
      console.log(`✉️  Reply terkirim ke ${userId}`);
    } else {
      console.log(`[DEBUG] Pesan tidak dikenali — bot diam`);
    }
  } catch (err) {
    console.error(`❗ Error untuk ${userId}:`, err.message);
    const friendly = friendlyErrorMessage(err);
    try {
      // Pesan error selalu plain-text — hindari masalah parsing Markdown.
      await ctx.reply(friendly);
    } catch (sendErr) {
      console.error('❗ Gagal kirim pesan error:', sendErr.message);
    }
  }
});

/**
 * Kirim balasan dengan parse_mode Markdown. Kalau Telegram menolak
 * karena Markdown error (misal karakter tak ter-escape lolos),
 * fallback ke plain-text supaya user tetap dapat balasan.
 */
async function safeReply(ctx, text) {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (err) {
    if (/can't parse entities|parse|Bad Request/i.test(err.message || '')) {
      console.warn(`[markdown-fallback] ${err.message} — retry plain-text`);
      await ctx.reply(text);
      return;
    }
    throw err;
  }
}

/**
 * Terjemahkan error teknis dari Sheets/Telegram menjadi pesan
 * yang lebih ramah untuk user.
 */
function friendlyErrorMessage(err) {
  const msg = err?.message || String(err);

  // Google Sheets — permission denied (sheet belum di-share ke service account).
  if (/permission|caller does not have permission|PERMISSION_DENIED/i.test(msg)) {
    return (
      '🔒 Sheet belum bisa diakses oleh bot.\n' +
      'Pastikan kamu sudah klik Share di Google Sheet dan menambahkan email service account ' +
      '(ada di credentials.json field client_email) sebagai Editor.'
    );
  }

  // Spreadsheet ID salah / tidak ditemukan.
  if (/Requested entity was not found|spreadsheet.*not found|404/i.test(msg)) {
    return (
      '🔍 Spreadsheet tidak ketemu.\n' +
      'Cek lagi nilai SPREADSHEET_ID di file .env — pastikan sama persis dengan yang ada di URL Google Sheets.'
    );
  }

  // Token Telegram invalid / di-revoke.
  if (/401|Unauthorized/i.test(msg)) {
    return (
      '🔑 Token bot Telegram ditolak.\n' +
      'Token mungkin sudah di-revoke. Buat ulang via @BotFather → /token → pilih bot → revoke → copy token baru ke .env.'
    );
  }

  // Quota Sheets terlampaui.
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return (
      '⏳ Kuota Google Sheets sementara penuh.\n' +
      'Coba kirim ulang sebentar lagi (biasanya quota reset per menit).'
    );
  }

  // Network / timeout.
  if (/ETIMEDOUT|ENOTFOUND|ECONNRESET|network|getaddrinfo/i.test(msg)) {
    return (
      '🌐 Ada masalah koneksi internet ke Google.\n' +
      'Coba kirim ulang dalam beberapa detik.'
    );
  }

  // Default fallback — masih kasih konteks tanpa stacktrace mentah.
  return `❗ Terjadi error: ${msg.slice(0, 200)}`;
}

/**
 * Ambil identifier unik per pengguna untuk dijadikan nama sheet tab.
 * Memakai numeric Telegram user ID — stabil dan tidak berubah meski
 * username Telegram diganti.
 */
function getUserId(ctx) {
  const id = ctx.from?.id;
  return id ? String(id) : 'unknown';
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('╔════════════════════════════════╗');
console.log('║   🤖  Telegram Finance Bot     ║');
console.log('╚════════════════════════════════╝\n');

(async () => {
  try {
    const me = await bot.telegram.getMe();
    console.log(`✅ Bot Telegram berhasil terhubung sebagai @${me.username} (id ${me.id})`);
    console.log('💡 Buka chat dengan bot kamu di Telegram dan kirim "/start" atau "help" untuk memulai.\n');

    // bot.launch() resolves only after bot.stop() in Telegraf v4 — don't await.
    bot.launch().catch(err => {
      console.error('❌ Polling error:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('❌ Fatal error saat connect:', err.message);
    process.exit(1);
  }
})();
