# 🤖 WhatsApp Finance Bot

Bot WhatsApp untuk mencatat keuangan pribadi secara otomatis ke Google Sheets.
Cukup kirim pesan seperti **`ayam 35000`** dan langsung tercatat!

---

## ✨ Fitur

| Pesan | Aksi |
|-------|------|
| `ayam 35000` | ✅ Catat **pemasukan** Rp 35.000 |
| `gaji 5jt` | ✅ Catat pemasukan Rp 5.000.000 |
| `keluar bensin 50000` | ❌ Catat **pengeluaran** Rp 50.000 |
| `keluar makan 25k` | ❌ Catat pengeluaran Rp 25.000 |
| `- listrik 200rb` | ❌ Catat pengeluaran Rp 200.000 |
| `rekap` | 📊 Laporan 30 hari terakhir |
| `rekap hari` | 📊 Laporan hari ini |
| `rekap minggu` | 📊 Laporan 7 hari terakhir |
| `saldo` | 💰 Total saldo keseluruhan |
| `daftar` | 📋 10 transaksi terakhir |
| `hapus` | 🗑️ Hapus transaksi terakhir (undo) |
| `help` | ❓ Panduan lengkap |

**Format angka yang didukung:** `35000` · `35.000` · `35k` · `35rb` · `35ribu` · `5jt` · `5juta`

**Setiap nomor WhatsApp baru** → otomatis dapat sheet tab tersendiri di Google Sheets.

---

## 🚀 Setup (Ikuti urutan ini!)

### Step 1 — Clone & install dependencies

```bash
cd finance-bot
npm install
```

---

### Step 2 — Setup Google Cloud (sekali saja)

#### 2a. Buat Google Cloud Project

1. Buka [https://console.cloud.google.com](https://console.cloud.google.com)
2. Klik **"Select a project"** → **"New Project"**
3. Beri nama (misal: `finance-bot`) → **Create**

#### 2b. Aktifkan Google Sheets API

1. Di sidebar kiri → **"APIs & Services"** → **"Library"**
2. Cari **"Google Sheets API"** → klik → **Enable**

#### 2c. Buat Service Account

1. Di sidebar → **"APIs & Services"** → **"Credentials"**
2. Klik **"+ Create Credentials"** → **"Service account"**
3. Isi nama (misal: `finance-bot-sa`) → **Create and continue**
4. Role: **"Editor"** → **Continue** → **Done**

#### 2d. Download credentials.json

1. Di halaman Credentials → klik service account yang baru dibuat
2. Tab **"Keys"** → **"Add Key"** → **"Create new key"**
3. Pilih **JSON** → **Create** → file otomatis terdownload
4. **Rename file tersebut menjadi `credentials.json`**
5. **Pindahkan ke folder `finance-bot/`** (sejajar dengan `package.json`)

> ⚠️ **JANGAN upload `credentials.json` ke GitHub!** File ini sudah masuk `.gitignore`.

---

### Step 3 — Setup Google Spreadsheet

1. Buka [Google Sheets](https://sheets.google.com) → buat spreadsheet baru
2. Beri nama terserah (misal: **"Finance Bot"**)
3. **Copy Spreadsheet ID** dari URL:
   ```
   https://docs.google.com/spreadsheets/d/[INI-SPREADSHEET-ID-NYA]/edit
   ```

4. **Share spreadsheet ke service account:**
   - Klik **"Share"** (pojok kanan atas)
   - Masukkan **email service account** (ada di `credentials.json`, field `client_email`)
     - Contoh: `finance-bot-sa@your-project.iam.gserviceaccount.com`
   - Role: **"Editor"** → **Send**

---

### Step 4 — Konfigurasi .env

1. Salin file contoh:
   ```bash
   copy .env.example .env
   ```
2. Buka `.env` dan isi Spreadsheet ID:
   ```
   SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
   ```

---

### Step 5 — Jalankan Bot

```bash
node src/bot.js
```

QR code akan muncul di terminal. Scan dengan WhatsApp:
- Buka WhatsApp → **Linked Devices** → **Link a Device** → scan QR

Setelah scan berhasil:
```
✅ Bot WhatsApp berhasil terhubung!
💡 Kirim pesan "help" ke nomor kamu sendiri untuk memulai.
```

> Sesi tersimpan di folder `auth_info/`. Kamu tidak perlu scan ulang kecuali logout.

---

## 🔄 Menjalankan Ulang Bot

```bash
# Normal
node src/bot.js

# Auto-restart saat file diubah (development)
node --watch src/bot.js
```

---

## 📁 Struktur Folder

```
finance-bot/
├── src/
│   ├── bot.js          ← Entry point (jalankan ini)
│   ├── parser.js       ← Parse pesan WhatsApp
│   ├── sheets.js       ← Google Sheets API
│   └── commands.js     ← Logic tiap command
├── auth_info/          ← Sesi WhatsApp (auto-generated)
├── credentials.json    ← Google service account key (kamu taruh di sini)
├── .env                ← Konfigurasi (SPREADSHEET_ID)
├── .env.example        ← Contoh .env
├── .gitignore
├── package.json
└── README.md
```

---

## ❓ Troubleshooting

| Error | Solusi |
|-------|--------|
| `SPREADSHEET_ID tidak ditemukan` | Pastikan file `.env` sudah dibuat dan diisi |
| `credentials.json not found` | Taruh file credentials.json di folder `finance-bot/` |
| `The caller does not have permission` | Share spreadsheet ke email service account (Step 3.4) |
| QR code tidak muncul | Pastikan tidak ada sesi lama → hapus folder `auth_info/` |
| Bot disconnect terus | Cek koneksi internet; bot akan auto-reconnect |

---

## ⚠️ Catatan Penting

- Bot ini menggunakan **Baileys** (WhatsApp Web tidak resmi). Gunakan secara bertanggung jawab untuk keperluan pribadi.
- **Jangan** kirim pesan massal atau spam — risiko akun dibanned.
- Simpan `credentials.json` dan `.env` dengan aman — **jangan di-share ke siapapun**.
