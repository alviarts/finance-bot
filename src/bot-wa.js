/**
 * bot-wa.js — Entry point WhatsApp Finance Bot (Baileys)
 *
 * Cara jalankan:
 *   node src/bot-wa.js          (normal)
 *   node --watch src/bot-wa.js  (auto-restart saat file berubah)
 *
 * Pertama kali: scan QR code yang muncul di terminal menggunakan WhatsApp.
 * Setelah scan, sesi disimpan di folder auth_info/ (tidak perlu scan ulang).
 *
 * Bot ini SHARE logika dengan src/bot-tg.js — sama-sama panggil processMessage()
 * dari src/commands.js, jadi semua fitur (parser, kategori, saldo, hapus semua,
 * multi-line, dll) otomatis tersedia di Telegram dan WhatsApp.
 *
 * userId di-prefix `wa-` (contoh: `wa-6281234567`) supaya tidak bentrok dengan
 * sheet user Telegram (yang pakai numeric Telegram user id tanpa prefix).
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode   = require('qrcode-terminal');
const pino     = require('pino');
require('dotenv').config();

const { processMessage } = require('./commands');

// ── LID Map: mapping @lid → @s.whatsapp.net ──────────────────────────────────
// Diisi dari event contacts.upsert / contacts.update / messaging-history.set.
const lidMap = new Map();

function updateLidMap(contacts) {
  for (const contact of contacts) {
    if (contact.id && contact.lid) {
      lidMap.set(contact.lid, contact.id);
    }
  }
}

function resolveLidJid(jid) {
  if (!jid || !jid.endsWith('@lid')) return jid;

  const resolved = lidMap.get(jid);
  if (resolved) return resolved;

  // Fallback: konversi numeric ID @lid → @s.whatsapp.net
  const numericId = jid.replace('@lid', '');
  return `${numericId}@s.whatsapp.net`;
}

// ── Validasi env ─────────────────────────────────────────────────────────────
if (!process.env.SPREADSHEET_ID) {
  console.error('❌ ERROR: SPREADSHEET_ID tidak ditemukan di file .env');
  console.error('   Salin .env.example ke .env dan isi SPREADSHEET_ID kamu.');
  process.exit(1);
}

// ── Koneksi WhatsApp ─────────────────────────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth:                state,
    printQRInTerminal:   false,
    logger:              pino({ level: 'silent' }),
    markOnlineOnConnect: false,
  });

  sock.ev.on('contacts.upsert', updateLidMap);
  sock.ev.on('contacts.update', updateLidMap);
  sock.ev.on('messaging-history.set', ({ contacts = [] }) => updateLidMap(contacts));

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan QR code berikut dengan WhatsApp kamu:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n⏳ Menunggu scan...\n');
    }

    if (connection === 'open') {
      console.log('✅ Bot WhatsApp berhasil terhubung!');
      console.log('💡 Kirim pesan "help" ke nomor kamu sendiri untuk memulai.\n');
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut  = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log('🚫 Sesi WhatsApp berakhir (logged out).');
        console.log('   Hapus folder auth_info/ lalu restart bot supaya bisa scan QR ulang.');
      } else {
        console.log(`🔄 Koneksi WhatsApp terputus (${statusCode}). Mencoba reconnect...`);
        connectToWhatsApp();
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Anti-flag mitigations ───────────────────────────────────────────────
  // Tujuan: bikin reply pattern lebih mirip manusia supaya nomor ini tidak
  // dianggap automated (bot WA gampang kena tinjauan / banned).
  //
  // 1) Mark read pesan masuk dulu (manusia baca pesan sebelum balas).
  // 2) Kirim presence "composing" → user lihat indikator "typing..." di chat.
  // 3) Random delay 1-3 detik (mimic kecepatan ngetik manusia).
  // 4) Rate limit: minimal 1 detik antar reply per user; spam diserialisasi.
  // 5) Hindari online 24/7 — set markOnlineOnConnect=false (sudah di atas).

  const sleep         = ms => new Promise(r => setTimeout(r, ms));
  const randInt       = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const lastReplyAt   = new Map();        // jid → timestamp ms
  const userQueue     = new Map();        // jid → Promise (serialize per user)
  const MIN_GAP_MS    = 1000;             // minimum gap antar reply per user
  const TYPING_MIN_MS = 1000;             // delay min sebelum kirim
  const TYPING_MAX_MS = 3000;             // delay max sebelum kirim

  /**
   * Antri eksekusi handler per user supaya gak ada race-condition kalau
   * user spam ngirim banyak pesan sekaligus.
   */
  function enqueue(jid, fn) {
    const prev = userQueue.get(jid) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    userQueue.set(jid, next);
    return next;
  }

  async function humanDelay(jid) {
    // Pastikan minimal 1 detik sejak reply terakhir ke user yang sama.
    const last = lastReplyAt.get(jid) || 0;
    const sinceLast = Date.now() - last;
    if (sinceLast < MIN_GAP_MS) {
      await sleep(MIN_GAP_MS - sinceLast);
    }
    // Tambah random "typing" delay.
    const typingMs = randInt(TYPING_MIN_MS, TYPING_MAX_MS);
    try { await sock.sendPresenceUpdate('composing', jid); } catch (_) {}
    await sleep(typingMs);
    try { await sock.sendPresenceUpdate('paused', jid); } catch (_) {}
    lastReplyAt.set(jid, Date.now());
  }

  // ── Pesan masuk ──────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message)        continue;
      if (msg.key.fromMe)      continue;             // skip pesan dari bot sendiri
      const jid = msg.key.remoteJid;
      if (!jid)                continue;
      if (jid === 'status@broadcast') continue;
      if (jid.endsWith('@g.us'))      continue;     // skip grup

      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.ephemeralMessage?.message?.conversation ||
        msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        msg.message?.viewOnceMessage?.message?.conversation ||
        ''
      ).trim();

      if (!text) continue;

      const resolvedJid = resolveLidJid(jid);
      const phoneNumber = resolvedJid
        .replace('@s.whatsapp.net', '')
        .replace('@g.us', '')
        .replace('@lid', '');

      // Prefix `wa-` supaya tidak bentrok dengan sheet user Telegram.
      const userId = `wa-${phoneNumber}`;

      console.log(`📨 [${userId}] "${text}"`);

      // Antri per user supaya kalau user kirim 5 pesan beruntun, bot reply
      // satu-satu dengan delay manusiawi, bukan barrage instan.
      enqueue(resolvedJid, async () => {
        // Mark read (manusia baca dulu).
        try { await sock.readMessages([msg.key]); } catch (_) {}

        // Multi-line: tiap baris diproses sebagai transaksi/perintah terpisah,
        // balasannya digabung jadi satu pesan dengan separator. Sama persis
        // dengan perilaku Telegram (bot-tg.js).
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

        try {
          let reply;
          if (lines.length <= 1) {
            reply = await processMessage(userId, lines[0] || text);
          } else {
            const replies = [];
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              try {
                const r = await processMessage(userId, line);
                replies.push({ line, reply: r });
              } catch (err) {
                console.error(`❗ Error baris "${line}":`, err.message);
                replies.push({ line, reply: friendlyErrorMessage(err) });
              }
            }
            reply = replies
              .map((r, i) => `*Baris ${i + 1}* — \`${r.line.replace(/`/g, "'")}\`\n${r.reply}`)
              .join('\n\n━━━━━━━━━━\n\n');
          }

          if (reply) {
            // Tampilkan typing + random delay manusiawi.
            await humanDelay(resolvedJid);
            // quoted: msg — wajib untuk @lid JIDs supaya WA tahu route ke device yang benar
            await sock.sendMessage(resolvedJid, { text: reply }, { quoted: msg });
            console.log(`✉️  Reply terkirim ke ${userId}`);
          }
        } catch (err) {
          console.error(`❗ Error untuk ${userId}:`, err.message);
          try {
            await humanDelay(resolvedJid);
            await sock.sendMessage(
              resolvedJid,
              { text: friendlyErrorMessage(err) },
              { quoted: msg }
            );
          } catch (sendErr) {
            console.error('❗ Gagal kirim pesan error:', sendErr.message);
          }
        }
      });
    }
  });
}

/**
 * Terjemahkan error teknis dari Sheets/WA jadi pesan ramah user.
 * (Mirror dari logic di bot-tg.js supaya pengalaman user konsisten antar platform.)
 */
function friendlyErrorMessage(err) {
  const msg = err?.message || String(err);

  if (/PERMISSION_DENIED|The caller does not have permission/i.test(msg)) {
    return (
      '❗ Bot tidak punya akses ke Google Sheet.\n\n' +
      'Buka spreadsheet → Share → tambahkan email service account sebagai Editor.'
    );
  }
  if (/Unable to parse range|Range.*not found|Requested entity was not found/i.test(msg)) {
    return '❗ Sheet tidak ditemukan. Pastikan SPREADSHEET_ID di .env sudah benar.';
  }
  if (/quota|rate.?limit/i.test(msg)) {
    return '❗ Google Sheets sedang sibuk (quota). Coba lagi sebentar.';
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(msg)) {
    return '❗ Koneksi internet bermasalah. Coba lagi sebentar.';
  }

  return `❗ Maaf, ada error: ${msg}`;
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('╔════════════════════════════════╗');
console.log('║   🤖  WhatsApp Finance Bot     ║');
console.log('╚════════════════════════════════╝\n');

connectToWhatsApp().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
