/**
 * commands.js — Proses pesan dan kembalikan reply teks (platform-agnostic)
 */

const { parseMessage, formatCurrency } = require('./parser');
const {
  appendTransaction,
  getTransactions,
  deleteLastTransaction,
  deleteAllTransactions,
} = require('./sheets');

// In-memory tracking konfirmasi `hapus semua` per user. TTL 60 detik.
// Map<userId, timestamp>
const pendingHapusSemua = new Map();
const HAPUS_SEMUA_TTL_MS = 60_000;

/**
 * Escape karakter khusus Telegram Markdown (v1) supaya teks user-derived
 * (misal nama item `beli_ayam`) tidak bikin Telegram reject reply dengan
 * 400 Bad Request.
 */
function escapeMd(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/([_*`\[\]])/g, '\\$1');
}

/**
 * Entry point — terima identifier pengirim + teks pesan, kembalikan reply string.
 * Untuk pesan yang tidak cocok dengan format apapun, kembalikan hint singkat
 * yang mengarahkan pengguna untuk mengetik `help`.
 */
async function processMessage(userId, text) {
  const parsed = parseMessage(text);
  if (!parsed) return getUnknownHint();

  if (parsed.type === 'income' || parsed.type === 'expense') {
    return handleTransaction(userId, parsed);
  }

  if (parsed.type === 'command') {
    return handleCommand(userId, parsed);
  }

  return getUnknownHint();
}

function getUnknownHint() {
  return (
    `🤔 Pesannya belum aku kenal.\n` +
    `Ketik *help* untuk melihat panduan lengkap.`
  );
}

// ── Transaksi ────────────────────────────────────────────────────────────────

async function handleTransaction(userId, { type, item, amount, category, date }) {
  await appendTransaction(userId, {
    type,
    item,
    amount,
    note: category || '',
    when: date || null,
  });

  const emoji = type === 'income' ? '✅' : '❌';
  const label = type === 'income' ? 'Pemasukan' : 'Pengeluaran';

  // Format tanggal yang ditampilkan di reply (kalau backdated, tampilkan tanggalnya).
  let waktuLine = '';
  if (date instanceof Date) {
    const d = date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
    waktuLine = `📅 Tanggal: ${escapeMd(d)}\n`;
  }

  const kategoriLine = category ? `🏷️ Kategori: ${escapeMd(category)}\n` : '';

  return (
    `${emoji} *${label} dicatat!*\n` +
    `📦 Item   : ${escapeMd(item)}\n` +
    `💵 Jumlah : ${formatCurrency(amount)}\n` +
    kategoriLine +
    waktuLine +
    `\n_Ketik saldo untuk melihat total, atau help untuk panduan._`
  );
}

// ── Command routing ──────────────────────────────────────────────────────────

async function handleCommand(userId, { command, period }) {
  switch (command) {
    case 'rekap':  return handleRekap(userId, period || 'bulan');
    case 'saldo':  return handleSaldo(userId);
    case 'daftar': return handleDaftar(userId);
    case 'hapus':           return handleHapus(userId);
    case 'hapus_semua':     return handleHapusSemuaRequest(userId);
    case 'ya_hapus_semua':  return handleHapusSemuaConfirm(userId);
    case 'help':            return getHelpText();
    default:       return null;
  }
}

// ── Rekap ────────────────────────────────────────────────────────────────────

async function handleRekap(userId, period) {
  const periodMap = {
    hari:   { days: 1,  label: 'Hari Ini' },
    minggu: { days: 7,  label: '7 Hari Terakhir' },
    bulan:  { days: 30, label: '30 Hari Terakhir' },
  };

  const { days, label } = periodMap[period] || periodMap.bulan;
  const rows = await getTransactions(userId, { days });

  if (rows.length === 0) {
    return `📊 *Rekap ${label}*\n\nBelum ada transaksi pada periode ini.`;
  }

  let totalIncome  = 0;
  let totalExpense = 0;

  rows.forEach(row => {
    const amount = parseFloat(row[4]) || 0;
    if (amount > 0) totalIncome  += amount;
    else            totalExpense += Math.abs(amount);
  });

  const saldo      = totalIncome - totalExpense;
  const saldoEmoji = saldo >= 0 ? '💰' : '⚠️';

  return (
    `📊 *Rekap ${label}*\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `✅ Pemasukan   : ${formatCurrency(totalIncome)}\n` +
    `❌ Pengeluaran : ${formatCurrency(totalExpense)}\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `${saldoEmoji} Saldo    : *${formatCurrency(saldo)}*\n` +
    `📝 Transaksi  : ${rows.length}x`
  );
}

// ── Saldo ────────────────────────────────────────────────────────────────────

async function handleSaldo(userId) {
  const rows = await getTransactions(userId);

  if (rows.length === 0) {
    return `💰 *Saldo*\n\nBelum ada transaksi sama sekali.`;
  }

  let totalIncome  = 0;
  let totalExpense = 0;

  rows.forEach(row => {
    const amount = parseFloat(row[4]) || 0;
    if (amount > 0) totalIncome  += amount;
    else            totalExpense += Math.abs(amount);
  });

  const saldo      = totalIncome - totalExpense;
  const saldoEmoji = saldo >= 0 ? '💰' : '⚠️';

  return (
    `${saldoEmoji} *Saldo Keseluruhan*\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `✅ Total Masuk  : ${formatCurrency(totalIncome)}\n` +
    `❌ Total Keluar : ${formatCurrency(totalExpense)}\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `💵 Saldo : *${formatCurrency(saldo)}*`
  );
}

// ── Daftar ───────────────────────────────────────────────────────────────────

async function handleDaftar(userId) {
  const rows = await getTransactions(userId);

  if (rows.length === 0) {
    return `📋 *Daftar Transaksi*\n\nBelum ada transaksi.`;
  }

  const last10 = rows.slice(-10).reverse();

  let msg = `📋 *10 Transaksi Terakhir*\n━━━━━━━━━━━━━━━━━\n`;

  last10.forEach(row => {
    const [date, time, , item, amount] = row;
    const amt   = parseFloat(amount) || 0;
    const emoji = amt > 0 ? '✅' : '❌';
    msg += `${emoji} ${escapeMd(item)} — *${formatCurrency(Math.abs(amt))}*\n   _${escapeMd(date)} ${escapeMd(time)}_\n`;
  });

  return msg;
}

// ── Hapus (undo) ─────────────────────────────────────────────────────────────

async function handleHapus(userId) {
  const deleted = await deleteLastTransaction(userId);

  if (!deleted) {
    return `🗑️ Tidak ada transaksi yang bisa dihapus.`;
  }

  const [date, time, , item, amount] = deleted;
  const amt = parseFloat(amount) || 0;

  return (
    `🗑️ *Transaksi dihapus!*\n` +
    `📦 Item   : ${escapeMd(item)}\n` +
    `💵 Jumlah : ${formatCurrency(Math.abs(amt))}\n` +
    `📅 Waktu  : ${escapeMd(date)} ${escapeMd(time)}`
  );
}

// ── Hapus Semua (dengan konfirmasi 2-langkah) ────────────────────────

function handleHapusSemuaRequest(userId) {
  pendingHapusSemua.set(userId, Date.now());
  return (
    `⚠️ *Konfirmasi Hapus Semua*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Ini akan menghapus *semua* transaksi kamu di sheet ini.\n` +
    `Aksi ini *tidak bisa di-undo*.\n\n` +
    `Untuk lanjut, balas:\n` +
    `   \`ya hapus semua\`\n\n` +
    `Konfirmasi berlaku selama *60 detik*. Setelah itu otomatis batal.`
  );
}

async function handleHapusSemuaConfirm(userId) {
  const ts = pendingHapusSemua.get(userId);
  pendingHapusSemua.delete(userId);

  if (!ts) {
    return (
      `🤔 Tidak ada permintaan hapus yang aktif.\n` +
      `Ketik \`hapus semua\` dulu untuk memulai konfirmasi.`
    );
  }

  if (Date.now() - ts > HAPUS_SEMUA_TTL_MS) {
    return (
      `⏱️ Konfirmasi sudah kedaluwarsa (lewat 60 detik).\n` +
      `Ketik \`hapus semua\` lagi kalau masih mau hapus.`
    );
  }

  const count = await deleteAllTransactions(userId);

  if (count === 0) {
    return `🧹 Tidak ada transaksi untuk dihapus. Sheet kamu memang sudah kosong.`;
  }

  return (
    `🧹 *Semua transaksi terhapus!*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Total dihapus: *${count} transaksi*.\n` +
    `Header sheet tetap. Kamu bisa langsung mulai catat transaksi baru.`
  );
}

// ── Help ─────────────────────────────────────────────────────────────────────

function getHelpText() {
  return (
    `🤖 *Finance Bot — Panduan*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*📥 Catat Pemasukan:*\n` +
    `  \`ayam 35000\`  /  \`gaji 5jt\`\n` +
    `  \`dapat uang 200k\`\n` +
    `  \`terima bonus 1jt\`\n` +
    `  \`tf 200k\`  /  \`transfer 150k\`\n` +
    `  \`di tf 200k\`  /  \`ditf 200k\`\n` +
    `  _Prefix lain: dpt, trm, masuk, in, income_\n\n` +
    `*📤 Catat Pengeluaran:*\n` +
    `  \`bayar listrik 200rb\`\n` +
    `  \`beli ayam 35k\`\n` +
    `  \`belanja sayur 50k\`\n` +
    `  \`kasih ojek 20k\`\n` +
    `  \`traktir teman 100k\`\n` +
    `  \`topup pulsa 50k\`\n` +
    `  \`isi bensin 50k\`  /  \`isi ulang gas 25k\`\n` +
    `  \`jajan kopi 25k\`\n` +
    `  \`keluar bensin 50000\`  /  \`- bensin 50000\`\n` +
    `  _Singkatan: byr, bli, blnj, ksh, trkt, tup, jjn_\n\n` +
    `*📅 Backdated (transaksi hari lain):*\n` +
    `  \`ayam 35000 kemarin\`\n` +
    `  \`gaji 5jt 2 hari lalu\`\n` +
    `  \`listrik 200rb tgl 25/12\`\n` +
    `  \`bensin 50000 25/12/2025\`\n\n` +
    `*📊 Laporan:*\n` +
    `  \`rekap\` — 30 hari terakhir\n` +
    `  \`rekap hari\` — hari ini\n` +
    `  \`rekap minggu\` — 7 hari terakhir\n` +
    `  \`saldo\` — total saldo semua waktu\n` +
    `  \`daftar\` — 10 transaksi terakhir\n\n` +
    `*🛠️ Lainnya:*\n` +
    `  \`hapus\` — hapus transaksi terakhir (undo)\n` +
    `  \`hapus semua\` — hapus *semua* transaksi (perlu konfirmasi)\n` +
    `  \`help\` — tampilkan panduan ini\n\n` +
    `*🏷️ Kategori auto-deteksi:* Makanan, Transportasi, Tagihan, Belanja, Kesehatan, Hiburan, Pendidikan, Pemasukan.`
  );
}

module.exports = { processMessage };
