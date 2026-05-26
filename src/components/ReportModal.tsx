"use client";

import React, { useMemo } from "react";
import { X, Calendar, DollarSign, TrendingUp, AlertTriangle, FileText, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { AppUser, Attendance, Shift } from "@/lib/types";
import { computeEffectiveStatus } from "@/lib/attendance-helpers";

interface ReportModalProps {
  user: AppUser;
  attendances: Attendance[];   // semua attendances (akan difilter per user)
  shifts: Shift[];
  tumbangToleranceHours?: number;
  onClose: () => void;
}

/**
 * Modal laporan ringkas per pekerja.
 * Tampilkan summary kehadiran, total gaji, dan riwayat detail dengan tombol unduh Excel.
 */
export function ReportModal({ user, attendances, shifts, tumbangToleranceHours = 1, onClose }: ReportModalProps) {
  const nowMs = Date.now();
  const userAtts = useMemo(
    () => attendances
      .filter((a) => a.userId === user.id)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [attendances, user.id]
  );

  const stats = useMemo(() => {
    let finish = 0, tumbang = 0, sedangKerja = 0, autoTumbang = 0;
    let totalGaji = 0, sudahDibayar = 0;
    let pendingApproval = 0;
    let lateCount = 0;
    let outOfRadiusCount = 0;

    userAtts.forEach((att) => {
      const eff = computeEffectiveStatus(att, shifts, tumbangToleranceHours, nowMs);
      if (eff.status === "finish") finish++;
      else if (eff.status === "tumbang") tumbang++;
      else if (eff.status === "auto_tumbang") autoTumbang++;
      else if (eff.status === "absen_masuk") sedangKerja++;

      totalGaji += att.wageAmount || 0;
      if (att.isPaid) sudahDibayar += att.wageAmount || 0;
      if (att.clockInStatus === "late") lateCount++;
      if (att.clockInStatus === "pending_approval" || att.clockOutStatus === "pending_approval") pendingApproval++;
      if (att.clockInStatus === "exception_approved" || att.clockOutStatus === "exception_approved") outOfRadiusCount++;
    });

    return {
      total: userAtts.length,
      finish, tumbang, autoTumbang, sedangKerja,
      totalGaji, sudahDibayar, belumDibayar: totalGaji - sudahDibayar,
      pendingApproval, lateCount, outOfRadiusCount,
    };
  }, [userAtts, shifts, tumbangToleranceHours, nowMs]);

  const handleDownload = () => {
    const rows = userAtts.map((att, i) => {
      const eff = computeEffectiveStatus(att, shifts, tumbangToleranceHours, nowMs);
      const statusKerja =
        eff.status === "finish" ? "FINISH" :
        eff.status === "tumbang" ? "TUMBANG" :
        eff.status === "auto_tumbang" ? "TUMBANG (otomatis)" : "BELUM SELESAI";
      return {
        No: i + 1,
        Tanggal: att.date,
        "Jam Masuk": att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID") : "-",
        "Jam Pulang": att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID") : "-",
        "Status Kerja": statusKerja,
        "Status Masuk": att.clockInStatus || "-",
        "Lokasi": att.locationName || "-",
        "Catatan Koordinator": att.koordinatorNote || "-",
        "Tarif": att.wageAmount || 0,
        "Status Bayar": att.isPaid ? "TERBAYAR" : "BELUM",
        "Foto Masuk": att.clockInPhotoUrl || "-",
        "Foto Pulang": att.clockOutPhotoUrl || "-",
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Report ${user.name.substring(0, 25)}`);
    XLSX.writeFile(wb, `Report_${user.name.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden border border-slate-100 my-8 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-700 to-blue-800 px-6 py-5 text-white flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-white/15 rounded-full flex items-center justify-center font-extrabold text-xl flex-shrink-0">
              {user.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-bold truncate flex items-center gap-2">
                <FileText className="w-5 h-5 flex-shrink-0" />
                Report Pekerja
              </h3>
              <p className="text-sm text-blue-100 mt-0.5 truncate">{user.name} • NIK {user.nik} • {user.team}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleDownload} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 shadow-sm">
              <Download className="w-3.5 h-3.5" /> <span>Unduh Excel</span>
            </button>
            <button onClick={onClose} className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-700 uppercase">
                <Calendar className="w-3.5 h-3.5" /> Total Hadir
              </div>
              <p className="text-2xl font-extrabold text-blue-900 mt-1">{stats.total}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
              <div className="text-xs font-bold text-emerald-700 uppercase">FINISH</div>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1">{stats.finish}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl">
              <div className="text-xs font-bold text-amber-700 uppercase">TUMBANG</div>
              <p className="text-2xl font-extrabold text-amber-700 mt-1">{stats.tumbang + stats.autoTumbang}</p>
              {stats.autoTumbang > 0 && <p className="text-[10px] text-amber-600 mt-0.5">({stats.autoTumbang} otomatis)</p>}
            </div>
            <div className="bg-purple-50 border border-purple-200 p-3 rounded-xl">
              <div className="text-xs font-bold text-purple-700 uppercase">Sedang Kerja</div>
              <p className="text-2xl font-extrabold text-purple-700 mt-1">{stats.sedangKerja}</p>
            </div>
          </div>

          {/* Payroll Box */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-5 h-5 text-emerald-700" />
              <h4 className="font-bold text-emerald-900">Ringkasan Penggajian</h4>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-emerald-700 font-semibold">Total Gaji</p>
                <p className="text-lg font-extrabold text-emerald-900">Rp {stats.totalGaji.toLocaleString("id-ID")}</p>
              </div>
              <div>
                <p className="text-xs text-emerald-700 font-semibold">Sudah Dibayar</p>
                <p className="text-lg font-extrabold text-emerald-700">Rp {stats.sudahDibayar.toLocaleString("id-ID")}</p>
              </div>
              <div>
                <p className="text-xs text-red-700 font-semibold">Belum Dibayar</p>
                <p className="text-lg font-extrabold text-red-700">Rp {stats.belumDibayar.toLocaleString("id-ID")}</p>
              </div>
            </div>
          </div>

          {/* Warnings */}
          {(stats.pendingApproval > 0 || stats.lateCount > 0 || stats.outOfRadiusCount > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <h4 className="font-bold text-amber-900 text-sm">Catatan Penting</h4>
              </div>
              <ul className="text-xs text-amber-900 space-y-1 ml-6 list-disc">
                {stats.pendingApproval > 0 && <li>{stats.pendingApproval} absensi <strong>menunggu persetujuan</strong> ijin luar titik</li>}
                {stats.lateCount > 0 && <li>{stats.lateCount} absen masuk <strong>terlambat</strong></li>}
                {stats.outOfRadiusCount > 0 && <li>{stats.outOfRadiusCount} absen pernah <strong>di luar radius</strong> (sudah disetujui)</li>}
              </ul>
            </div>
          )}

          {/* Detail Table */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-slate-700" />
              <h4 className="font-bold text-slate-800">Riwayat Detail ({userAtts.length} absensi)</h4>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr className="text-slate-700 font-bold uppercase">
                      <th className="py-2 px-3">Tanggal</th>
                      <th className="py-2 px-3">Masuk</th>
                      <th className="py-2 px-3">Pulang</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right">Tarif</th>
                      <th className="py-2 px-3 text-center">Bayar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {userAtts.length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-slate-400 font-medium">Belum ada absensi.</td></tr>
                    ) : userAtts.map((att) => {
                      const eff = computeEffectiveStatus(att, shifts, tumbangToleranceHours, nowMs);
                      return (
                        <tr key={att.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-semibold">{att.date}</td>
                          <td className="py-2 px-3 font-mono">{att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                          <td className="py-2 px-3 font-mono">{att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                          <td className="py-2 px-3">
                            {eff.status === "finish" && <span className="bg-emerald-500 text-white font-bold px-2 py-0.5 rounded">FINISH</span>}
                            {eff.status === "tumbang" && <span className="bg-amber-500 text-white font-bold px-2 py-0.5 rounded">TUMBANG</span>}
                            {eff.status === "auto_tumbang" && <span className="bg-orange-500 text-white font-bold px-2 py-0.5 rounded">TUMBANG ★</span>}
                            {eff.status === "absen_masuk" && <span className="bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded">Kerja</span>}
                          </td>
                          <td className="py-2 px-3 text-right font-bold">Rp {(att.wageAmount || 0).toLocaleString("id-ID")}</td>
                          <td className="py-2 px-3 text-center">
                            {att.isPaid ? <span className="text-emerald-600">✓</span> : <span className="text-red-600">✗</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
