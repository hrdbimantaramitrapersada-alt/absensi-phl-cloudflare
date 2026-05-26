"use client";

import React, { useState, useEffect, useMemo } from "react";
import { CheckCircle, UserCheck, Clock, User, Filter, X, Download, Copy, FileText, RotateCcw, Eraser, ExternalLink } from "lucide-react";
import * as XLSX from "xlsx";
import { SessionUser, AppUser, Attendance, Team, Shift, AppSettings } from "@/lib/types";
import { subscribeUsers, subscribeAttendances, updateUser, updateAttendance, dateNDaysAgo, subscribeTeams, subscribeShifts, subscribeAppSettings, deleteAttendance, resetClockOut } from "@/lib/firestore";
import { PhotoModal, PhotoThumb, usePhotoModal } from "./PhotoModal";
import { computeEffectiveStatus } from "@/lib/attendance-helpers";
import { buildAttendanceRows, copyRowsToClipboard } from "@/lib/export-helpers";
import { ReportModal } from "./ReportModal";

interface KoordinatorDashboardProps {
  user: SessionUser;
}

export function KoordinatorDashboard({ user }: KoordinatorDashboardProps) {
  const [activeTab, setActiveTab] = useState<"attendance" | "pending_users">("attendance");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>({ googleSpreadsheetUrl: "", companyName: "", updatedAt: 0 });
  const [nowMs, setNowMs] = useState(Date.now());
  const [successMsg, setSuccessMsg] = useState("");

  // Filter state untuk tabel absensi
  const [filterUserId, setFilterUserId] = useState("");
  const [filterTeam, setFilterTeam] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  useEffect(() => {
    const u1 = subscribeUsers((list) => setUsers(list.filter((x) => x.role === "pekerja")));
    // Hemat Firestore reads: hanya subscribe absensi 60 hari terakhir
    const u2 = subscribeAttendances(setAttendances, undefined, dateNDaysAgo(60));
    const u3 = subscribeTeams(setTeams);
    const u4 = subscribeShifts(setShifts);
    const u5 = subscribeAppSettings(setAppSettings);
    const tick = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => { u1(); u2(); u3(); u4(); u5(); clearInterval(tick); };
  }, []);

  const tumbangToleranceHours = appSettings.autoTumbangToleranceHours ?? 1;
  const effectiveStatusOf = (att: Attendance) =>
    computeEffectiveStatus(att, shifts, tumbangToleranceHours, nowMs);

  // Index user by id untuk lookup cepat (untuk enrich phone yang kosong di absensi lama)
  const userMap = useMemo(() => {
    const m = new Map<string, AppUser>();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  // Helper: ambil phone — prioritas dari attendance, fallback dari users collection
  const getPhone = (att: Attendance): string => {
    if (att.userPhone && att.userPhone.trim() !== "") return att.userPhone;
    return userMap.get(att.userId)?.phone || "";
  };

  const filteredAttendances = useMemo(() => {
    return attendances.filter((att) => {
      if (filterUserId && att.userId !== filterUserId) return false;
      if (filterTeam && att.userTeam !== filterTeam) return false;
      if (filterStartDate && att.date < filterStartDate) return false;
      if (filterEndDate && att.date > filterEndDate) return false;
      return true;
    });
  }, [attendances, filterUserId, filterTeam, filterStartDate, filterEndDate]);

  // Enriched attendances (untuk display + export) — selalu punya userPhone terisi
  const enrichedFilteredAttendances = useMemo(() => {
    return filteredAttendances.map((att) => ({
      ...att,
      userPhone: getPhone(att),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredAttendances, userMap]);

  const hasActiveFilter = !!(filterUserId || filterTeam || filterStartDate || filterEndDate);
  const resetFilter = () => {
    setFilterUserId(""); setFilterTeam(""); setFilterStartDate(""); setFilterEndDate("");
  };

  // Modal popup foto Cloudinary
  const { photo, open: openPhoto, close: closePhoto } = usePhotoModal();

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const handleApproveUser = async (u: AppUser) => {
    try {
      await updateUser(u.id, { status: "active" });
      triggerSuccess(`Akun "${u.name}" disetujui!`);
    } catch (err: any) { alert(err.message); }
  };

  const handleApproveException = async (att: Attendance) => {
    try {
      const patch: Partial<Attendance> = {};
      if (att.clockInStatus === "pending_approval") patch.clockInStatus = "exception_approved";
      if (att.clockOutStatus === "pending_approval") patch.clockOutStatus = "exception_approved";
      await updateAttendance(att.id, patch);
      triggerSuccess("Ijin absen luar titik disetujui!");
    } catch (err: any) { alert(err.message); }
  };

  // Ijinkan pekerja pulang lebih awal sebelum jam pulang shift
  const handleApproveEarlyOut = async (att: Attendance) => {
    if (!confirm(`Ijinkan ${att.userName} untuk absen PULANG sekarang (lebih awal dari jam pulang shift)?`)) return;
    try {
      await updateAttendance(att.id, {
        earlyClockOutApproved: true,
        earlyClockOutApprovedBy: user.name,
      });
      triggerSuccess(`${att.userName} sudah boleh absen pulang lebih awal.`);
    } catch (err: any) { alert(err.message); }
  };

  const handleRevokeEarlyOut = async (att: Attendance) => {
    if (!confirm(`Batalkan ijin pulang awal untuk ${att.userName}?`)) return;
    try {
      await updateAttendance(att.id, {
        earlyClockOutApproved: false,
        earlyClockOutApprovedBy: "",
      });
      triggerSuccess(`Ijin pulang awal dibatalkan.`);
    } catch (err: any) { alert(err.message); }
  };

  // Reset hanya bagian PULANG
  const handleResetClockOut = async (att: Attendance) => {
    if (!confirm(`Reset absen PULANG untuk ${att.userName} tanggal ${att.date}?\n\nPekerja akan diminta foto pulang lagi.\nAbsen masuk TIDAK dihapus.`)) return;
    try {
      await resetClockOut(att.id);
      triggerSuccess(`Absen pulang ${att.userName} di-reset.`);
    } catch (err: any) { alert(err.message); }
  };

  // Hapus seluruh absensi (masuk + pulang)
  const handleResetAttendance = async (att: Attendance) => {
    if (!confirm(`HAPUS TOTAL absensi ${att.userName} tanggal ${att.date}?\n\nSeluruh data masuk + pulang akan dihapus.\nPekerja bisa absen masuk lagi dari awal.`)) return;
    try {
      await deleteAttendance(att.id);
      triggerSuccess(`Absensi ${att.userName} (${att.date}) dihapus.`);
    } catch (err: any) { alert(err.message); }
  };

  // Export Excel + Copy ke Spreadsheet
  const handleExportExcel = () => {
    const rows = buildAttendanceRows(enrichedFilteredAttendances, effectiveStatusOf);
    if (rows.length === 0) { alert("Tidak ada data absensi yang difilter."); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Absensi");
    XLSX.writeFile(wb, `Rekap_Absensi_Koordinator_${new Date().toISOString().split("T")[0]}.xlsx`);
    triggerSuccess("Excel diunduh.");
  };

  const handleCopyToSheets = async () => {
    const rows = buildAttendanceRows(enrichedFilteredAttendances, effectiveStatusOf);
    if (rows.length === 0) { alert("Tidak ada data untuk disalin."); return; }
    await copyRowsToClipboard(rows);
    const sheetUrl = appSettings.googleSpreadsheetUrl?.trim();
    if (sheetUrl) {
      if (confirm("Tabel disalin!\n\nBuka Google Spreadsheet yang sudah diatur Admin sekarang?")) {
        window.open(sheetUrl, "_blank", "noopener,noreferrer");
      }
    } else {
      alert("Tabel berhasil disalin! Buka Google Spreadsheet manual lalu Ctrl+V.\n💡 Tip: Admin bisa mengatur URL Spreadsheet di Pengaturan agar bisa dibuka otomatis.");
    }
  };

  // Report modal state
  const [reportUser, setReportUser] = useState<AppUser | null>(null);

  const handleEditNote = async (att: Attendance) => {
    const v = prompt("Catatan Koordinator (rujukan gaji):", att.koordinatorNote || "");
    if (v === null) return;
    try {
      await updateAttendance(att.id, { koordinatorNote: v });
      triggerSuccess("Catatan tersimpan");
    } catch (err: any) { alert(err.message); }
  };

  const pendingUsers = users.filter((u) => u.status === "pending");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
      {successMsg && (
        <div className="mb-6 p-4 bg-emerald-600 text-white font-semibold rounded-xl shadow-lg flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg("")}>✕</button>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">Dashboard Koordinator Lapangan</h2>
          <p className="text-sm text-slate-500">Sinkron real-time. Pantau kehadiran, setujui ijin luar titik, dan isi Catatan Koordinator.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold border border-emerald-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Tersinkron Firestore
        </span>
      </div>

      <div className="flex gap-2 mb-8 bg-slate-200 p-1.5 rounded-2xl w-fit">
        <button onClick={() => setActiveTab("attendance")} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${activeTab === "attendance" ? "bg-white text-blue-900 shadow-md" : "text-slate-600"}`}>
          <Clock className="w-4 h-4" /> <span>Absensi & Persetujuan ({attendances.length})</span>
        </button>
        <button onClick={() => setActiveTab("pending_users")} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${activeTab === "pending_users" ? "bg-white text-blue-900 shadow-md" : "text-slate-600"}`}>
          <UserCheck className="w-4 h-4" /> <span>Pekerja Baru ({pendingUsers.length})</span>
          {pendingUsers.length > 0 && <span className="w-2 h-2 rounded-full bg-red-500 animate-ping ml-1" />}
        </button>
      </div>

      {activeTab === "attendance" && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="font-bold text-lg text-slate-800">Kehadiran Harian & Pengajuan Ijin</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Menampilkan: <strong>{filteredAttendances.length}</strong> dari {attendances.length} absensi
                {" "}<span className="text-slate-400">(60 hari terakhir)</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasActiveFilter && (
                <button onClick={resetFilter} className="flex items-center gap-1.5 bg-red-100 text-red-700 hover:bg-red-200 font-bold text-xs px-3 py-2 rounded-xl">
                  <X className="w-3.5 h-3.5" /> <span>Reset Filter</span>
                </button>
              )}
              <button onClick={handleCopyToSheets} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm text-xs">
                <Copy className="w-3.5 h-3.5" /> <span>Salin (Sheets)</span>
              </button>
              <button onClick={handleExportExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm text-xs">
                <Download className="w-3.5 h-3.5" /> <span>Unduh Excel</span>
              </button>
            </div>
          </div>

          {/* FILTER BAR */}
          <div className="p-5 bg-white border-b border-slate-200 flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase mr-2">
              <Filter className="w-3.5 h-3.5" /> <span>Filter</span>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Nama Pekerja</label>
              <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium min-w-[180px]">
                <option value="">Semua Pekerja</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Tim Kerja</label>
              <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium min-w-[160px]">
                <option value="">Semua Tim</option>
                {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Tanggal Dari</label>
              <input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Sampai Dengan</label>
              <input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
                  <th className="py-3 px-4">Tanggal</th>
                  <th className="py-3 px-4">Nama Pekerja</th>
                  <th className="py-3 px-4">Jam Masuk</th>
                  <th className="py-3 px-4">Jam Pulang</th>
                  <th className="py-3 px-4">Status & Ijin</th>
                  <th className="py-3 px-4">Catatan Koordinator</th>
                  <th className="py-3 px-4 text-center">Status Gaji</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredAttendances.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-slate-400 font-medium">
                    {attendances.length === 0
                      ? "Belum ada data absensi."
                      : "Tidak ada absensi yang cocok dengan filter. Coba ubah/reset filter."}
                  </td></tr>
                ) : filteredAttendances.map((att) => {
                  const needsApproval = att.clockInStatus === "pending_approval" || att.clockOutStatus === "pending_approval";
                  return (
                    <tr key={att.id} className={`hover:bg-slate-50 ${needsApproval ? "bg-amber-50/60" : ""}`}>
                      <td className="py-3.5 px-4 font-semibold whitespace-nowrap">{att.date}</td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2.5">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm">
                            {att.userName?.charAt(0)?.toUpperCase() || <User className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 text-sm leading-tight">{att.userName}</div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">NIK: {att.userNik}</div>
                            {(() => {
                              const phone = getPhone(att);
                              if (!phone) return <div className="text-[11px] text-slate-400 italic mt-0.5">No HP belum diisi</div>;
                              return (
                                <a
                                  href={`https://wa.me/${phone.replace(/^0/, "62").replace(/[^0-9]/g, "")}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] text-emerald-700 hover:text-emerald-900 hover:underline font-semibold mt-0.5 inline-flex items-center gap-1"
                                  title={`Hubungi via WhatsApp: ${phone}`}
                                >
                                  📱 {phone}
                                </a>
                              );
                            })()}
                            <div className="text-[11px] mt-0.5">
                              <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-semibold">{att.userTeam || "-"}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2">
                          <PhotoThumb
                            url={att.clockInPhotoUrl}
                            caption={`Foto Masuk · ${att.userName}`}
                            subtitle={`${att.date} • ${att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID") : "-"} • ${att.clockInLocationLabel || ""}`}
                            openPhoto={openPhoto}
                          />
                          <div className="font-semibold whitespace-nowrap">
                            {att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2">
                          <PhotoThumb
                            url={att.clockOutPhotoUrl}
                            caption={`Foto Pulang · ${att.userName}`}
                            subtitle={`${att.date} • ${att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID") : "-"} • ${att.clockOutLocationLabel || ""}`}
                            openPhoto={openPhoto}
                          />
                          <div className="font-semibold whitespace-nowrap">
                            {att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="space-y-1.5">
                          <div>
                            {(() => {
                              const eff = effectiveStatusOf(att);
                              if (eff.status === "finish") return <span className="bg-emerald-500 text-white font-bold text-xs px-2 py-0.5 rounded">FINISH</span>;
                              if (eff.status === "tumbang") return <span className="bg-amber-500 text-white font-bold text-xs px-2 py-0.5 rounded">TUMBANG</span>;
                              if (eff.status === "auto_tumbang") return (
                                <span className="bg-orange-500 text-white font-bold text-xs px-2 py-0.5 rounded inline-flex items-center gap-1" title={eff.reason}>
                                  TUMBANG <span className="bg-white/25 text-[9px] px-1 py-0.5 rounded">AUTO</span>
                                </span>
                              );
                              return <span className="bg-blue-100 text-blue-800 font-bold text-xs px-2 py-0.5 rounded">Kerja</span>;
                            })()}
                          </div>
                          {needsApproval ? (
                            <div className="flex items-center gap-2">
                              <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded animate-pulse">Butuh Persetujuan</span>
                              <button onClick={() => handleApproveException(att)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-2.5 py-1 rounded">Setujui</button>
                            </div>
                          ) : (att.clockInStatus === "exception_approved" || att.clockOutStatus === "exception_approved") && (
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded">Ijin Luar Titik Disetujui ✓</span>
                          )}

                          {/* Ijin pulang awal (manual) */}
                          {att.workStatus === "absen_masuk" && !att.clockOutTime && (
                            att.earlyClockOutApproved ? (
                              <div className="flex items-center gap-1.5">
                                <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded">🕗 Boleh Pulang Awal ✓</span>
                                <button onClick={() => handleRevokeEarlyOut(att)} className="text-[10px] text-red-600 hover:underline font-semibold">Batal</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleApproveEarlyOut(att)}
                                className="bg-purple-100 hover:bg-purple-200 text-purple-800 font-bold text-[10px] px-2 py-1 rounded border border-purple-300"
                                title="Ijinkan pekerja absen pulang sebelum jam pulang shift"
                              >
                                🕗 Ijin Pulang Awal
                              </button>
                            )
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 max-w-sm">
                        <div className="bg-amber-50 text-amber-900 p-2.5 rounded-xl border border-amber-200 flex items-center justify-between gap-3">
                          <span className="italic text-xs">{att.koordinatorNote || "✎ Tulis catatan kelayakan gaji..."}</span>
                          <button onClick={() => handleEditNote(att)} className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg flex-shrink-0">Isi Catatan</button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {att.isPaid ? <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1 rounded-full">Terbayar ✓</span> : <span className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full">Belum</span>}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          {/* Report pekerja */}
                          {(() => {
                            const u = users.find((x) => x.id === att.userId);
                            return u ? (
                              <button
                                onClick={() => setReportUser(u)}
                                className="bg-indigo-100 text-indigo-800 hover:bg-indigo-200 p-1.5 rounded-lg"
                                title="Lihat Report Pekerja"
                              >
                                <FileText className="w-4 h-4" />
                              </button>
                            ) : null;
                          })()}
                          {att.clockOutTime && (
                            <button
                              onClick={() => handleResetClockOut(att)}
                              className="bg-purple-100 text-purple-800 hover:bg-purple-200 p-1.5 rounded-lg"
                              title="Reset absen PULANG - pekerja bisa foto pulang ulang"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleResetAttendance(att)}
                            className="bg-red-100 text-red-700 hover:bg-red-200 p-1.5 rounded-lg"
                            title="Hapus seluruh absensi - pekerja ulang dari awal"
                          >
                            <Eraser className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "pending_users" && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-lg text-slate-800">Persetujuan Akun Pekerja Baru</h3>
            <span className="text-xs bg-amber-100 text-amber-800 font-semibold px-3 py-1 rounded-full">{pendingUsers.length} Pending</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
                  <th className="py-3 px-4">Nama</th>
                  <th className="py-3 px-4">NIK</th>
                  <th className="py-3 px-4">Telepon</th>
                  <th className="py-3 px-4">Tim</th>
                  <th className="py-3 px-4 text-center">KTP</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {pendingUsers.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-slate-400 font-medium">Tidak ada pendaftar baru.</td></tr>
                ) : pendingUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-bold text-slate-900">{u.name}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">{u.nik}</td>
                    <td className="py-3.5 px-4">{u.phone || "-"}</td>
                    <td className="py-3.5 px-4"><span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg text-xs font-semibold">{u.team}</span></td>
                    <td className="py-3.5 px-4 text-center">
                      {u.ktpPhotoUrl ? (
                        <button type="button" onClick={() => openPhoto(u.ktpPhotoUrl, `KTP · ${u.name}`, `NIK ${u.nik}`)} className="text-blue-600 hover:underline font-semibold text-xs cursor-zoom-in">
                          Lihat 🖼️
                        </button>
                      ) : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button onClick={() => handleApproveUser(u)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-md flex items-center gap-1.5 ml-auto">
                        <CheckCircle className="w-4 h-4" /> <span>Setujui</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Popup foto Cloudinary */}
      <PhotoModal
        url={photo?.url || null}
        caption={photo?.caption}
        subtitle={photo?.subtitle}
        onClose={closePhoto}
      />

      {/* Report Modal Pekerja */}
      {reportUser && (
        <ReportModal
          user={reportUser}
          attendances={attendances}
          shifts={shifts}
          tumbangToleranceHours={tumbangToleranceHours}
          onClose={() => setReportUser(null)}
        />
      )}
    </div>
  );
}
