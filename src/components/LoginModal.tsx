"use client";

import React, { useState, useEffect } from "react";
import { X, Lock, User, AlertCircle, Loader2, Shield, Briefcase, HardHat } from "lucide-react";
import { findUserByUsername, ensureSeedData } from "@/lib/firestore";
import { setSession } from "@/lib/auth";
import { UserRole } from "@/lib/types";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onSwitchRegister: () => void;
  roleHint?: UserRole;
}

export function LoginModal({ isOpen, onClose, onSuccess, onSwitchRegister, roleHint = "pekerja" }: LoginModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reset form whenever role changes or modal reopens (no auto-fill of credentials)
  useEffect(() => {
    setUsername("");
    setPassword("");
    setError("");
  }, [roleHint, isOpen]);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await ensureSeedData();

      const user = await findUserByUsername(username.trim());
      if (!user) {
        throw new Error("Akun tidak ditemukan. Periksa kembali username atau NIK Anda.");
      }
      if (user.password !== password) {
        throw new Error("Sandi yang dimasukkan salah.");
      }
      if (user.status === "inactive") {
        throw new Error("Akun Anda telah dinonaktifkan oleh Admin.");
      }
      // Validate role matches the dropdown selection
      if (user.role !== roleHint) {
        const labels: Record<UserRole, string> = {
          admin: "Super Admin",
          koordinator: "Koordinator Lapangan",
          pekerja: "Pekerja PHL",
        };
        throw new Error(`Akun ini bukan akun ${labels[roleHint]}. Akun Anda terdaftar sebagai ${labels[user.role]}.`);
      }

      setSession({
        id: user.id,
        role: user.role,
        username: user.username,
        name: user.name,
        status: user.status,
        team: user.team,
        phone: user.phone || "",
        dailyWage: user.dailyWage,
      });

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Gagal masuk");
    } finally {
      setLoading(false);
    }
  };

  const roleMeta = {
    admin: { label: "Super Admin", icon: Shield, color: "from-indigo-900 to-blue-900", hint: "Akses penuh pengaturan sistem" },
    koordinator: { label: "Koordinator Lapangan", icon: Briefcase, color: "from-emerald-800 to-emerald-900", hint: "Pantau & setujui absensi pekerja" },
    pekerja: { label: "Pekerja PHL", icon: HardHat, color: "from-blue-800 to-indigo-900", hint: "Gunakan NIK (Nomor KTP) sebagai Username" },
  };
  const meta = roleMeta[roleHint];
  const Icon = meta.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
        <div className={`bg-gradient-to-r ${meta.color} px-6 py-5 text-white flex justify-between items-center`}>
          <div className="flex items-center gap-3">
            <div className="bg-white/15 p-2 rounded-xl">
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Masuk · {meta.label}</h3>
              <p className="text-xs text-white/70 mt-0.5">{meta.hint}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-6 h-6 text-white/80 hover:text-white" />
          </button>
        </div>

        <form onSubmit={handleLogin} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm flex items-center gap-2 border border-red-200">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              {roleHint === "pekerja" ? "NIK (Nomor KTP)" : "Username"}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <User className="w-5 h-5" />
              </span>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={roleHint === "pekerja" ? "Masukkan NIK" : "Masukkan username"}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Kata Sandi</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Lock className="w-5 h-5" />
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan kata sandi"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 font-medium"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {loading && <Loader2 className="w-5 h-5 animate-spin" />}
            <span>{loading ? "Memverifikasi..." : "Masuk"}</span>
          </button>

          {roleHint === "pekerja" && (
            <div className="text-center pt-2 border-t border-slate-100">
              <p className="text-sm text-slate-600">
                Pekerja baru?{" "}
                <button type="button" onClick={onSwitchRegister} className="text-blue-600 hover:text-blue-700 font-bold hover:underline">
                  Daftar di sini
                </button>
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
