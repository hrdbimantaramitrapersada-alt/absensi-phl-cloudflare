"use client";

import React, { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { LoginModal } from "@/components/LoginModal";
import { RegisterModal } from "@/components/RegisterModal";
import { AdminDashboard } from "@/components/AdminDashboard";
import { KoordinatorDashboard } from "@/components/KoordinatorDashboard";
import { PekerjaDashboard } from "@/components/PekerjaDashboard";
import { SessionUser, UserRole } from "@/lib/types";
import { getSession, clearSession, setSession } from "@/lib/auth";
import { findUserByUsername, ensureSeedData } from "@/lib/firestore";
import { Award, Building2, ArrowRight, UserPlus, ChevronDown } from "lucide-react";

export default function Page() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  // Role selection for login (dropdown) — admin, koordinator, pekerja
  const [selectedRole, setSelectedRole] = useState<UserRole>("pekerja");

  const loadSession = async () => {
    setLoading(true);
    try {
      await ensureSeedData().catch(() => {});
      const cached = getSession();
      if (!cached) {
        setUser(null);
      } else {
        const fresh = await findUserByUsername(cached.username).catch(() => null);
        if (!fresh) {
          clearSession();
          setUser(null);
        } else {
          const refreshed: SessionUser = {
            id: fresh.id,
            role: fresh.role,
            username: fresh.username,
            name: fresh.name,
            status: fresh.status,
            team: fresh.team,
            phone: fresh.phone || "",
            dailyWage: fresh.dailyWage,
          };
          setSession(refreshed);
          setUser(refreshed);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSession();
  }, []);

  const handleLogout = () => {
    clearSession();
    setUser(null);
  };

  const openLoginWithRole = (role: UserRole) => {
    setSelectedRole(role);
    setShowLoginModal(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      <Header
        user={user}
        onLogout={handleLogout}
      />

      <main className="flex-1 flex flex-col w-full">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-32 space-y-4">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold text-slate-600">Menghubungkan ke Firestore BIMANTARA...</p>
          </div>
        ) : user ? (
          <div className="w-full">
            {user.role === "admin" && <AdminDashboard user={user} />}
            {user.role === "koordinator" && <KoordinatorDashboard user={user} />}
            {user.role === "pekerja" && <PekerjaDashboard user={user} />}
          </div>
        ) : (
          /* SIMPLE LANDING PAGE */
          <div className="flex-1 flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">

              {/* Logo Badge */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-700 to-indigo-900 rounded-3xl shadow-xl mb-5">
                  <Building2 className="w-11 h-11 text-white" />
                </div>
                <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full text-blue-700 text-xs font-bold uppercase tracking-wider mb-3">
                  <Award className="w-3.5 h-3.5 text-amber-500" />
                  <span>PT. Bimantara Mitra Persada</span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900">
                  Absensi PHL <span className="text-amber-500">BIMANTARA</span>
                </h1>
                <p className="text-sm text-slate-500 mt-2 font-medium">
                  Silakan masuk sebagai berikut untuk melanjutkan
                </p>
              </div>

              {/* Login Card */}
              <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-6 sm:p-8 space-y-5">
                {/* Dropdown Role Selection (Pekerja, Koordinator, Super Admin) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Pilih Jenis Akun
                  </label>
                  <div className="relative">
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                      className="w-full appearance-none bg-slate-50 border border-slate-300 rounded-xl px-4 py-3.5 pr-10 text-sm font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer"
                    >
                      <option value="pekerja">👷 Pekerja (PHL)</option>
                      <option value="koordinator">🧑‍💼 Koordinator Lapangan</option>
                      <option value="admin">🛡️ Super Admin</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                {/* Login Button */}
                <button
                  onClick={() => openLoginWithRole(selectedRole)}
                  className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold px-6 py-3.5 rounded-xl shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2 group"
                >
                  <span>Masuk Sekarang</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Divider */}
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-white text-slate-400 font-semibold uppercase tracking-wider">atau</span>
                  </div>
                </div>

                {/* Daftar Pekerja Baru — terpisah */}
                <button
                  onClick={() => setShowRegisterModal(true)}
                  className="w-full bg-amber-50 hover:bg-amber-100 text-amber-800 border-2 border-amber-300 hover:border-amber-400 font-bold px-6 py-3.5 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-5 h-5" />
                  <span>Daftar sebagai Pekerja Baru</span>
                </button>
              </div>

              {/* Footer */}
              <p className="text-center text-xs text-slate-400 mt-8 font-medium">
                © {new Date().getFullYear()} PT. Bimantara Mitra Persada
              </p>

            </div>
          </div>
        )}
      </main>

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={() => { setShowLoginModal(false); loadSession(); }}
        onSwitchRegister={() => { setShowLoginModal(false); setShowRegisterModal(true); }}
        roleHint={selectedRole}
      />

      <RegisterModal
        isOpen={showRegisterModal}
        onClose={() => setShowRegisterModal(false)}
        onSwitchLogin={() => { setShowRegisterModal(false); setShowLoginModal(true); }}
      />
    </div>
  );
}
