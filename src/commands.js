/**
 * commands.js — Proses pesan dan kembalikan reply teks (platform-agnostic)
 */

const { parseMessage, formatCurrency } = require('./parser');
const { appendTransaction, getTransactions, deleteLastTransaction } = require('./sheets');

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
    case 'hapus':  return handleHapus(userId);
    case 'help':   return getHelpText();
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

// ── Help ─────────────────────────────────────────────────────────────────────

function getHelpText() {
  return (
    `🤖 *Finance Bot — Panduan*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*📥 Catat Pemasukan:*\n` +
    `  \`ayam 35000\`\n` +
    `  \`gaji 5jt\`  /  \`gaji 5 jt\`\n` +
    `  \`transfer 150k\`\n\n` +
    `*📤 Catat Pengeluaran:*\n` +
    `  \`keluar bensin 50000\`\n` +
    `  \`keluar makan 25k\`\n` +
    `  \`- listrik 200rb\`\n\n` +
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
    `  \`hapus\` — hapus transaksi terakhir\n` +
    `  \`help\` — tampilkan panduan ini\n\n` +
    `*🏷️ Kategori auto-deteksi:* Makanan, Transportasi, Tagihan, Belanja, Kesehatan, Hiburan, Pendidikan, Pemasukan.`
  );
}

module.exports = { processMessage };
