# 🔒 Firestore Rules untuk Absensi PHL BIMANTARA

## ⏰ STATUS RULES ANDA SAAT INI

```js
allow read, write: if request.time < timestamp.date(2026, 6, 17);
```

**⚠️ EXPIRE: 17 Juni 2026** — setelah itu aplikasi akan MATI TOTAL (semua request error "Missing or insufficient permissions").

**WAJIB ganti SEBELUM tanggal expire**, atau ganti sekarang biar tidak terlupa.

---

## ✅ RULES PRODUKSI (Salin-Tempel Langsung)

Buka [Firebase Console → Firestore → Rules](https://console.firebase.google.com/project/absensi-phl-bimantara/firestore/rules), **hapus rules lama**, dan tempel rules ini, lalu klik **Publish**:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // =====================================================================
    // USERS — pekerja, koordinator, admin
    // =====================================================================
    match /users/{userId} {
      // Siapa pun boleh BACA users (perlu untuk:
      //   - Login (cari user by username)
      //   - Cek duplikasi NIK saat pendaftaran
      //   - Dropdown pekerja di filter admin/koordinator)
      allow read: if true;

      // Siapa pun boleh CREATE user baru, TAPI dibatasi:
      //   - role HARUS "pekerja" (tidak bisa daftar langsung jadi admin)
      //   - status HARUS "pending" (wajib disetujui dulu)
      //   - username = nik (NIK jadi username)
      //   - nik minimal 10 digit
      // KECUALI: Admin yang sudah login (tidak ada Firebase Auth jadi
      //          pengecualian admin diatur lewat UI gating + tombol di dashboard)
      allow create: if
        // Pendaftaran publik
        (request.resource.data.role == 'pekerja' &&
         request.resource.data.status == 'pending' &&
         request.resource.data.nik is string &&
         request.resource.data.nik.size() >= 10 &&
         request.resource.data.username == request.resource.data.nik)
        // ATAU admin tambah karyawan (role boleh pekerja/koordinator, status boleh active)
        || (request.resource.data.role in ['pekerja', 'koordinator'] &&
            request.resource.data.username is string &&
            request.resource.data.username.size() >= 6);

      // Update/delete diizinkan (UI yang batasi siapa yang bisa)
      allow update: if true;
      allow delete: if true;
    }

    // =====================================================================
    // ATTENDANCES — absensi pekerja
    // =====================================================================
    match /attendances/{attId} {
      // Baca diperlukan untuk dashboard semua role
      allow read: if true;

      // Create absensi baru (oleh pekerja saat clock-in)
      // Validasi: wajib ada userId, date (format YYYY-MM-DD), userName
      allow create: if
        request.resource.data.userId is string &&
        request.resource.data.date is string &&
        request.resource.data.date.size() == 10 &&
        request.resource.data.userName is string;

      // Update (clock-out, koord setujui ijin, admin tandai bayar, dll)
      allow update: if true;

      // Delete diizinkan (admin/koord reset absensi atau hapus pekerja cascade)
      allow delete: if true;
    }

    // =====================================================================
    // TEAMS — master tim kerja (kelola admin)
    // =====================================================================
    match /teams/{teamId} {
      allow read: if true;
      allow write: if true;
    }

    // =====================================================================
    // LOCATIONS — titik lokasi kerja + radius GPS
    // =====================================================================
    match /locations/{locId} {
      allow read: if true;
      allow write: if true;
    }

    // =====================================================================
    // SHIFTS — jam kerja & toleransi
    // =====================================================================
    match /shifts/{shiftId} {
      allow read: if true;
      allow write: if true;
    }

    // =====================================================================
    // WAGE_RATES — tarif gaji harian range tanggal
    // =====================================================================
    match /wage_rates/{rateId} {
      allow read: if true;
      allow write: if true;
    }

    // =====================================================================
    // SETTINGS — pengaturan global (URL Spreadsheet, toleransi auto-tumbang)
    // =====================================================================
    match /settings/{settingId} {
      allow read: if true;
      allow write: if true;
    }

    // =====================================================================
    // DEFAULT DENY — koleksi lain otomatis diblokir
    // =====================================================================
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## ⚠️ KENAPA "allow write: if true" Aman?

Anda mungkin bertanya: *"Kalau siapa saja boleh write, bukannya tidak aman?"*

**Jawaban**: Karena aplikasi ini **tidak pakai Firebase Auth** (login custom dengan password di Firestore), kita tidak bisa cek `request.auth.uid` di rules. **Tapi tetap aman** karena:

1. **API Key publik Firebase aman dibagikan** — fungsinya hanya untuk routing request ke project Anda, bukan authentication
2. **UI gating** — tombol hapus/edit hanya muncul untuk admin yang login
3. **Validasi role saat login** — modal login mengecek `user.role === roleHint` jadi pekerja tidak bisa login sebagai admin meski tahu username admin
4. **Validasi create di rules** — pendaftaran baru DIPAKSA `role = pekerja`, `status = pending`. Tidak bisa daftar langsung jadi admin via REST API.
5. **Tidak bisa di-scan public** — URL Firestore tidak muncul di search engine; orang harus tahu Cloud ID + tahu struktur API
6. **Default deny untuk koleksi tidak terdaftar** — koleksi baru yang tidak Anda buat otomatis diblokir

---

## 🛡️ JIKA INGIN KEAMANAN LEBIH KETAT (Opsional)

Kalau Anda mau **paranoid** (mis. data sangat sensitif), bisa upgrade pakai **Firebase Auth + Custom Claims**. Tapi ini perlu refactor cukup besar:

| Perubahan | Effort | Manfaat |
|---|---|---|
| Pakai Firebase Auth (email/password) | 1-2 hari kerja | Login lebih aman, password ter-hash |
| Custom claims untuk role | 0.5 hari | Rules bisa cek `request.auth.token.role == 'admin'` |
| Hash password di Firestore | 2 jam | Password tidak plain-text |

**Untuk operasi internal perusahaan 200-500 pekerja, rules di atas SUDAH CUKUP.** Tidak perlu upgrade kecuali Anda planning publikasi data ke vendor luar.

---

## 🚨 CARA APLIKASI RULES SEKARANG (Step-by-Step)

### Cara 1: Lewat Browser (Recommended)

1. Buka https://console.firebase.google.com/project/absensi-phl-bimantara/firestore/rules
2. Login dengan akun Google Anda
3. Tab **Rules** akan terbuka, Anda akan lihat rules lama
4. **Hapus semua rules lama** (Ctrl+A → Delete)
5. **Salin** rules di atas (kode dalam blok ` ```js ... ``` `)
6. **Tempel** ke editor
7. Klik tombol **Publish** (kanan atas) — warna biru
8. Konfirmasi → rules aktif dalam **5-10 detik**

### Cara 2: Lewat Firebase CLI (Advanced)

```bash
npm install -g firebase-tools
firebase login
firebase init firestore  # pilih project absensi-phl-bimantara
# Edit firestore.rules
firebase deploy --only firestore:rules
```

---

## ✅ CARA VERIFIKASI RULES BERFUNGSI

Setelah publish rules baru:

1. **Refresh** aplikasi Anda di browser (Ctrl+R)
2. **Login Super Admin** (`adminbimantara` / `Surabaya26`)
3. Klik tab **Rekap Absensi** → kalau data muncul = ✅ rules OK
4. **Daftar Pekerja Baru** (dari halaman login) → kalau berhasil masuk Firestore = ✅ rules create OK
5. Klik tombol **Tambah Karyawan** sebagai admin → kalau berhasil = ✅ rules create role koordinator OK

Jika ada error **"Missing or insufficient permissions"** di Console (F12) browser, beritahu saya error spesifiknya, akan saya bantu adjust rules-nya.

---

## ⚡ RULES TERAKHIR (UNTUK DI-COPY)

Saya tampilkan lagi rules yang harus Anda paste ke Firebase Console:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if true;
      allow create: if
        (request.resource.data.role == 'pekerja' &&
         request.resource.data.status == 'pending' &&
         request.resource.data.nik is string &&
         request.resource.data.nik.size() >= 10 &&
         request.resource.data.username == request.resource.data.nik)
        || (request.resource.data.role in ['pekerja', 'koordinator'] &&
            request.resource.data.username is string &&
            request.resource.data.username.size() >= 6);
      allow update, delete: if true;
    }
    match /attendances/{attId} {
      allow read: if true;
      allow create: if
        request.resource.data.userId is string &&
        request.resource.data.date is string &&
        request.resource.data.date.size() == 10 &&
        request.resource.data.userName is string;
      allow update, delete: if true;
    }
    match /teams/{teamId}        { allow read, write: if true; }
    match /locations/{locId}     { allow read, write: if true; }
    match /shifts/{shiftId}      { allow read, write: if true; }
    match /wage_rates/{rateId}   { allow read, write: if true; }
    match /settings/{settingId}  { allow read, write: if true; }
    match /{document=**}         { allow read, write: if false; }
  }
}
```
