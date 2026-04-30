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
  return ctx.reply(reply ?? 'Halo!', { parse_mode: 'Markdown' });
});

bot.help(async ctx => {
  const reply = await processMessage(getUserId(ctx), 'help');
  return ctx.reply(reply ?? 'Halo!', { parse_mode: 'Markdown' });
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
      await ctx.reply(reply, { parse_mode: 'Markdown' });
      console.log(`✉️  Reply terkirim ke ${userId}`);
    } else {
      console.log(`[DEBUG] Pesan tidak dikenali — bot diam`);
    }
  } catch (err) {
    console.error(`❗ Error untuk ${userId}:`, err.message);
    try {
      await ctx.reply('❗ Terjadi error:\n' + err.message);
    } catch (sendErr) {
      console.error('❗ Gagal kirim pesan error:', sendErr.message);
    }
  }
});

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

bot.launch()
  .then(() => {
    console.log('✅ Bot Telegram berhasil terhubung!');
    console.log('💡 Buka chat dengan bot kamu di Telegram dan kirim "/start" atau "help" untuk memulai.\n');
  })
  .catch(err => {
    console.error('❌ Fatal error saat launch:', err);
    process.exit(1);
  });
