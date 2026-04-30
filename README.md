# 🤖 Telegram Finance Bot

Bot Telegram untuk mencatat keuangan pribadi secara otomatis ke Google Sheets.
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
| `help` atau `/help` | ❓ Panduan lengkap |
| `/start` | 🚀 Tampilkan panduan saat pertama kali pakai bot |

**Format angka yang didukung:** `35000` · `35.000` · `35k` · `35rb` · `35ribu` · `5jt` · `5juta`

**Setiap pengguna Telegram baru** → otomatis dapat sheet tab tersendiri di Google Sheets (berdasarkan numeric Telegram user ID).

---

## 🚀 Setup (Ikuti urutan ini!)

### Step 1 — Clone & install dependencies

```bash
cd finance-bot
npm install
```

---

### Step 2 — Buat Telegram Bot via @BotFather

1. Buka Telegram → cari [@BotFather](https://t.me/BotFather)
2. Kirim `/newbot` → ikuti instruksi (pilih nama dan username untuk bot kamu)
3. @BotFather akan mengirimkan **HTTP API token**, contoh:
   ```
   123456789:AAExampleTokenAaBbCcDdEeFfGgHhIiJjKkLl
   ```
4. **Simpan token ini** — akan dipakai di Step 5.

> 💡 Tips: kalau mau bot kamu bisa dipakai banyak orang, set deskripsi & foto profile via @BotFather (`/setdescription`, `/setuserpic`).

---

### Step 3 — Setup Google Cloud (sekali saja)

#### 3a. Buat Google Cloud Project

1. Buka [https://console.cloud.google.com](https://console.cloud.google.com)
2. Klik **"Select a project"** → **"New Project"**
3. Beri nama (misal: `finance-bot`) → **Create**

#### 3b. Aktifkan Google Sheets API

1. Di sidebar kiri → **"APIs & Services"** → **"Library"**
2. Cari **"Google Sheets API"** → klik → **Enable**

#### 3c. Buat Service Account

1. Di sidebar → **"APIs & Services"** → **"Credentials"**
2. Klik **"+ Create Credentials"** → **"Service account"**
3. Isi nama (misal: `finance-bot-sa`) → **Create and continue**
4. Role: **"Editor"** → **Continue** → **Done**

#### 3d. Download credentials.json

1. Di halaman Credentials → klik service account yang baru dibuat
2. Tab **"Keys"** → **"Add Key"** → **"Create new key"**
3. Pilih **JSON** → **Create** → file otomatis terdownload
4. **Rename file tersebut menjadi `credentials.json`**
5. **Pindahkan ke folder `finance-bot/`** (sejajar dengan `package.json`)

> ⚠️ **JANGAN upload `credentials.json` ke GitHub!** File ini sudah masuk `.gitignore`.

---

### Step 4 — Setup Google Spreadsheet

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

### Step 5 — Konfigurasi .env

1. Salin file contoh:
   ```bash
   # Linux / macOS
   cp .env.example .env

   # Windows (cmd)
   copy .env.example .env
   ```
2. Buka `.env` dan isi token bot + Spreadsheet ID:
   ```
   TELEGRAM_BOT_TOKEN=123456789:AAExampleTokenFromBotFather
   SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
   ```

---

### Step 6 — Jalankan Bot

```bash
node src/bot.js
```

Setelah jalan, kamu akan melihat:
```
✅ Bot Telegram berhasil terhubung!
💡 Buka chat dengan bot kamu di Telegram dan kirim "/start" atau "help" untuk memulai.
```

Buka Telegram → cari bot kamu (sesuai username yang kamu set di @BotFather) → klik **Start** atau kirim `/start`.

> Bot menggunakan **long-polling**, jadi tidak butuh server publik / HTTPS / webhook. Cukup biarkan proses ini jalan di laptop, VPS, atau service seperti Railway / Render.

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
│   ├── bot.js          ← Entry point Telegram (jalankan ini)
│   ├── parser.js       ← Parse pesan teks
│   ├── sheets.js       ← Google Sheets API
│   └── commands.js     ← Logic tiap command
├── credentials.json    ← Google service account key (kamu taruh di sini)
├── .env                ← Konfigurasi (TELEGRAM_BOT_TOKEN, SPREADSHEET_ID)
├── .env.example        ← Contoh .env
├── .gitignore
├── package.json
└── README.md
```

---

## ❓ Troubleshooting

| Error | Solusi |
|-------|--------|
| `TELEGRAM_BOT_TOKEN tidak ditemukan` | Pastikan file `.env` sudah dibuat dan diisi. |
| `SPREADSHEET_ID tidak ditemukan` | Pastikan file `.env` sudah dibuat dan diisi. |
| `credentials.json not found` | Taruh file credentials.json di folder `finance-bot/`. |
| `The caller does not have permission` | Share spreadsheet ke email service account (Step 4.4). |
| `401 Unauthorized` saat launch | Token bot salah / sudah di-revoke. Cek ulang via @BotFather. |
| `409 Conflict: terminated by other getUpdates request` | Bot sudah jalan di proses lain. Matikan instance lama dulu (cuma boleh ada 1 polling per token). |
| Bot tidak balas pesan | Pastikan kamu sudah klik **Start** di chat bot, dan proses `node src/bot.js` masih berjalan. |

---

## ⚠️ Catatan Penting

- Bot ini menggunakan **long-polling** Telegram Bot API — tidak butuh webhook publik. Cocok untuk dijalankan di laptop pribadi atau VPS kecil.
- Setiap `TELEGRAM_BOT_TOKEN` cuma boleh dipakai oleh **satu** instance polling pada satu waktu — kalau mau scale, gunakan webhook (lihat dokumentasi [Telegraf](https://telegraf.js.org/)).
- Simpan `credentials.json` dan `.env` dengan aman — **jangan di-share ke siapapun**.
