"use client";

import React, { useState, useEffect } from "react";
import { X, Upload, CheckCircle2, AlertCircle, Loader2, User, Phone, Users, Lock, FileText } from "lucide-react";
import { compressImage, uploadToCloudinary } from "@/lib/upload";
import { findUserByNik, findUserByUsername, createUser, subscribeTeams, ensureSeedData } from "@/lib/firestore";
import { Team } from "@/lib/types";

interface RegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchLogin: () => void;
}

export function RegisterModal({ isOpen, onClose, onSwitchLogin }: RegisterModalProps) {
  const [name, setName] = useState("");
  const [nik, setNik] = useState("");
  const [phone, setPhone] = useState("");
  const [team, setTeam] = useState("");
  const [password, setPassword] = useState("");
  const [ktpPreview, setKtpPreview] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [teamOptions, setTeamOptions] = useState<Team[]>([]);

  // Load master tim dari Firestore (real-time)
  useEffect(() => {
    if (!isOpen) return;
    ensureSeedData().catch(() => {});
    const unsub = subscribeTeams((list) => {
      setTeamOptions(list);
      if (!team && list.length > 0) setTeam(list[0].name);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const compressed = await compressImage(file, 800, 0.7);
        setKtpPreview(compressed);
      } catch (err) {
        console.error("Compression error:", err);
      }
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!ktpPreview) {
      setError("Foto KTP wajib diunggah.");
      setLoading(false);
      return;
    }
    if (nik.length < 10) {
      setError("Nomor KTP (NIK) tidak valid.");
      setLoading(false);
      return;
    }

    try {
      // Uniqueness check by NIK and username
      const existingByNik = await findUserByNik(nik.trim());
      const existingByUsername = await findUserByUsername(nik.trim());
      if (existingByNik || existingByUsername) {
        throw new Error("NIK / Nomor KTP sudah terdaftar.");
      }

      // Upload to Cloudinary (fallback to base64 if preset not configured)
      const ktpUrl = await uploadToCloudinary(ktpPreview, "absensi-phl/ktp");

      await createUser({
        role: "pekerja",
        username: nik.trim(),
        password,
        name: name.trim(),
        nik: nik.trim(),
        phone: phone.trim(),
        team,
        ktpPhotoUrl: ktpUrl,
        status: "pending",
        dailyWage: 100000,
      });

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Gagal mendaftar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden border border-slate-100 my-8">
        <div className="bg-gradient-to-r from-amber-600 to-amber-700 px-6 py-5 text-white flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold">Pendaftaran Pekerja Baru</h3>
            <p className="text-xs text-amber-100 mt-0.5">PT. Bimantara Mitra Persada</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-6 h-6 text-amber-100 hover:text-white" />
          </button>
        </div>

        {success ? (
          <div className="p-10 text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h4 className="text-2xl font-bold text-slate-800 mb-2">Pendaftaran Berhasil!</h4>
              <p className="text-slate-600 text-sm max-w-sm mx-auto leading-relaxed">
                Akun Anda dengan NIK <strong className="text-slate-800 font-semibold">{nik}</strong> telah disimpan ke Firestore.
              </p>
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-left text-sm text-amber-800">
                ⚠️ <strong>Penting:</strong> Status akun: <span className="bg-amber-200 text-amber-900 px-2 py-0.5 rounded font-bold">Pending</span>. Hubungi Koordinator/Admin agar disetujui sebelum bisa absen.
              </div>
            </div>
            <button
              onClick={onSwitchLogin}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-xl shadow-lg transition-all"
            >
              Lanjut ke Halaman Masuk
            </button>
          </div>
        ) : (
          <form onSubmit={handleRegister} className="p-6 space-y-5">
            {error && (
              <div className="bg-red-50 text-red-700 p-3.5 rounded-xl text-sm flex items-center gap-2.5 border border-red-200">
                <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Nama Lengkap</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><User className="w-4 h-4" /></span>
                  <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama sesuai KTP" className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-medium" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">NIK (Nomor KTP)</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><FileText className="w-4 h-4" /></span>
                  <input type="text" required value={nik} onChange={(e) => setNik(e.target.value)} placeholder="16 Digit Angka NIK" className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-medium" />
                </div>
                <span className="text-[11px] text-slate-500 ml-1">NIK akan digunakan sebagai Username login.</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Nomor Telepon / WA</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Phone className="w-4 h-4" /></span>
                  <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-medium" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Tim Kerja</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Users className="w-4 h-4" /></span>
                  <select required value={team} onChange={(e) => setTeam(e.target.value)} className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-medium appearance-none">
                    {teamOptions.length === 0 && <option value="">Memuat tim...</option>}
                    {teamOptions.map((t) => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Kata Sandi Baru</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Lock className="w-4 h-4" /></span>
                  <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Buat kata sandi untuk login" className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-medium" />
                </div>
              </div>

              <div className="sm:col-span-2 pt-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Upload Foto KTP Asli</label>
                <div className="border-2 border-dashed border-slate-300 hover:border-amber-500 rounded-xl p-4 text-center bg-slate-50/50 cursor-pointer transition-colors relative">
                  <input type="file" accept="image/*" required={!ktpPreview} onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  {ktpPreview ? (
                    <div className="space-y-3">
                      <img src={ktpPreview} alt="KTP Preview" className="max-h-40 mx-auto rounded-lg object-contain shadow" />
                      <p className="text-xs text-emerald-600 font-semibold flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Foto KTP terkompresi & siap diunggah ke Cloudinary
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 py-4">
                      <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center mx-auto"><Upload className="w-6 h-6" /></div>
                      <p className="text-sm font-semibold text-slate-700">Klik atau Pilih File / Kamera</p>
                      <p className="text-xs text-slate-500">JPG, PNG (dikompresi otomatis maks 800px)</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-amber-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading && <Loader2 className="w-5 h-5 animate-spin" />}
              <span>{loading ? "Menyimpan ke Firestore..." : "Kirim Pendaftaran"}</span>
            </button>

            <div className="text-center pt-2 border-t border-slate-100">
              <p className="text-sm text-slate-600">
                Sudah punya akun?{" "}
                <button type="button" onClick={onSwitchLogin} className="text-amber-700 font-bold hover:underline">
                  Masuk di sini
                </button>
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
