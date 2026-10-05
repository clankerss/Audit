# Audit

Paste URL sebuah website. Agent membukanya di browser sungguhan, mencatat klaim yang ditulis website itu sendiri, menguji setiap klaim, lalu memberi laporan netral tentang apa yang benar-benar terjadi.

Setiap klaim mendapat salah satu status:

- **Works as claimed** — agent melihat fiturnya bekerja seperti yang diklaim.
- **Partly works** — sebagian bekerja, atau hanya dalam bentuk terbatas (misalnya berlabel preview).
- **Not as claimed** — agent melihat langsung perilaku yang bertentangan dengan klaim.
- **Couldn't test** — tidak bisa diuji (butuh wallet, login, atau pembayaran; logika server; konten di dalam canvas).

## Cara kerja

1. Server membuka website di Chromium (Playwright), termasuk halaman yang berat JavaScript.
2. Claude menjadi otak agent dan memakai tool berikut:
   - `open_page`: membuka halaman dan membaca teks serta tombolnya.
   - `click` dan `type_text`: mencoba fitur dengan nilai uji seperti "audit-test".
   - `observe`: mengamati halaman 5–45 detik untuk mengecek klaim live atau multiplayer (teks baru, perubahan DOM, pesan websocket).
   - `screenshot`: menyimpan bukti.
   - `fetch_url`: mengecek link docs dan sosial media.
   - `github_repo` dan `github_read_file`: mengecek repo yang di-link (ada atau tidak, fork atau bukan, commit terbaru, isi file).
3. Langkah agent dikirim live ke browser kamu lewat Server-Sent Events.
4. Agent menutup audit dengan laporan terstruktur.

## Batas keamanan

- Tombol wallet, pembayaran, login, dan transaksi tidak pernah diklik (lihat `RISKY_ACTION` di `safety.js`).
- Field email, password, nomor telepon, dan data pribadi lain tidak pernah diisi.
- Tidak ada download. Popup langsung ditutup.
- Alamat jaringan privat (localhost, 10.x, 192.168.x, metadata cloud) diblokir, supaya server kamu tidak bisa disalahgunakan untuk mengakses jaringan internal.
- Teks dari website diperlakukan sebagai data, bukan instruksi untuk agent.

## Jalankan di komputer sendiri

Butuh Node.js 20 atau lebih baru.

```bash
npm install
npx playwright install --with-deps chromium
cp .env.example .env      # lalu isi ANTHROPIC_API_KEY dan ACCESS_KEY
npm start
```

Buka http://localhost:3000.

## Deploy ke Railway

1. Upload folder ini ke repo GitHub baru (file `.env` jangan ikut, sudah diatur di `.gitignore`).
2. Di railway.app, pilih **New Project → Deploy from GitHub repo**, lalu pilih repo tadi. Railway otomatis memakai `Dockerfile`.
3. Di tab **Variables**, isi `ANTHROPIC_API_KEY` dan `ACCESS_KEY`. `GITHUB_TOKEN` opsional.
4. Di **Settings → Networking**, klik **Generate Domain**.
5. Buka domainnya, masukkan access key, lalu paste website yang mau diaudit.

Pilih paket dengan RAM minimal 1 GB, karena Chromium cukup berat.

## Biaya dan waktu

- Satu audit biasanya 10–24 langkah agent dan selesai dalam 1–3 menit.
- Biaya ditagih ke akun Anthropic API kamu per audit. Screenshot dan teks halaman yang lama dipangkas otomatis supaya biaya tetap kecil.
- `AUDIT_MAX_STEPS` membatasi jumlah langkah. `MAX_CONCURRENT` membatasi jumlah audit yang berjalan bersamaan.

## Batasan MVP

- Hanya menguji yang terlihat dari browser. Logika server (misalnya apakah signer benar-benar menegakkan limit) tidak bisa dibuktikan.
- Game atau aplikasi yang digambar di dalam `<canvas>` belum bisa dioperasikan agent.
- Fitur di balik login atau wallet otomatis berstatus "Couldn't test".
- Website dengan proteksi bot (misalnya Cloudflare challenge) mungkin gagal dibuka.
- Blokir jaringan privat memeriksa DNS sebelum setiap navigasi. Untuk produksi serius, tambahkan juga firewall egress di level server.

## Struktur file

| File | Isi |
| --- | --- |
| `server.js` | Server Express, endpoint `/api/audit` (live stream), access key, batas waktu |
| `agent.js` | Instruksi agent (termasuk aturan netral), definisi tool, dan loop agent |
| `browser.js` | Sesi browser: buka, klik, ketik, amati, screenshot |
| `webtools.js` | Cek link tanpa browser dan inspeksi GitHub |
| `safety.js` | Blokir jaringan privat, tombol berisiko, dan field sensitif |
| `public/index.html` | Tampilan: input URL, live feed, screenshot, laporan |
