/**
 * parser.js — Parse pesan Telegram menjadi data transaksi
 *
 * Format Pemasukan:
 *   "ayam 35000"     → income, item: Ayam, amount: 35000
 *   "gaji 5jt"       → income, item: Gaji, amount: 5000000
 *   "transfer 150k"  → income, item: Transfer, amount: 150000
 *
 * Format Pengeluaran:
 *   "keluar bensin 50000"  → expense, item: Bensin, amount: 50000
 *   "out makan 25k"        → expense, item: Makan, amount: 25000
 *   "- bensin 50000"       → expense, item: Bensin, amount: 50000
 */

/**
 * Konversi string angka ke number
 * Support: 35000 | 35.000 | 35k | 35rb | 35ribu | 5jt | 5juta
 */
function parseAmount(amountStr) {
  let str = amountStr.replace(/\./g, '').toLowerCase().trim();

  if (str.endsWith('juta')) return parseFloat(str.replace('juta', '')) * 1_000_000;
  if (str.endsWith('jt'))   return parseFloat(str.replace('jt', '')) * 1_000_000;
  if (str.endsWith('ribu')) return parseFloat(str.replace('ribu', '')) * 1_000;
  if (str.endsWith('rb'))   return parseFloat(str.replace('rb', '')) * 1_000;
  if (str.endsWith('k'))    return parseFloat(str.replace('k', '')) * 1_000;

  return parseFloat(str);
}

/**
 * Kapitalisasi huruf pertama
 */
function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Format angka ke Rupiah
 */
function formatCurrency(amount) {
  return 'Rp ' + Math.abs(amount).toLocaleString('id-ID');
}

/**
 * Main parser — kembalikan object hasil parse atau null jika tidak valid
 */
function parseMessage(text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // ── Commands ────────────────────────────────────────────────────────────
  if (lower === 'rekap' || lower === 'rekap bulan')     return { type: 'command', command: 'rekap', period: 'bulan' };
  if (lower === 'rekap hari' || lower === 'rekap hari ini') return { type: 'command', command: 'rekap', period: 'hari' };
  if (lower === 'rekap minggu')                          return { type: 'command', command: 'rekap', period: 'minggu' };
  if (lower === 'saldo')                                 return { type: 'command', command: 'saldo' };
  if (lower === 'daftar' || lower === 'list')            return { type: 'command', command: 'daftar' };
  if (lower === 'hapus' || lower === 'undo')             return { type: 'command', command: 'hapus' };
  if (lower === 'help' || lower === 'bantuan' || lower === '?') return { type: 'command', command: 'help' };

  // ── Pengeluaran: "keluar/out/- item amount" ──────────────────────────────
  const expensePatterns = [
    // "keluar bensin 50000" | "out makan 25k" | "pengeluaran listrik 200rb"
    /^(?:keluar|out|pengeluaran)\s+(.+?)\s+([\d.]+(?:k|rb|ribu|jt|juta)?)$/i,
    // "- bensin 50000"
    /^-\s*(.+?)\s+([\d.]+(?:k|rb|ribu|jt|juta)?)$/i,
  ];

  for (const pattern of expensePatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const item   = capitalizeFirst(match[1].trim());
      const amount = parseAmount(match[2]);
      if (!isNaN(amount) && amount > 0) {
        return { type: 'expense', item, amount };
      }
    }
  }

  // ── Pemasukan: "item amount" ─────────────────────────────────────────────
  const incomeMatch = trimmed.match(/^(.+?)\s+([\d.]+(?:k|rb|ribu|jt|juta)?)$/i);
  if (incomeMatch) {
    const item   = capitalizeFirst(incomeMatch[1].trim());
    const amount = parseAmount(incomeMatch[2]);

    // Jangan proses kalau item-nya adalah expense keyword
    const expenseKeywords = ['keluar', 'out', 'pengeluaran'];
    const isExpenseKeyword = expenseKeywords.some(kw =>
      incomeMatch[1].toLowerCase().startsWith(kw)
    );

    if (!isExpenseKeyword && !isNaN(amount) && amount > 0) {
      return { type: 'income', item, amount };
    }
  }

  return null; // tidak dikenali
}

module.exports = { parseMessage, formatCurrency, parseAmount };
