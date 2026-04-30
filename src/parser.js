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
 *
 * Backdated (opsional, di akhir pesan):
 *   "ayam 35000 kemarin"
 *   "ayam 35000 2 hari lalu"
 *   "ayam 35000 tgl 25/12"
 *   "ayam 35000 25/12/2025"
 */

/**
 * Konversi string angka ke number.
 * Support: 35000 | 35.000 | 35k | 35rb | 35ribu | 5jt | 5juta
 * Toleransi spasi: "5 jt", "35 ribu", "35 .000".
 */
function parseAmount(amountStr) {
  // Hilangkan semua whitespace + titik (separator ribuan), lower-case.
  let str = amountStr.replace(/\s+/g, '').replace(/\./g, '').toLowerCase().trim();

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
 * Coba ekstrak hint tanggal dari ekor pesan.
 * Return: { date: Date | null, rest: string } — `rest` adalah pesan tanpa hint tanggal.
 *
 * Yang dikenali (case-insensitive, harus di akhir pesan):
 *   - "kemarin"                        → -1 hari
 *   - "2 hari lalu" / "3 hari yg lalu" → -N hari
 *   - "tgl 25/12" / "tanggal 25/12"    → 25 Desember tahun ini
 *   - "25/12" / "25/12/2025"           → DD/MM atau DD/MM/YYYY
 */
function extractDateHint(text) {
  const trimmed = text.trim();
  const now = new Date();

  // "DD/MM" atau "DD/MM/YYYY" di akhir pesan, optional dengan prefix "tgl"/"tanggal"
  const dateRe = /(.*?)\s+(?:tgl\.?\s+|tanggal\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*$/i;
  const m = trimmed.match(dateRe);
  if (m) {
    const rest = m[1].trim();
    const day   = parseInt(m[2], 10);
    const month = parseInt(m[3], 10);
    let year    = m[4] ? parseInt(m[4], 10) : now.getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      // Pertahankan jam saat ini supaya kolom Waktu tetap ada nilai yang masuk akal.
      d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
      return { date: d, rest };
    }
  }

  // "kemarin" di akhir pesan
  const kemarinRe = /^(.*?)\s+kemarin\s*$/i;
  const km = trimmed.match(kemarinRe);
  if (km) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { date: d, rest: km[1].trim() };
  }

  // "N hari lalu" / "N hari yang lalu" / "N hari yg lalu"
  const lalauRe = /^(.*?)\s+(\d+)\s+hari\s+(?:yg\s+lalu|yang\s+lalu|lalu)\s*$/i;
  const ll = trimmed.match(lalauRe);
  if (ll) {
    const n = parseInt(ll[2], 10);
    if (n > 0 && n < 1000) {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return { date: d, rest: ll[1].trim() };
    }
  }

  return { date: null, rest: trimmed };
}

/**
 * Tebak kategori transaksi dari kata-kata di nama item.
 * Return string kategori, atau '' kalau tidak ada yang cocok.
 */
const CATEGORY_KEYWORDS = {
  Makanan:       ['ayam', 'makan', 'makanan', 'sarapan', 'lunch', 'dinner', 'jajan', 'snack', 'kopi', 'es teh', 'roti', 'mie', 'nasi', 'sate', 'bakso', 'soto', 'gado', 'pizza', 'burger', 'minum', 'minuman'],
  Transportasi:  ['bensin', 'pertamax', 'pertalite', 'solar', 'tol', 'parkir', 'gojek', 'grab', 'uber', 'taxi', 'taksi', 'ojek', 'bus', 'kereta', 'krl', 'mrt', 'lrt', 'tiket', 'angkot'],
  Tagihan:       ['listrik', 'pln', 'air', 'pdam', 'wifi', 'internet', 'pulsa', 'paket data', 'kuota', 'indihome', 'telkom', 'sewa', 'kost', 'kontrakan', 'cicilan', 'kredit'],
  Belanja:       ['baju', 'celana', 'sepatu', 'tas', 'shopee', 'tokped', 'tokopedia', 'lazada', 'olshop', 'belanja', 'mart', 'supermarket', 'indomaret', 'alfamart', 'minimarket'],
  Kesehatan:     ['obat', 'apotek', 'dokter', 'rumah sakit', 'rs', 'klinik', 'vitamin', 'masker'],
  Hiburan:       ['bioskop', 'film', 'netflix', 'spotify', 'youtube premium', 'game', 'steam', 'konser', 'karaoke', 'wisata', 'tiket pesawat'],
  Pendidikan:    ['buku', 'kuliah', 'spp', 'kursus', 'les', 'training', 'sekolah'],
  Pemasukan:     ['gaji', 'bonus', 'thr', 'transfer', 'cashback', 'refund', 'jualan', 'fee', 'honor', 'royalti', 'dividen'],
};

function guessCategory(item) {
  if (!item) return '';
  const low = item.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => low.includes(kw))) return category;
  }
  return '';
}

/**
 * Main parser — kembalikan object hasil parse atau null jika tidak valid
 */
function parseMessage(text) {
  // ── Commands (cek dulu sebelum ekstraksi tanggal) ────────────────────────
  const lower = text.trim().toLowerCase();
  if (lower === 'rekap' || lower === 'rekap bulan')         return { type: 'command', command: 'rekap', period: 'bulan' };
  if (lower === 'rekap hari' || lower === 'rekap hari ini') return { type: 'command', command: 'rekap', period: 'hari' };
  if (lower === 'rekap minggu')                              return { type: 'command', command: 'rekap', period: 'minggu' };
  if (lower === 'saldo')                                     return { type: 'command', command: 'saldo' };
  if (lower === 'daftar' || lower === 'list')                return { type: 'command', command: 'daftar' };
  if (lower === 'hapus' || lower === 'undo')                 return { type: 'command', command: 'hapus' };
  if (lower === 'help' || lower === 'bantuan' || lower === '?') return { type: 'command', command: 'help' };

  // Ekstrak hint tanggal di akhir pesan (untuk backdated entry).
  const { date, rest: trimmed } = extractDateHint(text);

  // ── Pengeluaran: "<prefix> item amount" ─────────────────────────────────
  // Prefix: keluar / out / pengeluaran / bayar / byr / beli / bli / belanja /
  // blnj. Atau "- item amount" (mis. "- listrik 200rb").
  const expensePatterns = [
    /^(?:keluar|out|pengeluaran|bayar|byr|beli|bli|belanja|blnj)\s+(.+?)\s+([\d.]+\s*(?:k|rb|ribu|jt|juta)?)$/i,
    /^-\s*(.+?)\s+([\d.]+\s*(?:k|rb|ribu|jt|juta)?)$/i,
  ];

  for (const pattern of expensePatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const item   = capitalizeFirst(match[1].trim());
      const amount = parseAmount(match[2]);
      if (!isNaN(amount) && amount > 0) {
        return { type: 'expense', item, amount, category: guessCategory(item), date };
      }
    }
  }

  // ── Pemasukan: prefix eksplisit ──────────────────────────────────────────
  // a) "dapat/terima/masuk <item> <amount>" — prefix + item + jumlah
  const incomeWithItem = trimmed.match(
    /^(?:dapat|dpt|terima|trm|masuk|in|income|pemasukan)\s+(.+?)\s+([\d.]+\s*(?:k|rb|ribu|jt|juta)?)$/i
  );
  if (incomeWithItem) {
    const item   = capitalizeFirst(incomeWithItem[1].trim());
    const amount = parseAmount(incomeWithItem[2]);
    if (!isNaN(amount) && amount > 0) {
      return { type: 'income', item, amount, category: guessCategory(item), date };
    }
  }

  // b) Transfer pendek: "tf 200k", "transfer 150k", "ditf 50k", "di tf 200k",
  //    "di transfer 200k" — tidak ada item, default-nya "Transfer".
  const incomeTransfer = trimmed.match(
    /^(?:tf|transfer|ditf|di\s+tf|di\s+transfer)\s+([\d.]+\s*(?:k|rb|ribu|jt|juta)?)$/i
  );
  if (incomeTransfer) {
    const amount = parseAmount(incomeTransfer[1]);
    if (!isNaN(amount) && amount > 0) {
      return { type: 'income', item: 'Transfer', amount, category: 'Pemasukan', date };
    }
  }

  // ── Pemasukan: "item amount" (fallback default untuk teks bebas) ─────────
  const incomeMatch = trimmed.match(/^(.+?)\s+([\d.]+\s*(?:k|rb|ribu|jt|juta)?)$/i);
  if (incomeMatch) {
    const item   = capitalizeFirst(incomeMatch[1].trim());
    const amount = parseAmount(incomeMatch[2]);

    // Hindari double-classify: kalau item dimulai dengan prefix expense
    // diikuti spasi, jangan dianggap income (sudah dicover di expensePatterns).
    // Pakai " " setelah kata supaya "bayaran 5jt" / "belian 100k" tetap income.
    const expenseKeywords = ['keluar', 'out', 'pengeluaran', 'bayar', 'byr', 'beli', 'bli', 'belanja', 'blnj'];
    const isExpenseKeyword = expenseKeywords.some(kw =>
      incomeMatch[1].toLowerCase().startsWith(kw + ' ')
    );

    // Prefix income eksplisit sudah ditangani di blok atas; jangan dobel-cocokkan
    // di sini supaya item tidak ke-prepend "dapat", "terima", dll.
    const incomeKeywords = ['dapat', 'dpt', 'terima', 'trm', 'masuk', 'in', 'income', 'pemasukan',
                            'tf', 'transfer', 'ditf'];
    const isIncomeKeyword = incomeKeywords.some(kw =>
      incomeMatch[1].toLowerCase().startsWith(kw + ' ') ||
      incomeMatch[1].toLowerCase() === kw
    );
    if (isIncomeKeyword) return null;

    if (!isExpenseKeyword && !isNaN(amount) && amount > 0) {
      return { type: 'income', item, amount, category: guessCategory(item), date };
    }
  }

  return null;
}

module.exports = { parseMessage, formatCurrency, parseAmount, guessCategory, extractDateHint };
