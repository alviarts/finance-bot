/**
 * bot.js — Entry point WhatsApp Finance Bot
 *
 * Cara jalankan:
 *   node src/bot.js          (normal)
 *   node --watch src/bot.js  (auto-restart saat file berubah)
 *
 * Pertama kali: scan QR code yang muncul di terminal menggunakan WhatsApp.
 * Setelah scan, sesi disimpan di folder auth_info/ (tidak perlu scan ulang).
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom }    = require('@hapi/boom');
const qrcode      = require('qrcode-terminal');
const pino        = require('pino');
require('dotenv').config();

const { processMessage } = require('./commands');

// ── LID Map: mapping @lid → @s.whatsapp.net ──────────────────────────────────
// makeInMemoryStore dihapus dari Baileys 6.x, jadi kita buat sendiri.
// Map ini diisi dari event contacts.upsert dan contacts.update.
const lidMap = new Map();

function updateLidMap(contacts) {
  for (const contact of contacts) {
    // contact.id = '628xxx@s.whatsapp.net', contact.lid = '123@lid'
    if (contact.id && contact.lid) {
      lidMap.set(contact.lid, contact.id);
    }
  }
}

/**
 * Resolve JID @lid ke @s.whatsapp.net menggunakan lidMap.
 * Jika tidak ditemukan di lidMap, coba konversi langsung ke @s.whatsapp.net.
 */
function resolveLidJid(jid) {
  if (!jid || !jid.endsWith('@lid')) return jid;

  // Coba dari lidMap dulu
  const resolved = lidMap.get(jid);
  if (resolved) {
    console.log(`[LID] Resolved ${jid} → ${resolved}`);
    return resolved;
  }

  // Fallback: konversi numeric ID @lid → @s.whatsapp.net
  const numericId = jid.replace('@lid', '');
  const fallback = `${numericId}@s.whatsapp.net`;
  console.log(`[LID] Tidak ada di lidMap, fallback ${jid} → ${fallback}`);
  return fallback;
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
    auth:               state,
    printQRInTerminal:  false,
    logger:             pino({ level: 'silent' }),
    markOnlineOnConnect: false,
  });

  // Populate lidMap dari daftar kontak saat koneksi awal
  sock.ev.on('contacts.upsert', updateLidMap);
  sock.ev.on('contacts.update', updateLidMap);
  // messaging-history.set juga membawa kontak (Baileys 6.x)
  sock.ev.on('messaging-history.set', ({ contacts = [] }) => updateLidMap(contacts));

  // ── Event: update koneksi ─────────────────────────────────────────────────
  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan QR code berikut dengan WhatsApp kamu:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n⏳ Menunggu scan...\n');
    }

    if (connection === 'open') {
      console.log('✅ Bot WhatsApp berhasil terhubung!\n');
      console.log('💡 Kirim pesan "help" ke nomor kamu sendiri untuk memulai.\n');
    }

    if (connection === 'close') {
      const statusCode  = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut   = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log('🚫 Sesi berakhir (logged out).');
        console.log('   Hapus folder auth_info/ lalu jalankan ulang bot.');
      } else {
        console.log(`🔄 Koneksi terputus (${statusCode}). Mencoba reconnect...`);
        connectToWhatsApp();
      }
    }
  });

  // ── Event: simpan credentials ─────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Event: pesan masuk ────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[DEBUG] messages.upsert type="${type}", jumlah=${messages.length}`);

    for (const msg of messages) {
      // Skip pesan tanpa konten
      if (!msg.message) continue;

      // Skip pesan yang dikirim BOT sendiri — cegah loop balasan
      if (msg.key.fromMe) continue;

      // Skip pesan dari broadcast / status WA
      const jid = msg.key.remoteJid;
      if (!jid) continue;
      if (jid === 'status@broadcast') continue;

      // Skip pesan dari grup
      if (jid.endsWith('@g.us')) continue;

      // Ekstrak teks — cakup berbagai tipe pesan Baileys
      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.ephemeralMessage?.message?.conversation ||
        msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        msg.message?.viewOnceMessage?.message?.conversation ||
        ''
      ).trim();

      console.log(`[DEBUG] jid=${jid} fromMe=${msg.key.fromMe} text="${text}"`);

      if (!text) continue;

      // Resolve @lid → @s.whatsapp.net jika ada di lidMap
      const resolvedJid = resolveLidJid(jid);
      const phoneNumber = resolvedJid
        .replace('@s.whatsapp.net', '')
        .replace('@g.us', '')
        .replace('@lid', '');

      console.log(`📨 [${phoneNumber}] jid=${resolvedJid} → "${text}"`);

      try {
        const reply = await processMessage(phoneNumber, text);

        if (reply) {
          // quoted: msg — wajib untuk @lid JIDs agar WhatsApp tahu route ke perangkat yang benar
          await sock.sendMessage(resolvedJid, { text: reply }, { quoted: msg });
          console.log(`✉️  Reply terkirim ke ${phoneNumber} (${resolvedJid})`);
        } else {
          console.log(`[DEBUG] Pesan tidak dikenali — bot diam`);
        }
      } catch (err) {
        console.error(`❗ Error untuk ${phoneNumber}:`, err.message);
        try {
          await sock.sendMessage(resolvedJid, {
            text: '❗ Terjadi error:\n' + err.message,
          }, { quoted: msg });
        } catch (sendErr) {
          console.error('❗ Gagal kirim pesan error:', sendErr.message);
        }
      }
    }
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('╔════════════════════════════════╗');
console.log('║   🤖  WhatsApp Finance Bot     ║');
console.log('╚════════════════════════════════╝\n');

connectToWhatsApp().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
