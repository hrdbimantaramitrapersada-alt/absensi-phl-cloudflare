"use client";

import React from "react";
import { LogOut, User, Shield, Briefcase, Building2 } from "lucide-react";
import { SessionUser } from "@/lib/types";

interface HeaderProps {
  user: SessionUser | null;
  onLogout: () => void;
  onShowLogin?: () => void;
  onShowRegister?: () => void;
}

export function Header({ user, onLogout, onShowLogin, onShowRegister }: HeaderProps) {
  return (
    <header className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 text-white shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo and Title */}
          <div className="flex items-center space-x-3">
            <div className="bg-white p-2.5 rounded-xl shadow-md flex items-center justify-center text-blue-900">
              <Building2 className="w-8 h-8" />
            </div>
            <div>
              <span className="bg-blue-500/20 text-blue-200 text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                PT. Bimantara Mitra Persada
              </span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
                Absensi PHL <span className="text-amber-400 font-extrabold">BIMANTARA</span>
              </h1>
            </div>
          </div>

          {/* User Status or Auth Buttons */}
          <div className="flex items-center space-x-4">
            {user ? (
              <div className="flex items-center space-x-4">
                <div className="hidden md:flex flex-col text-right">
                  <span className="text-sm font-semibold">{user.name}</span>
                  <span className="text-xs text-blue-200 flex items-center justify-end gap-1 capitalize">
                    {user.role === "admin" && <Shield className="w-3 h-3 text-amber-400" />}
                    {user.role === "koordinator" && <Briefcase className="w-3 h-3 text-emerald-400" />}
                    {user.role === "pekerja" && <User className="w-3 h-3 text-blue-300" />}
                    {user.role === "admin" ? "Super Admin" : user.role === "koordinator" ? "Koordinator Lapangan" : "Pekerja PHL"}
                    {user.team && ` (${user.team})`}
                  </span>
                </div>
                
                <button
                  onClick={onLogout}
                  className="bg-red-600/80 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center space-x-1.5"
                  title="Keluar"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Keluar</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                {onShowLogin && (
                  <button
                    onClick={onShowLogin}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all shadow-md"
                  >
                    Masuk
                  </button>
                )}
                {onShowRegister && (
                  <button
                    onClick={onShowRegister}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-900 px-5 py-2 rounded-lg text-sm font-semibold transition-all shadow-md"
                  >
                    Daftar Pekerja Baru
                  </button>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}
