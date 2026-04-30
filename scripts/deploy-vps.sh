#!/usr/bin/env bash
#
# deploy-vps.sh — One-shot deployer untuk Telegram Finance Bot.
#
# Pemakaian (di VPS, dari folder repo):
#   bash scripts/deploy-vps.sh
#
# Yang dilakukan script ini:
#   1. Pastikan Node.js 20+ dan PM2 terinstal (install otomatis kalau belum).
#   2. Jalankan `npm install`.
#   3. Tanya & tulis .env (TELEGRAM_BOT_TOKEN, SPREADSHEET_ID).
#   4. Tanya & tulis credentials.json (paste dari clipboard, akhiri dengan baris "EOF").
#   5. Daftarkan bot ke PM2, save state, dan setup auto-startup saat boot.
#
# Aman dijalankan ulang — script idempotent (skip langkah yang sudah jadi).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }

bold '╔════════════════════════════════════════════╗'
bold '║   🤖  Telegram Finance Bot — VPS Deployer  ║'
bold '╚════════════════════════════════════════════╝'

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  yellow '→ Node.js belum ada, instal Node.js 20.x via NodeSource…'
  if ! command -v sudo >/dev/null 2>&1; then
    red 'sudo tidak ditemukan. Instal Node.js 20+ manual lalu jalankan ulang.'
    exit 1
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
green "✓ Node.js: $(node -v)"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  red "Node.js terlalu lama (v$NODE_MAJOR). Butuh v18 atau lebih baru."
  exit 1
fi

# ── 2. npm install ────────────────────────────────────────────────────────────
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  yellow '→ Menginstal dependency npm…'
  npm install
fi
green '✓ Dependency siap'

# ── 3. .env ───────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  green '✓ File .env sudah ada (skip — hapus dulu kalau mau buat ulang)'
else
  yellow '→ Buat file .env'
  read -r -p '  TELEGRAM_BOT_TOKEN  : ' TELEGRAM_BOT_TOKEN
  read -r -p '  SPREADSHEET_ID      : ' SPREADSHEET_ID

  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$SPREADSHEET_ID" ]; then
    red 'Kedua nilai wajib diisi.'
    exit 1
  fi

  cat > .env <<EOF
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
SPREADSHEET_ID=$SPREADSHEET_ID
EOF
  chmod 600 .env
  green '✓ .env tersimpan (chmod 600)'
fi

# ── 4. credentials.json ───────────────────────────────────────────────────────
if [ -f credentials.json ]; then
  green '✓ credentials.json sudah ada (skip — hapus dulu kalau mau ganti)'
else
  yellow '→ Paste isi service account JSON kamu (full { ... }), lalu tekan Ctrl+D di baris kosong:'
  if ! cat > credentials.json; then
    red 'Gagal membaca credentials.json'
    exit 1
  fi
  if ! node -e "JSON.parse(require('fs').readFileSync('credentials.json','utf8'))" 2>/dev/null; then
    red 'credentials.json bukan JSON valid. Hapus file lalu jalankan ulang.'
    rm -f credentials.json
    exit 1
  fi
  chmod 600 credentials.json
  green '✓ credentials.json valid (chmod 600)'
fi

# ── 5. PM2 ────────────────────────────────────────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  yellow '→ PM2 belum ada, instal global…'
  if command -v sudo >/dev/null 2>&1; then
    sudo npm install -g pm2
  else
    npm install -g pm2
  fi
fi
green "✓ PM2: $(pm2 -v)"

if pm2 describe finance-bot >/dev/null 2>&1; then
  yellow '→ PM2: restart finance-bot'
  pm2 restart finance-bot --update-env
else
  yellow '→ PM2: start finance-bot'
  pm2 start src/bot.js --name finance-bot
fi
pm2 save

# ── 6. Auto-startup saat reboot ───────────────────────────────────────────────
if [ ! -f "$HOME/.pm2/dump.pm2" ]; then
  yellow '→ PM2 dump belum tersedia, save lagi'
  pm2 save
fi

bold ''
bold '════════════════════════════════════════════════════════════════════'
green '✅  Bot berhasil di-deploy. Cek status & logs:'
echo  '       pm2 status'
echo  '       pm2 logs finance-bot'
echo  ''
yellow '⚠️  Untuk auto-restart saat VPS reboot, jalankan:'
echo  '       pm2 startup'
echo  '   PM2 akan print satu baris `sudo env PATH=$PATH:... pm2 ...`'
echo  '   Copy & jalankan baris itu, lalu `pm2 save` sekali lagi.'
bold '════════════════════════════════════════════════════════════════════'
