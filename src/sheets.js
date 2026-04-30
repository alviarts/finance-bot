/**
 * sheets.js — Google Sheets API integration
 *
 * Setiap pengguna Telegram mendapat sheet tab tersendiri (per Telegram user ID).
 * Sheet tab dibuat otomatis saat pengguna pertama kali mengirim pesan.
 *
 * Struktur kolom:
 *   A: Tanggal  | B: Waktu | C: Tipe | D: Item | E: Jumlah | F: Catatan
 */

const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

const SPREADSHEET_ID   = process.env.SPREADSHEET_ID;
const CREDENTIALS_PATH = path.join(__dirname, '../credentials.json');

const HEADERS = ['Tanggal', 'Waktu', 'Tipe', 'Item', 'Jumlah', 'Catatan'];

// Warna header: hijau tua
const HEADER_COLOR = { red: 0.18, green: 0.49, blue: 0.28 };

// In-memory cache sheet names agar tidak API call berulang
const sheetCache = new Set();

// Singleton untuk auth & sheets client
let _auth    = null;
let _sheetsClient = null;

async function getAuth() {
  if (!_auth) {
    _auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return _auth;
}

async function getSheetsClient() {
  if (!_sheetsClient) {
    const authClient = await getAuth();
    _sheetsClient = google.sheets({ version: 'v4', auth: authClient });
  }
  return _sheetsClient;
}

/**
 * Ambil semua nama sheet dari spreadsheet
 */
async function getAllSheetNames() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return res.data.sheets.map(s => s.properties.title);
}

/**
 * Pastikan sheet untuk nomor ini ada.
 * Jika belum, buat sheet baru dengan header & formatting.
 */
async function ensureSheet(userId) {
  const sheetName = userId;

  // Sudah di cache? Langsung return
  if (sheetCache.has(sheetName)) return sheetName;

  const sheets = await getSheetsClient();
  const existingSheets = await getAllSheetNames();

  if (!existingSheets.includes(sheetName)) {
    // 1. Tambah sheet baru
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });

    // 2. Tulis header
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:F1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });

    // 3. Format header (bold, warna hijau, teks putih)
    const refreshed  = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const newSheet   = refreshed.data.sheets.find(s => s.properties.title === sheetName);
    const sheetId    = newSheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: HEADER_COLOR,
                  horizontalAlignment: 'CENTER',
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
            },
          },
          // Auto-resize kolom
          {
            autoResizeDimensions: {
              dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 6 },
            },
          },
        ],
      },
    });

    console.log(`📋 Sheet baru dibuat: ${sheetName}`);
  }

  sheetCache.add(sheetName);
  return sheetName;
}

/**
 * Tambah baris transaksi baru ke sheet nomor yang bersangkutan
 */
async function appendTransaction(userId, { type, item, amount, note = '' }) {
  const sheetName = await ensureSheet(userId);
  const sheets    = await getSheetsClient();

  const now    = new Date();
  const date   = now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time   = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const tipe   = type === 'income' ? 'Pemasukan' : 'Pengeluaran';
  const jumlah = type === 'income' ? amount : -amount; // pengeluaran disimpan negatif

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A:F`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[date, time, tipe, item, jumlah, note]] },
  });

  console.log(`✏️  [${userId}] ${tipe}: ${item} ${jumlah}`);
}

/**
 * Ambil semua transaksi, opsional filter N hari terakhir
 * Return: array of rows [date, time, tipe, item, amount, note]
 */
async function getTransactions(userId, { days = null } = {}) {
  const sheetName = await ensureSheet(userId);
  const sheets    = await getSheetsClient();

  const res  = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A:F`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return []; // hanya header atau kosong

  const dataRows = rows.slice(1); // skip header
  if (!days) return dataRows;

  // Filter berdasarkan rentang hari
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  cutoff.setHours(0, 0, 0, 0);

  return dataRows.filter(row => {
    if (!row[0]) return false;
    const [d, m, y] = row[0].split('/');
    if (!d || !m || !y) return false;
    const rowDate = new Date(y, m - 1, d);
    return rowDate >= cutoff;
  });
}

/**
 * Hapus transaksi terakhir (undo)
 * Return: baris yang dihapus, atau null jika tidak ada data
 */
async function deleteLastTransaction(userId) {
  const sheetName = await ensureSheet(userId);
  const sheets    = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A:F`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return null;

  const lastRow      = rows[rows.length - 1];
  const lastRowIndex = rows.length; // 1-based

  // Dapatkan sheetId
  const info    = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet   = info.data.sheets.find(s => s.properties.title === sheetName);
  const sheetId = sheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: lastRowIndex - 1, // 0-based
            endIndex: lastRowIndex,
          },
        },
      }],
    },
  });

  console.log(`🗑️  [${userId}] Hapus baris: ${lastRow}`);
  return lastRow;
}

module.exports = { ensureSheet, appendTransaction, getTransactions, deleteLastTransaction };
