"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Users, FileSpreadsheet, MapPin, Clock, CheckCircle, AlertTriangle,
  Download, Copy, Plus, Trash2, Edit, XCircle, Settings, ExternalLink, Save,
  Tag, DollarSign, ClipboardList, RefreshCw, UserPlus, Upload, Loader2, Key, FileText, RotateCcw, Eraser,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  SessionUser, AppUser, WorkLocation, Shift, Attendance, AppSettings, Team, WageRate,
} from "@/lib/types";
import {
  subscribeUsers, subscribeLocations, subscribeShifts, subscribeAttendances,
  updateUser, deleteUser, createLocation, updateLocation, deleteLocation,
  createShift, updateShift, deleteShift, updateAttendance, ensureSeedData,
  subscribeAppSettings, updateAppSettings,
  subscribeTeams, createTeam, updateTeam, deleteTeam,
  subscribeWageRates, createWageRate, updateWageRate, deleteWageRate,
  createUser, findUserByNik, findUserByUsername,
  dateNDaysAgo, deleteUserCascade, countAttendancesForUser,
  deleteAttendance, resetClockOut,
} from "@/lib/firestore";
import { compressImage, uploadToCloudinary } from "@/lib/upload";
import { PhotoModal, PhotoThumb, usePhotoModal } from "./PhotoModal";
import { computeEffectiveStatus } from "@/lib/attendance-helpers";
import { ReportModal } from "./ReportModal";

interface AdminDashboardProps {
  user: SessionUser;
}

type TabKey =
  | "attendance"
  | "payroll"
  | "rekap_pekerja"
  | "users"
  | "teams"
  | "wagerates"
  | "locations"
  | "shifts"
  | "settings";

export function AdminDashboard({ user }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("attendance");

  const [users, setUsers] = useState<AppUser[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [wageRates, setWageRates] = useState<WageRate[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>({ googleSpreadsheetUrl: "", companyName: "PT. Bimantara Mitra Persada", updatedAt: 0 });
  const [sheetUrlDraft, setSheetUrlDraft] = useState("");
  const [tumbangToleranceDraft, setTumbangToleranceDraft] = useState("1");
  const [savingSettings, setSavingSettings] = useState(false);

  const [successMsg, setSuccessMsg] = useState("");

  // Filters (shared by Rekap Absensi & Payroll)
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");

  // Filter khusus Rekap Pekerja PHL (independen dari filter di atas)
  const [rpStartDate, setRpStartDate] = useState("");
  const [rpEndDate, setRpEndDate] = useState("");
  const [rpUserId, setRpUserId] = useState("");
  const [rpTeam, setRpTeam] = useState("");
  const [rpStatus, setRpStatus] = useState<"" | "active" | "pending" | "inactive">("");

  // Modals
  const [showLocModal, setShowLocModal] = useState(false);
  const [locForm, setLocForm] = useState({ id: "", name: "", latitude: "", longitude: "", radius: "50", isDefault: false });

  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftForm, setShiftForm] = useState({ id: "", name: "", startTime: "07:00", endTime: "16:00", lateToleranceMinutes: "30", rolloverNextDay: false, isDefault: false });

  const [showUserModal, setShowUserModal] = useState(false);
  const [userForm, setUserForm] = useState({
    id: "", name: "", phone: "", team: "", dailyWage: "100000",
    newPassword: "", currentPassword: "", role: "pekerja" as "pekerja" | "koordinator",
  });

  // Tambah karyawan baru (oleh admin) — bedanya dengan pendaftaran publik:
  //   - role bisa pekerja atau koordinator
  //   - status langsung "active" (tidak perlu pending)
  //   - foto KTP opsional (admin biasanya tambahkan duluan, KTP belakangan)
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [addUserForm, setAddUserForm] = useState({
    role: "pekerja" as "pekerja" | "koordinator",
    name: "", nik: "", phone: "", team: "", password: "",
    dailyWage: "100000", ktpPreview: "",
  });
  const [addUserLoading, setAddUserLoading] = useState(false);

  // Report modal state — tampilkan ringkasan kehadiran 1 pekerja
  const [reportUser, setReportUser] = useState<AppUser | null>(null);

  const [showWageRateModal, setShowWageRateModal] = useState(false);
  const [wageRateForm, setWageRateForm] = useState({ id: "", startDate: "", endDate: "", amount: "100000", appliesToTeam: "", note: "" });

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  // Modal popup foto Cloudinary
  const { photo, open: openPhoto, close: closePhoto } = usePhotoModal();

  // Ticking clock setiap menit untuk auto-recompute status TUMBANG otomatis
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Helper: hitung status efektif (termasuk auto-tumbang)
  const tumbangToleranceHours = appSettings.autoTumbangToleranceHours ?? 1;
  const effectiveStatusOf = (att: Attendance) =>
    computeEffectiveStatus(att, shifts, tumbangToleranceHours, nowMs);

  // Default: hanya muat absensi 90 hari terakhir (hemat baca Firestore).
  // Admin bisa toggle ke "Semua Waktu" untuk rekap bulanan/tahunan.
  const [loadAllHistory, setLoadAllHistory] = useState(false);

  // ------- Subscriptions ---------------------------------------------------
  useEffect(() => {
    ensureSeedData().catch(console.error);
    const sinceDate = loadAllHistory ? undefined : dateNDaysAgo(90);
    const subs = [
      subscribeUsers((list) => setUsers(list.filter((u) => u.username !== "adminbimantara"))),
      subscribeLocations(setLocations),
      subscribeShifts(setShifts),
      subscribeAttendances(setAttendances, undefined, sinceDate),
      subscribeTeams(setTeams),
      subscribeWageRates(setWageRates),
      subscribeAppSettings((s) => {
        setAppSettings(s);
        setSheetUrlDraft(s.googleSpreadsheetUrl || "");
        setTumbangToleranceDraft(String(s.autoTumbangToleranceHours ?? 1));
      }),
    ];
    return () => subs.forEach((u) => u());
  }, [loadAllHistory]);

  const pekerjaUsers = useMemo(() => users.filter((u) => u.role === "pekerja"), [users]);

  // ------- Settings --------------------------------------------------------
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const trimmed = sheetUrlDraft.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed)) {
        throw new Error("URL harus diawali http:// atau https://");
      }
      const tolerance = Number(tumbangToleranceDraft);
      if (!isFinite(tolerance) || tolerance < 0 || tolerance > 24) {
        throw new Error("Toleransi auto-tumbang harus antara 0 - 24 jam");
      }
      await updateAppSettings({
        googleSpreadsheetUrl: trimmed,
        autoTumbangToleranceHours: tolerance,
      });
      triggerSuccess("Pengaturan tersimpan");
    } catch (err: any) { alert(err.message); }
    finally { setSavingSettings(false); }
  };

  // ------- User actions ----------------------------------------------------
  const handleUserStatusChange = async (id: string, status: AppUser["status"]) => {
    try {
      await updateUser(id, { status });
      triggerSuccess(`Status pekerja diubah → ${status}`);
    } catch (err: any) { alert(err.message); }
  };

  const openUserEdit = (u: AppUser) => {
    setUserForm({
      id: u.id,
      name: u.name,
      phone: u.phone || "",
      team: u.team || "",
      dailyWage: String(u.dailyWage || 100000),
      newPassword: "",
      currentPassword: u.password || "",
      role: (u.role === "koordinator" ? "koordinator" : "pekerja"),
    });
    setShowUserModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const patch: Partial<AppUser> = {
        name: userForm.name.trim(),
        phone: userForm.phone.trim(),
        team: userForm.team.trim(),
        dailyWage: Number(userForm.dailyWage) || 0,
      };

      // Update password kalau diisi
      const newPwd = userForm.newPassword.trim();
      if (newPwd) {
        if (newPwd.length < 4) throw new Error("Sandi baru minimal 4 karakter");
        patch.password = newPwd;
      }

      await updateUser(userForm.id, patch);
      triggerSuccess(newPwd ? "Data & sandi pekerja diperbarui" : "Data pekerja diperbarui");
      setShowUserModal(false);
    } catch (err: any) { alert(err.message); }
  };

  const handleResetPasswordQuick = async (u: AppUser) => {
    const newPwd = prompt(`Sandi BARU untuk "${u.name}" (min 4 karakter):`, "");
    if (newPwd === null) return;
    const trimmed = newPwd.trim();
    if (trimmed.length < 4) return alert("Sandi minimal 4 karakter");
    try {
      await updateUser(u.id, { password: trimmed });
      triggerSuccess(`Sandi "${u.name}" berhasil diubah menjadi "${trimmed}"`);
    } catch (err: any) { alert(err.message); }
  };

  const openAddUserModal = () => {
    setAddUserForm({
      role: "pekerja",
      name: "", nik: "", phone: "",
      team: teams[0]?.name || "",
      password: "", dailyWage: "100000", ktpPreview: "",
    });
    setShowAddUserModal(true);
  };

  const handleAddUserPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    try {
      const compressed = await compressImage(e.target.files[0], 800, 0.7);
      setAddUserForm((f) => ({ ...f, ktpPreview: compressed }));
    } catch { alert("Gagal mengompres foto."); }
  };

  const handleSaveNewUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddUserLoading(true);
    try {
      const name = addUserForm.name.trim();
      const nik = addUserForm.nik.trim();
      const phone = addUserForm.phone.trim();
      const team = addUserForm.team.trim();
      const password = addUserForm.password;

      if (!name) throw new Error("Nama wajib diisi");
      if (!nik || nik.length < 10) throw new Error("NIK tidak valid (minimal 10 digit)");
      if (!phone) throw new Error("Nomor telepon wajib diisi");
      if (!password || password.length < 4) throw new Error("Sandi minimal 4 karakter");
      if (addUserForm.role === "pekerja" && !team) throw new Error("Tim wajib dipilih untuk pekerja");

      // Cek duplikasi NIK / username
      const dupNik = await findUserByNik(nik);
      const dupUsername = await findUserByUsername(nik);
      if (dupNik || dupUsername) throw new Error("NIK / Username sudah terdaftar");

      // Upload KTP (opsional)
      let ktpPhotoUrl = "";
      if (addUserForm.ktpPreview) {
        ktpPhotoUrl = await uploadToCloudinary(addUserForm.ktpPreview, "absensi-phl/ktp");
      }

      await createUser({
        role: addUserForm.role,
        username: nik,
        password,
        name,
        nik,
        phone,
        team: addUserForm.role === "koordinator" ? (team || "Koordinator") : team,
        ktpPhotoUrl,
        status: "active", // langsung aktif karena ditambah oleh admin
        dailyWage: addUserForm.role === "koordinator" ? 0 : (Number(addUserForm.dailyWage) || 0),
      });

      triggerSuccess(`Akun ${addUserForm.role === "pekerja" ? "pekerja" : "koordinator"} "${name}" berhasil ditambahkan & aktif`);
      setShowAddUserModal(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAddUserLoading(false);
    }
  };

  const handleDeleteUser = async (u: AppUser) => {
    // Hitung dulu jumlah absensi terkait pekerja ini
    let attCount = 0;
    try { attCount = await countAttendancesForUser(u.id); } catch {}

    if (attCount === 0) {
      // Tidak ada absensi → hapus langsung saja
      if (!confirm(`Hapus akun "${u.name}"?\n\nAkun ini belum memiliki riwayat absensi.`)) return;
      try {
        await deleteUser(u.id);
        triggerSuccess(`Akun "${u.name}" dihapus permanen dari Firestore.`);
      } catch (err: any) { alert(err.message); }
      return;
    }

    // Ada absensi → tawarkan dua opsi
    const choice = prompt(
      `⚠️ PERHATIAN: Pekerja "${u.name}" memiliki ${attCount} riwayat absensi.\n\n` +
      `Ketik salah satu pilihan:\n\n` +
      `1 = HAPUS AKUN SAJA (riwayat absensi tetap tersimpan untuk rekap historis)\n` +
      `2 = HAPUS TOTAL (akun + SELURUH ${attCount} riwayat absensi - tidak dapat dikembalikan!)\n\n` +
      `Ketik angka 1 atau 2, atau batal untuk tidak menghapus:`,
      "1"
    );

    if (choice === null) return;
    const opt = choice.trim();

    if (opt === "1") {
      try {
        await deleteUser(u.id);
        triggerSuccess(`Akun "${u.name}" dihapus dari Firestore. ${attCount} riwayat absensi tetap tersimpan.`);
      } catch (err: any) { alert(err.message); }
    } else if (opt === "2") {
      if (!confirm(`KONFIRMASI AKHIR:\n\nIni akan menghapus PERMANEN dari Firestore:\n- 1 akun "${u.name}"\n- ${attCount} dokumen absensi\n\n⚠️ Foto-foto di Cloudinary TIDAK ikut terhapus (harus manual dari Cloudinary Console).\n\nLanjutkan?`)) return;
      try {
        const result = await deleteUserCascade(u.id);
        triggerSuccess(`✅ Hapus total selesai: 1 akun + ${result.deletedAttendances} absensi dihapus dari Firestore.`);
      } catch (err: any) { alert(err.message); }
    } else {
      alert(`Pilihan "${opt}" tidak dikenali. Penghapusan dibatalkan.`);
    }
  };

  // ------- Team actions ----------------------------------------------------
  const handleAddTeam = async () => {
    const v = prompt("Nama Tim baru:");
    if (!v) return;
    try { await createTeam(v); triggerSuccess("Tim ditambahkan"); }
    catch (err: any) { alert(err.message); }
  };

  const handleEditTeam = async (t: Team) => {
    const v = prompt("Ubah nama Tim:", t.name);
    if (!v || v === t.name) return;
    try {
      await updateTeam(t.id, v, t.name);
      triggerSuccess("Tim diperbarui (data pekerja terkait ikut disesuaikan)");
    } catch (err: any) { alert(err.message); }
  };

  const handleDeleteTeam = async (t: Team) => {
    const count = pekerjaUsers.filter((u) => u.team === t.name).length;
    if (count > 0 && !confirm(`Ada ${count} pekerja yang menggunakan tim "${t.name}". Tetap hapus?`)) return;
    if (count === 0 && !confirm(`Hapus tim "${t.name}"?`)) return;
    try { await deleteTeam(t.id); triggerSuccess("Tim dihapus"); }
    catch (err: any) { alert(err.message); }
  };

  // ------- WageRate actions ------------------------------------------------
  const openWageRateNew = () => {
    const today = new Date().toISOString().split("T")[0];
    setWageRateForm({ id: "", startDate: today, endDate: today, amount: "100000", appliesToTeam: "", note: "" });
    setShowWageRateModal(true);
  };

  const openWageRateEdit = (r: WageRate) => {
    setWageRateForm({
      id: r.id,
      startDate: r.startDate || r.date || "",
      endDate: r.endDate || r.date || r.startDate || "",
      amount: String(r.amount),
      appliesToTeam: r.appliesToTeam || "",
      note: r.note || "",
    });
    setShowWageRateModal(true);
  };

  const handleSaveWageRate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const startDate = wageRateForm.startDate;
      const endDate = wageRateForm.endDate || wageRateForm.startDate;
      if (!startDate) throw new Error("Tanggal mulai wajib diisi");
      if (endDate < startDate) throw new Error("Tanggal selesai tidak boleh sebelum tanggal mulai");
      const amount = Number(wageRateForm.amount) || 0;
      if (amount <= 0) throw new Error("Nominal tarif harus > 0");

      const payload: any = {
        startDate,
        endDate,
        date: startDate, // keep legacy field for backward compatibility
        amount,
        note: wageRateForm.note.trim(),
      };
      if (wageRateForm.appliesToTeam) payload.appliesToTeam = wageRateForm.appliesToTeam;

      if (wageRateForm.id) await updateWageRate(wageRateForm.id, payload);
      else await createWageRate(payload);
      triggerSuccess("Tarif tanggal tersimpan");
      setShowWageRateModal(false);
    } catch (err: any) { alert(err.message); }
  };

  const handleDeleteWageRate = async (r: WageRate) => {
    if (!confirm(`Hapus tarif khusus tanggal ${r.date}?`)) return;
    try { await deleteWageRate(r.id); triggerSuccess("Tarif dihapus"); }
    catch (err: any) { alert(err.message); }
  };

  // ------- Location actions ------------------------------------------------
  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: locForm.name,
        latitude: Number(locForm.latitude),
        longitude: Number(locForm.longitude),
        radius: Number(locForm.radius),
        isDefault: locForm.isDefault,
      };
      if (locForm.id) await updateLocation(locForm.id, payload);
      else await createLocation(payload);
      triggerSuccess("Lokasi tersimpan");
      setShowLocModal(false);
    } catch (err: any) { alert(err.message); }
  };

  const handleDeleteLocation = async (loc: WorkLocation) => {
    if (!confirm(`Hapus lokasi "${loc.name}"?`)) return;
    try { await deleteLocation(loc.id); triggerSuccess("Lokasi dihapus"); }
    catch (err: any) { alert(err.message); }
  };

  // ------- Shift actions ---------------------------------------------------
  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: shiftForm.name,
        startTime: shiftForm.startTime,
        endTime: shiftForm.endTime,
        lateToleranceMinutes: Number(shiftForm.lateToleranceMinutes),
        rolloverNextDay: !!shiftForm.rolloverNextDay,
        isDefault: shiftForm.isDefault,
      };
      if (shiftForm.id) await updateShift(shiftForm.id, payload);
      else await createShift(payload);
      triggerSuccess("Shift tersimpan");
      setShowShiftModal(false);
    } catch (err: any) { alert(err.message); }
  };

  const handleDeleteShift = async (s: Shift) => {
    if (!confirm(`Hapus shift "${s.name}"?`)) return;
    try { await deleteShift(s.id); triggerSuccess("Shift dihapus"); }
    catch (err: any) { alert(err.message); }
  };

  // ------- Attendance actions ----------------------------------------------
  const handleTogglePaid = async (att: Attendance) => {
    try {
      const isPaid = !att.isPaid;
      await updateAttendance(att.id, {
        isPaid,
        paidDate: isPaid ? Date.now() : null,
        paidBy: isPaid ? user.name : "",
      });
      triggerSuccess(`Status gaji → ${isPaid ? "Terbayar" : "Belum Terbayar"}`);
    } catch (err: any) { alert(err.message); }
  };

  const handleEditKoordNote = async (att: Attendance) => {
    const v = prompt("Catatan Koordinator untuk absensi ini:", att.koordinatorNote || "");
    if (v === null) return;
    try {
      await updateAttendance(att.id, { koordinatorNote: v });
      triggerSuccess("Catatan tersimpan");
    } catch (err: any) { alert(err.message); }
  };

  const handleApproveException = async (att: Attendance) => {
    try {
      const patch: Partial<Attendance> = {};
      if (att.clockInStatus === "pending_approval") patch.clockInStatus = "exception_approved";
      if (att.clockOutStatus === "pending_approval") patch.clockOutStatus = "exception_approved";
      await updateAttendance(att.id, patch);
      triggerSuccess("Ijin luar titik disetujui");
    } catch (err: any) { alert(err.message); }
  };

  // Reset hanya bagian PULANG → pekerja boleh absen pulang ulang
  const handleResetClockOut = async (att: Attendance) => {
    if (!confirm(`Reset absen PULANG untuk ${att.userName} tanggal ${att.date}?\n\nPekerja akan diminta foto pulang lagi.\nAbsen masuk TIDAK dihapus.`)) return;
    try {
      await resetClockOut(att.id);
      triggerSuccess(`Absen pulang ${att.userName} di-reset. Pekerja bisa absen pulang ulang.`);
    } catch (err: any) { alert(err.message); }
  };

  // Hapus seluruh absensi (masuk + pulang) → pekerja boleh ulang dari awal
  const handleResetAttendance = async (att: Attendance) => {
    if (!confirm(`HAPUS TOTAL absensi ${att.userName} tanggal ${att.date}?\n\nSeluruh data masuk + pulang akan dihapus.\nPekerja bisa absen masuk lagi dari awal.\n\nFoto di Cloudinary tidak ikut terhapus.`)) return;
    try {
      await deleteAttendance(att.id);
      triggerSuccess(`Absensi ${att.userName} (${att.date}) dihapus. Pekerja bisa mulai ulang.`);
    } catch (err: any) { alert(err.message); }
  };

  // ------- Filters ---------------------------------------------------------
  // Enrich attendances dengan phone dari users (fallback untuk absensi lama yang phone-nya kosong)
  const userPhoneMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => { if (u.phone) m.set(u.id, u.phone); });
    return m;
  }, [users]);

  const filteredAttendances = useMemo(() => {
    return attendances
      .filter((att) => {
        if (selectedUserId && att.userId !== selectedUserId) return false;
        if (selectedTeam && att.userTeam !== selectedTeam) return false;
        if (startDate && att.date < startDate) return false;
        if (endDate && att.date > endDate) return false;
        return true;
      })
      .map((att) => ({
        ...att,
        userPhone: att.userPhone && att.userPhone.trim() !== "" ? att.userPhone : (userPhoneMap.get(att.userId) || ""),
      }));
  }, [attendances, selectedUserId, selectedTeam, startDate, endDate, userPhoneMap]);

  // ------- Export helpers --------------------------------------------------
  // Label status kerja dengan auto-tumbang sudah diperhitungkan
  const statusKerjaLabel = (att: Attendance): string => {
    const eff = effectiveStatusOf(att);
    if (eff.status === "finish") return "FINISH";
    if (eff.status === "tumbang") return "TUMBANG";
    if (eff.status === "auto_tumbang") return "TUMBANG (otomatis - tidak absen pulang)";
    return "BELUM SELESAI";
  };

  const buildRekapRows = () => filteredAttendances.map((att, i) => ({
    No: i + 1,
    Nama: att.userName,
    NIK: att.userNik,
    "No Telepon": att.userPhone || "-",
    Tim: att.userTeam || "-",
    Tanggal: att.date,
    "Shift Kerja": att.shiftName || "-",
    "Lokasi Kerja": att.locationName || "-",
    "Jam Masuk": att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID") : "-",
    "Lokasi Masuk": att.clockInLocationLabel || "-",
    "Link Foto Masuk": att.clockInPhotoUrl || "-",
    "Keterangan Masuk": att.clockInNotes || "-",
    "Status Masuk": att.clockInStatus || "-",
    "Jam Pulang": att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID") : "-",
    "Lokasi Pulang": att.clockOutLocationLabel || "-",
    "Link Foto Pulang": att.clockOutPhotoUrl || "-",
    "Keterangan Pulang": att.clockOutNotes || "-",
    "Status Pulang": att.clockOutStatus || "-",
    "Status Kerja": statusKerjaLabel(att),
    "Catatan Koordinator": att.koordinatorNote || "-",
    "Tarif Hari Itu": att.wageAmount || 0,
    "Status Gaji": att.isPaid ? `Terbayar (${att.paidBy || "-"})` : "Belum Terbayar",
  }));

  const buildPayrollRows = () => filteredAttendances.map((att, i) => ({
    No: i + 1,
    Nama: att.userName,
    NIK: att.userNik,
    Tim: att.userTeam || "-",
    Tanggal: att.date,
    "Jam Masuk": att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID") : "-",
    "Foto Masuk": att.clockInPhotoUrl || "-",
    "Jam Pulang": att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID") : "-",
    "Foto Pulang": att.clockOutPhotoUrl || "-",
    "Status Kerja": statusKerjaLabel(att),
    "Catatan Koordinator": att.koordinatorNote || "-",
    "Nominal Gaji": att.wageAmount || 0,
    "Status Bayar": att.isPaid ? "TERBAYAR" : "BELUM",
    "Dibayar Oleh": att.paidBy || "-",
    "Tanggal Bayar": att.paidDate ? new Date(att.paidDate).toLocaleDateString("id-ID") : "-",
  }));

  const exportRekapExcel = () => {
    const rows = buildRekapRows();
    if (rows.length === 0) { alert("Tidak ada data untuk diekspor."); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Absensi");
    XLSX.writeFile(wb, `Rekap_Absensi_PHL_${new Date().toISOString().split("T")[0]}.xlsx`);
    triggerSuccess("File Excel diunduh.");
  };

  const exportPayrollExcel = () => {
    const rows = buildPayrollRows();
    if (rows.length === 0) { alert("Tidak ada data untuk diekspor."); return; }

    // Sheet 1: Detail per absensi
    const wsDetail = XLSX.utils.json_to_sheet(rows);

    // Sheet 2: Ringkasan per Pekerja
    const summaryByName = new Map<string, { Nama: string; NIK: string; Tim: string; "Hari Hadir": number; FINISH: number; TUMBANG: number; "Total Gaji": number; "Sudah Dibayar": number; "Belum Dibayar": number }>();
    filteredAttendances.forEach((att) => {
      const key = `${att.userId}`;
      const prev = summaryByName.get(key) || {
        Nama: att.userName, NIK: att.userNik, Tim: att.userTeam || "-",
        "Hari Hadir": 0, FINISH: 0, TUMBANG: 0, "Total Gaji": 0, "Sudah Dibayar": 0, "Belum Dibayar": 0,
      };
      prev["Hari Hadir"] += 1;
      const effS = effectiveStatusOf(att).status;
      if (effS === "finish") prev.FINISH += 1;
      if (effS === "tumbang" || effS === "auto_tumbang") prev.TUMBANG += 1;
      const w = att.wageAmount || 0;
      prev["Total Gaji"] += w;
      if (att.isPaid) prev["Sudah Dibayar"] += w; else prev["Belum Dibayar"] += w;
      summaryByName.set(key, prev);
    });
    const wsByName = XLSX.utils.json_to_sheet(Array.from(summaryByName.values()));

    // Sheet 3: Ringkasan per Tim
    const summaryByTeam = new Map<string, { Tim: string; "Hari Hadir": number; "Total Gaji": number; "Sudah Dibayar": number; "Belum Dibayar": number }>();
    filteredAttendances.forEach((att) => {
      const key = att.userTeam || "-";
      const prev = summaryByTeam.get(key) || { Tim: key, "Hari Hadir": 0, "Total Gaji": 0, "Sudah Dibayar": 0, "Belum Dibayar": 0 };
      prev["Hari Hadir"] += 1;
      const w = att.wageAmount || 0;
      prev["Total Gaji"] += w;
      if (att.isPaid) prev["Sudah Dibayar"] += w; else prev["Belum Dibayar"] += w;
      summaryByTeam.set(key, prev);
    });
    const wsByTeam = XLSX.utils.json_to_sheet(Array.from(summaryByTeam.values()));

    // Sheet 4: Ringkasan per Tanggal
    const summaryByDate = new Map<string, { Tanggal: string; "Jumlah Pekerja": number; "Total Gaji": number; "Sudah Dibayar": number; "Belum Dibayar": number }>();
    filteredAttendances.forEach((att) => {
      const key = att.date;
      const prev = summaryByDate.get(key) || { Tanggal: key, "Jumlah Pekerja": 0, "Total Gaji": 0, "Sudah Dibayar": 0, "Belum Dibayar": 0 };
      prev["Jumlah Pekerja"] += 1;
      const w = att.wageAmount || 0;
      prev["Total Gaji"] += w;
      if (att.isPaid) prev["Sudah Dibayar"] += w; else prev["Belum Dibayar"] += w;
      summaryByDate.set(key, prev);
    });
    const wsByDate = XLSX.utils.json_to_sheet(Array.from(summaryByDate.values()).sort((a, b) => a.Tanggal.localeCompare(b.Tanggal)));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsDetail, "Detail Penggajian");
    XLSX.utils.book_append_sheet(wb, wsByName, "Ringkasan per Pekerja");
    XLSX.utils.book_append_sheet(wb, wsByTeam, "Ringkasan per Tim");
    XLSX.utils.book_append_sheet(wb, wsByDate, "Ringkasan per Tanggal");

    XLSX.writeFile(wb, `Rekap_Penggajian_PHL_${new Date().toISOString().split("T")[0]}.xlsx`);
    triggerSuccess("File Excel penggajian diunduh dengan 4 sheet ringkasan!");
  };

  const copySpreadsheetFormat = async (rows: any[]) => {
    if (rows.length === 0) { alert("Tidak ada data untuk disalin."); return; }
    const headers = Object.keys(rows[0]).join("\t");
    const data = rows.map((r) => Object.values(r).join("\t")).join("\n");
    await navigator.clipboard.writeText(`${headers}\n${data}`);
    const sheetUrl = appSettings.googleSpreadsheetUrl?.trim();
    if (sheetUrl) {
      if (confirm("Tabel berhasil disalin!\n\nBuka Google Spreadsheet yang sudah diatur sekarang?")) {
        window.open(sheetUrl, "_blank", "noopener,noreferrer");
      }
    } else {
      alert("Tabel berhasil disalin! Buka Spreadsheet manual lalu Ctrl+V.\n💡 Atur URL di tab Pengaturan.");
    }
  };

  // ------- Payroll aggregations (for table view) ---------------------------
  // Rekap Pekerja PHL — semua data pekerja PHL + akumulasi absensi (semua, tidak terikat filter)
  const rekapPekerjaPHL = useMemo(() => {
    // Filter pekerja sesuai filter di tab Rekap Pekerja PHL
    let filteredUsers = pekerjaUsers;
    if (rpUserId) filteredUsers = filteredUsers.filter((u) => u.id === rpUserId);
    if (rpTeam) filteredUsers = filteredUsers.filter((u) => u.team === rpTeam);
    if (rpStatus) filteredUsers = filteredUsers.filter((u) => u.status === rpStatus);

    return filteredUsers.map((u) => {
      // Filter absensi user ini berdasarkan range tanggal
      let ua = attendances.filter((a) => a.userId === u.id);
      if (rpStartDate) ua = ua.filter((a) => a.date >= rpStartDate);
      if (rpEndDate) ua = ua.filter((a) => a.date <= rpEndDate);

      const hariHadir = ua.length;
      // Akumulasi dengan auto-tumbang dihitung sebagai TUMBANG
      const finish = ua.filter((a) => effectiveStatusOf(a).status === "finish").length;
      const tumbang = ua.filter((a) => {
        const s = effectiveStatusOf(a).status;
        return s === "tumbang" || s === "auto_tumbang";
      }).length;
      const sedangKerja = ua.filter((a) => effectiveStatusOf(a).status === "absen_masuk").length;
      const totalGaji = ua.reduce((s, a) => s + (a.wageAmount || 0), 0);
      const sudahDibayar = ua.filter((a) => a.isPaid).reduce((s, a) => s + (a.wageAmount || 0), 0);
      const belumDibayar = totalGaji - sudahDibayar;
      const lastDate = ua.length > 0 ? ua.map((a) => a.date).sort().slice(-1)[0] : null;
      const pendingApproval = ua.filter((a) => a.clockInStatus === "pending_approval" || a.clockOutStatus === "pending_approval").length;
      return {
        user: u,
        hariHadir, finish, tumbang, sedangKerja,
        totalGaji, sudahDibayar, belumDibayar,
        lastDate, pendingApproval,
      };
    }).sort((a, b) => a.user.name.localeCompare(b.user.name));
  }, [pekerjaUsers, attendances, rpUserId, rpTeam, rpStatus, rpStartDate, rpEndDate]);

  const exportRekapPekerjaExcel = () => {
    if (rekapPekerjaPHL.length === 0) { alert("Tidak ada pekerja."); return; }
    const rows = rekapPekerjaPHL.map((r, i) => ({
      No: i + 1,
      Nama: r.user.name,
      NIK: r.user.nik,
      "No Telepon": r.user.phone || "-",
      Tim: r.user.team || "-",
      Status: r.user.status === "active" ? "Aktif" : r.user.status === "pending" ? "Pending" : "Nonaktif",
      "Tarif Default": r.user.dailyWage || 0,
      "Hari Hadir": r.hariHadir,
      FINISH: r.finish,
      TUMBANG: r.tumbang,
      "Sedang Kerja": r.sedangKerja,
      "Pending Persetujuan": r.pendingApproval,
      "Tanggal Absen Terakhir": r.lastDate || "-",
      "Total Gaji": r.totalGaji,
      "Sudah Dibayar": r.sudahDibayar,
      "Belum Dibayar": r.belumDibayar,
      "Tanggal Daftar": new Date(r.user.createdAt).toLocaleDateString("id-ID"),
      "Link Foto KTP": r.user.ktpPhotoUrl || "-",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Pekerja PHL");
    XLSX.writeFile(wb, `Rekap_Pekerja_PHL_${new Date().toISOString().split("T")[0]}.xlsx`);
    triggerSuccess("Excel pekerja PHL diunduh.");
  };

  const payrollByWorker = useMemo(() => {
    const map = new Map<string, { user: { id: string; name: string; nik: string; team: string }; hari: number; finish: number; tumbang: number; total: number; paid: number; unpaid: number }>();
    filteredAttendances.forEach((att) => {
      const k = att.userId;
      const prev = map.get(k) || { user: { id: att.userId, name: att.userName, nik: att.userNik, team: att.userTeam || "-" }, hari: 0, finish: 0, tumbang: 0, total: 0, paid: 0, unpaid: 0 };
      prev.hari += 1;
      const effS = effectiveStatusOf(att).status;
      if (effS === "finish") prev.finish += 1;
      if (effS === "tumbang" || effS === "auto_tumbang") prev.tumbang += 1;
      const w = att.wageAmount || 0;
      prev.total += w;
      if (att.isPaid) prev.paid += w; else prev.unpaid += w;
      map.set(k, prev);
    });
    return Array.from(map.values()).sort((a, b) => a.user.name.localeCompare(b.user.name));
  }, [filteredAttendances]);

  const payrollByTeam = useMemo(() => {
    const map = new Map<string, { team: string; hari: number; total: number; paid: number; unpaid: number }>();
    filteredAttendances.forEach((att) => {
      const k = att.userTeam || "-";
      const prev = map.get(k) || { team: k, hari: 0, total: 0, paid: 0, unpaid: 0 };
      prev.hari += 1;
      const w = att.wageAmount || 0;
      prev.total += w;
      if (att.isPaid) prev.paid += w; else prev.unpaid += w;
      map.set(k, prev);
    });
    return Array.from(map.values()).sort((a, b) => a.team.localeCompare(b.team));
  }, [filteredAttendances]);

  const payrollByDate = useMemo(() => {
    const map = new Map<string, { date: string; jumlah: number; total: number; paid: number; unpaid: number }>();
    filteredAttendances.forEach((att) => {
      const k = att.date;
      const prev = map.get(k) || { date: k, jumlah: 0, total: 0, paid: 0, unpaid: 0 };
      prev.jumlah += 1;
      const w = att.wageAmount || 0;
      prev.total += w;
      if (att.isPaid) prev.paid += w; else prev.unpaid += w;
      map.set(k, prev);
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredAttendances]);

  const totalGajiAll = filteredAttendances.reduce((s, a) => s + (a.wageAmount || 0), 0);
  const totalPaid = filteredAttendances.filter((a) => a.isPaid).reduce((s, a) => s + (a.wageAmount || 0), 0);
  const totalUnpaid = totalGajiAll - totalPaid;

  // -------------------------------------------------------------------------

  const tabs: { key: TabKey; label: string; icon: any; badge?: number }[] = [
    { key: "attendance", label: "Rekap Absensi", icon: FileSpreadsheet, badge: attendances.length },
    { key: "rekap_pekerja", label: "Rekap Pekerja PHL", icon: Users, badge: pekerjaUsers.length },
    { key: "payroll", label: "Rekap Penggajian", icon: DollarSign },
    { key: "users", label: "Manajemen Akun", icon: Users, badge: users.length },
    { key: "teams", label: "Tim Kerja", icon: Tag, badge: teams.length },
    { key: "wagerates", label: "Tarif Tanggal", icon: ClipboardList, badge: wageRates.length },
    { key: "locations", label: "Titik Lokasi", icon: MapPin, badge: locations.length },
    { key: "shifts", label: "Shift Kerja", icon: Clock, badge: shifts.length },
    { key: "settings", label: "Pengaturan", icon: Settings },
  ];

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
          <h2 className="text-2xl font-extrabold text-slate-800">Dashboard Super Admin</h2>
          <p className="text-sm text-slate-500">Kelola pekerja, tim, tarif tanggal, lokasi, shift, rekap absensi & penggajian.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setLoadAllHistory((v) => !v)}
            title="Default hanya muat 90 hari terakhir untuk hemat kuota Firestore. Klik untuk muat semua."
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
              loadAllHistory
                ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                : "bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100"
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{loadAllHistory ? `Semua Riwayat (${attendances.length})` : `90 Hari Terakhir (${attendances.length})`}</span>
          </button>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Tersinkron Firestore
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-8 bg-slate-200 p-1.5 rounded-2xl">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
              activeTab === tab.key ? "bg-white text-blue-900 shadow-md" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.key ? "bg-blue-100 text-blue-800" : "bg-slate-300 text-slate-700"}`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ====================== TAB: REKAP ABSENSI ===================== */}
      {activeTab === "attendance" && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-4">
            <FilterBar
              users={pekerjaUsers}
              teams={teams}
              selectedUserId={selectedUserId} setSelectedUserId={setSelectedUserId}
              selectedTeam={selectedTeam} setSelectedTeam={setSelectedTeam}
              startDate={startDate} setStartDate={setStartDate}
              endDate={endDate} setEndDate={setEndDate}
            />

            <div className="flex items-center gap-3">
              <button onClick={() => copySpreadsheetFormat(buildRekapRows())} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-md text-sm">
                <Copy className="w-4 h-4" /> <span>Salin (Sheets)</span>
              </button>
              <button onClick={exportRekapExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-md text-sm">
                <Download className="w-4 h-4" /> <span>Unduh Excel</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
                  <th className="py-3 px-4">Tanggal</th>
                  <th className="py-3 px-4">Pekerja</th>
                  <th className="py-3 px-4">Jam Masuk</th>
                  <th className="py-3 px-4">Jam Pulang</th>
                  <th className="py-3 px-4">Status Kerja</th>
                  <th className="py-3 px-4">Catatan Koordinator</th>
                  <th className="py-3 px-4 text-right">Tarif</th>
                  <th className="py-3 px-4 text-center">Bayar</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredAttendances.length === 0 ? (
                  <tr><td colSpan={9} className="py-12 text-center text-slate-400 font-medium">Tidak ada rekaman absensi sesuai filter.</td></tr>
                ) : filteredAttendances.map((att) => {
                  const needsApproval = att.clockInStatus === "pending_approval" || att.clockOutStatus === "pending_approval";
                  return (
                    <tr key={att.id} className={`hover:bg-slate-50 ${needsApproval ? "bg-amber-50/60" : ""}`}>
                      <td className="py-3.5 px-4 font-semibold whitespace-nowrap">{att.date}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{att.userName}</div>
                        <div className="text-xs text-slate-500">NIK: {att.userNik} • {att.userTeam}</div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-start gap-2">
                          <PhotoThumb
                            url={att.clockInPhotoUrl}
                            caption={`Foto Masuk · ${att.userName}`}
                            subtitle={`${att.date} • ${att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID") : "-"} • ${att.clockInLocationLabel || ""}`}
                            openPhoto={openPhoto}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold flex items-center gap-1 flex-wrap">
                              {att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}
                              {att.clockInStatus === "late" && <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded">Terlambat</span>}
                              {att.clockInStatus === "pending_approval" && <span className="bg-amber-200 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded animate-pulse">Pending</span>}
                              {att.clockInStatus === "exception_approved" && <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded">Ijin ✓</span>}
                            </div>
                            {att.clockInLocationLabel && <div className="text-[10px] text-slate-500 mt-0.5 max-w-[10rem] truncate" title={att.clockInLocationLabel}>{att.clockInLocationLabel}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-start gap-2">
                          <PhotoThumb
                            url={att.clockOutPhotoUrl}
                            caption={`Foto Pulang · ${att.userName}`}
                            subtitle={`${att.date} • ${att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID") : "-"} • ${att.clockOutLocationLabel || ""}`}
                            openPhoto={openPhoto}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold">{att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}</div>
                            {att.clockOutLocationLabel && <div className="text-[10px] text-slate-500 mt-0.5 max-w-[10rem] truncate" title={att.clockOutLocationLabel}>{att.clockOutLocationLabel}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {(() => {
                          const eff = effectiveStatusOf(att);
                          if (eff.status === "finish") return <span className="bg-emerald-500 text-white font-bold text-xs px-2.5 py-1 rounded-full">FINISH</span>;
                          if (eff.status === "tumbang") return <span className="bg-amber-500 text-white font-bold text-xs px-2.5 py-1 rounded-full">TUMBANG</span>;
                          if (eff.status === "auto_tumbang") return (
                            <span className="bg-orange-500 text-white font-bold text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1" title={eff.reason}>
                              TUMBANG <span className="bg-white/25 text-[9px] px-1 py-0.5 rounded">AUTO</span>
                            </span>
                          );
                          return <span className="bg-blue-100 text-blue-800 font-bold text-xs px-2.5 py-1 rounded-full">Sedang Kerja</span>;
                        })()}
                        {needsApproval && (
                          <button onClick={() => handleApproveException(att)} className="block mt-1.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2 py-0.5 rounded">Setujui Ijin</button>
                        )}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="text-xs bg-amber-50 text-amber-900 p-2 rounded-xl border border-amber-200 flex items-center justify-between gap-2">
                          <span className="italic">{att.koordinatorNote || "Belum ada catatan"}</span>
                          <button onClick={() => handleEditKoordNote(att)} className="text-amber-700"><Edit className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold whitespace-nowrap">Rp {(att.wageAmount || 0).toLocaleString("id-ID")}</td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {att.isPaid ? (
                          <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1 rounded-full">Terbayar</span>
                        ) : (
                          <span className="bg-red-100 text-red-800 text-xs font-bold px-3 py-1 rounded-full">Belum</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1.5 items-center">
                          <button onClick={() => handleTogglePaid(att)} className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors ${att.isPaid ? "bg-amber-100 text-amber-800 hover:bg-amber-200" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
                            {att.isPaid ? "Batal Bayar" : "Bayar"}
                          </button>
                          {att.clockOutTime && (
                            <button
                              onClick={() => handleResetClockOut(att)}
                              className="bg-purple-100 text-purple-800 hover:bg-purple-200 p-1.5 rounded-lg"
                              title="Reset absen PULANG saja - pekerja bisa foto pulang ulang"
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

      {/* ====================== TAB: REKAP PEKERJA PHL ================== */}
      {activeTab === "rekap_pekerja" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
            <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
              <div>
                <h3 className="font-bold text-lg text-slate-800">📑 Rekap Pekerja PHL</h3>
                <p className="text-xs text-slate-500 mt-0.5">Filter per nama, tim, status, dan rentang tanggal absensi. Akumulasi gaji & kehadiran mengikuti filter.</p>
              </div>
              <div className="flex gap-3 items-center">
                <span className="text-xs font-semibold bg-blue-100 text-blue-800 px-3 py-1.5 rounded-full">{rekapPekerjaPHL.length} Pekerja</span>
                <button onClick={exportRekapPekerjaExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-md text-sm">
                  <Download className="w-4 h-4" /> <span>Unduh Excel</span>
                </button>
              </div>
            </div>

            {/* Filter Bar khusus Rekap Pekerja PHL */}
            <div className="p-5 bg-white border-b border-slate-200 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Pekerja</label>
                <select value={rpUserId} onChange={(e) => setRpUserId(e.target.value)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium min-w-[180px]">
                  <option value="">Semua Pekerja</option>
                  {pekerjaUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Tim Kerja</label>
                <select value={rpTeam} onChange={(e) => setRpTeam(e.target.value)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium min-w-[150px]">
                  <option value="">Semua Tim</option>
                  {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Status Akun</label>
                <select value={rpStatus} onChange={(e) => setRpStatus(e.target.value as any)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium">
                  <option value="">Semua Status</option>
                  <option value="active">Aktif</option>
                  <option value="pending">Pending</option>
                  <option value="inactive">Nonaktif</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Tanggal Absen Dari</label>
                <input type="date" value={rpStartDate} onChange={(e) => setRpStartDate(e.target.value)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Sampai</label>
                <input type="date" value={rpEndDate} onChange={(e) => setRpEndDate(e.target.value)} className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium" />
              </div>
              {(rpUserId || rpTeam || rpStatus || rpStartDate || rpEndDate) && (
                <button
                  type="button"
                  onClick={() => { setRpUserId(""); setRpTeam(""); setRpStatus(""); setRpStartDate(""); setRpEndDate(""); }}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs px-3 py-2 rounded-xl h-fit"
                >
                  Reset Filter
                </button>
              )}
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-slate-50 border-b border-slate-200">
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <p className="text-[11px] font-bold text-slate-500 uppercase">Total Pekerja</p>
                <p className="text-2xl font-extrabold text-slate-900 mt-1">{rekapPekerjaPHL.length}</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-emerald-200">
                <p className="text-[11px] font-bold text-emerald-700 uppercase">Aktif</p>
                <p className="text-2xl font-extrabold text-emerald-700 mt-1">{rekapPekerjaPHL.filter((r) => r.user.status === "active").length}</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-amber-200">
                <p className="text-[11px] font-bold text-amber-700 uppercase">Pending</p>
                <p className="text-2xl font-extrabold text-amber-700 mt-1">{rekapPekerjaPHL.filter((r) => r.user.status === "pending").length}</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-red-200">
                <p className="text-[11px] font-bold text-red-700 uppercase">Nonaktif</p>
                <p className="text-2xl font-extrabold text-red-700 mt-1">{rekapPekerjaPHL.filter((r) => r.user.status === "inactive").length}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
                    <th className="py-3 px-4">Pekerja</th>
                    <th className="py-3 px-4">NIK / Telp</th>
                    <th className="py-3 px-4">Tim</th>
                    <th className="py-3 px-4 text-center">Status Akun</th>
                    <th className="py-3 px-4 text-right">Tarif Default</th>
                    <th className="py-3 px-4 text-center">Hari Hadir</th>
                    <th className="py-3 px-4 text-center">FINISH / TUMBANG</th>
                    <th className="py-3 px-4 text-right">Total Gaji</th>
                    <th className="py-3 px-4 text-right">Sudah Dibayar</th>
                    <th className="py-3 px-4 text-right">Belum Dibayar</th>
                    <th className="py-3 px-4">Absen Terakhir</th>
                    <th className="py-3 px-4 text-center">KTP</th>
                    <th className="py-3 px-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {rekapPekerjaPHL.length === 0 ? (
                    <tr><td colSpan={13} className="py-12 text-center text-slate-400 font-medium">Belum ada pekerja PHL terdaftar.</td></tr>
                  ) : rekapPekerjaPHL.map((r) => (
                    <tr key={r.user.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{r.user.name}</div>
                        {r.pendingApproval > 0 && <div className="text-[10px] text-amber-700 font-bold mt-0.5">⚠ {r.pendingApproval} absen menunggu persetujuan</div>}
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <div className="font-mono text-slate-600">{r.user.nik}</div>
                        <div className="text-slate-500">{r.user.phone || "-"}</div>
                      </td>
                      <td className="py-3.5 px-4"><span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg text-xs font-semibold">{r.user.team || "-"}</span></td>
                      <td className="py-3.5 px-4 text-center">
                        {r.user.status === "active" && <span className="bg-emerald-100 text-emerald-800 font-bold text-xs px-2.5 py-1 rounded-full">Aktif</span>}
                        {r.user.status === "pending" && <span className="bg-amber-100 text-amber-800 font-bold text-xs px-2.5 py-1 rounded-full">Pending</span>}
                        {r.user.status === "inactive" && <span className="bg-red-100 text-red-800 font-bold text-xs px-2.5 py-1 rounded-full">Nonaktif</span>}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold whitespace-nowrap">Rp {(r.user.dailyWage || 0).toLocaleString("id-ID")}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-blue-700">{r.hariHadir} hari</td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span className="bg-emerald-100 text-emerald-800 font-bold text-xs px-2 py-0.5 rounded mr-1">{r.finish} F</span>
                        <span className="bg-amber-100 text-amber-800 font-bold text-xs px-2 py-0.5 rounded">{r.tumbang} T</span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900 whitespace-nowrap">Rp {r.totalGaji.toLocaleString("id-ID")}</td>
                      <td className="py-3.5 px-4 text-right font-bold text-emerald-700 whitespace-nowrap">Rp {r.sudahDibayar.toLocaleString("id-ID")}</td>
                      <td className="py-3.5 px-4 text-right font-bold text-red-700 whitespace-nowrap">Rp {r.belumDibayar.toLocaleString("id-ID")}</td>
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap">{r.lastDate || <span className="text-slate-400 italic">Belum pernah</span>}</td>
                      <td className="py-3.5 px-4 text-center">
                        <PhotoThumb
                          url={r.user.ktpPhotoUrl}
                          caption={`Foto KTP · ${r.user.name}`}
                          subtitle={`NIK ${r.user.nik} • Tim ${r.user.team || "-"}`}
                          size="sm"
                          openPhoto={openPhoto}
                        />
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="inline-flex gap-1.5">
                          <button onClick={() => setReportUser(r.user)} className="bg-indigo-100 text-indigo-800 hover:bg-indigo-200 p-1.5 rounded-lg" title="Lihat Report Lengkap">
                            <FileText className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteUser(r.user)} className="bg-red-100 text-red-700 hover:bg-red-200 p-1.5 rounded-lg" title="Hapus Pekerja">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ====================== TAB: PAYROLL ============================ */}
      {activeTab === "payroll" && (
        <div className="space-y-6">
          {/* Filter + Export */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 flex flex-wrap justify-between items-end gap-4">
            <FilterBar
              users={pekerjaUsers}
              teams={teams}
              selectedUserId={selectedUserId} setSelectedUserId={setSelectedUserId}
              selectedTeam={selectedTeam} setSelectedTeam={setSelectedTeam}
              startDate={startDate} setStartDate={setStartDate}
              endDate={endDate} setEndDate={setEndDate}
            />
            <div className="flex gap-3">
              <button onClick={() => copySpreadsheetFormat(buildPayrollRows())} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-md text-sm">
                <Copy className="w-4 h-4" /> <span>Salin (Sheets)</span>
              </button>
              <button onClick={exportPayrollExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-md text-sm">
                <Download className="w-4 h-4" /> <span>Excel (4 Sheet)</span>
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total Gaji (Akumulasi)" value={`Rp ${totalGajiAll.toLocaleString("id-ID")}`} color="from-blue-600 to-indigo-700" />
            <StatCard label="Sudah Dibayar" value={`Rp ${totalPaid.toLocaleString("id-ID")}`} color="from-emerald-600 to-teal-700" />
            <StatCard label="Belum Dibayar" value={`Rp ${totalUnpaid.toLocaleString("id-ID")}`} color="from-amber-500 to-amber-700" />
          </div>

          {/* Per Pekerja */}
          <PayrollTable
            title="📋 Rekap Per Pekerja"
            description="Akumulasi penggajian per nama pekerja"
            headers={["Nama Pekerja", "NIK", "Tim", "Hari Hadir", "FINISH", "TUMBANG", "Total Gaji", "Sudah Dibayar", "Belum Dibayar"]}
            rows={payrollByWorker.map((r) => [
              r.user.name,
              <span className="font-mono text-xs">{r.user.nik}</span>,
              r.user.team,
              <span className="font-bold">{r.hari} hari</span>,
              <span className="bg-emerald-100 text-emerald-800 font-bold text-xs px-2 py-0.5 rounded">{r.finish}</span>,
              <span className="bg-amber-100 text-amber-800 font-bold text-xs px-2 py-0.5 rounded">{r.tumbang}</span>,
              <span className="font-bold text-slate-900">Rp {r.total.toLocaleString("id-ID")}</span>,
              <span className="font-bold text-emerald-700">Rp {r.paid.toLocaleString("id-ID")}</span>,
              <span className="font-bold text-red-700">Rp {r.unpaid.toLocaleString("id-ID")}</span>,
            ])}
          />

          {/* Per Tim */}
          <PayrollTable
            title="👥 Rekap Per Tim"
            description="Akumulasi penggajian per tim kerja"
            headers={["Tim", "Hari Hadir (akumulasi)", "Total Gaji", "Sudah Dibayar", "Belum Dibayar"]}
            rows={payrollByTeam.map((r) => [
              <span className="font-bold">{r.team}</span>,
              `${r.hari} hari`,
              <span className="font-bold text-slate-900">Rp {r.total.toLocaleString("id-ID")}</span>,
              <span className="font-bold text-emerald-700">Rp {r.paid.toLocaleString("id-ID")}</span>,
              <span className="font-bold text-red-700">Rp {r.unpaid.toLocaleString("id-ID")}</span>,
            ])}
          />

          {/* Per Tanggal */}
          <PayrollTable
            title="📅 Rekap Per Tanggal"
            description="Akumulasi penggajian per tanggal kerja"
            headers={["Tanggal", "Jumlah Pekerja", "Total Gaji", "Sudah Dibayar", "Belum Dibayar"]}
            rows={payrollByDate.map((r) => [
              <span className="font-bold">{r.date}</span>,
              `${r.jumlah} orang`,
              <span className="font-bold text-slate-900">Rp {r.total.toLocaleString("id-ID")}</span>,
              <span className="font-bold text-emerald-700">Rp {r.paid.toLocaleString("id-ID")}</span>,
              <span className="font-bold text-red-700">Rp {r.unpaid.toLocaleString("id-ID")}</span>,
            ])}
          />

          {/* Per Absensi (Detail) */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
            <div className="p-6 bg-slate-50 border-b border-slate-200">
              <h3 className="font-bold text-lg text-slate-800">📷 Detail Per Absensi (dengan foto)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Daftar absensi sedetail mungkin termasuk foto masuk & pulang</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
                    <th className="py-3 px-4">Tanggal</th>
                    <th className="py-3 px-4">Nama / NIK</th>
                    <th className="py-3 px-4">Tim</th>
                    <th className="py-3 px-4">Jam Masuk</th>
                    <th className="py-3 px-4">Foto Masuk</th>
                    <th className="py-3 px-4">Jam Pulang</th>
                    <th className="py-3 px-4">Foto Pulang</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Nominal</th>
                    <th className="py-3 px-4 text-center">Bayar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredAttendances.length === 0 ? (
                    <tr><td colSpan={10} className="py-12 text-center text-slate-400 font-medium">Belum ada data.</td></tr>
                  ) : filteredAttendances.map((att) => (
                    <tr key={att.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-semibold whitespace-nowrap">{att.date}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{att.userName}</div>
                        <div className="text-xs font-mono text-slate-500">{att.userNik}</div>
                      </td>
                      <td className="py-3 px-4"><span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-xs font-semibold">{att.userTeam || "-"}</span></td>
                      <td className="py-3 px-4 whitespace-nowrap font-semibold">{att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                      <td className="py-3 px-4">
                        <PhotoThumb
                          url={att.clockInPhotoUrl}
                          caption={`Foto Masuk · ${att.userName}`}
                          subtitle={`${att.date} • ${att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID") : "-"}`}
                          openPhoto={openPhoto}
                        />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-semibold">{att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                      <td className="py-3 px-4">
                        <PhotoThumb
                          url={att.clockOutPhotoUrl}
                          caption={`Foto Pulang · ${att.userName}`}
                          subtitle={`${att.date} • ${att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID") : "-"}`}
                          openPhoto={openPhoto}
                        />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {(() => {
                          const eff = effectiveStatusOf(att);
                          if (eff.status === "finish") return <span className="bg-emerald-500 text-white font-bold text-xs px-2 py-1 rounded-full">FINISH</span>;
                          if (eff.status === "tumbang") return <span className="bg-amber-500 text-white font-bold text-xs px-2 py-1 rounded-full">TUMBANG</span>;
                          if (eff.status === "auto_tumbang") return (
                            <span className="bg-orange-500 text-white font-bold text-xs px-2 py-1 rounded-full inline-flex items-center gap-1" title={eff.reason}>
                              TUMBANG <span className="bg-white/25 text-[9px] px-1 py-0.5 rounded">AUTO</span>
                            </span>
                          );
                          return <span className="bg-blue-100 text-blue-800 font-bold text-xs px-2 py-1 rounded-full">Berlangsung</span>;
                        })()}
                      </td>
                      <td className="py-3 px-4 text-right font-bold whitespace-nowrap">Rp {(att.wageAmount || 0).toLocaleString("id-ID")}</td>
                      <td className="py-3 px-4 text-center">
                        {att.isPaid ? (
                          <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-1 rounded-full">✓</span>
                        ) : (
                          <button onClick={() => handleTogglePaid(att)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1 rounded-lg">Bayar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ====================== TAB: USERS ============================== */}
      {activeTab === "users" && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="font-bold text-lg text-slate-800">Daftar Akun (Pekerja & Koordinator)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Akun yang ditambahkan oleh Admin langsung berstatus Aktif (tidak perlu menunggu persetujuan).</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs bg-blue-100 text-blue-800 font-semibold px-3 py-1 rounded-full">Total: {users.length} Akun</span>
              <button
                onClick={openAddUserModal}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-md text-sm"
              >
                <UserPlus className="w-4 h-4" />
                <span>Tambah Karyawan</span>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
                  <th className="py-3 px-4">Nama</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">NIK</th>
                  <th className="py-3 px-4">No Telepon</th>
                  <th className="py-3 px-4">Tim</th>
                  <th className="py-3 px-4 text-center">KTP</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Gaji Harian</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {users.map((u) => {
                  const isKoord = u.role === "koordinator";
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-bold text-slate-900">{u.name}</td>
                      <td className="py-3.5 px-4">
                        {isKoord ? (
                          <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded text-xs font-bold">Koordinator</span>
                        ) : (
                          <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">Pekerja PHL</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">{u.nik}</td>
                      <td className="py-3.5 px-4">{u.phone || "-"}</td>
                      <td className="py-3.5 px-4"><span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg text-xs font-semibold">{u.team || "-"}</span></td>
                      <td className="py-3.5 px-4 text-center">
                        {u.ktpPhotoUrl ? (
                          <button
                            type="button"
                            onClick={() => openPhoto(u.ktpPhotoUrl, `KTP · ${u.name}`, `NIK ${u.nik}`)}
                            className="text-blue-600 hover:underline font-semibold text-xs cursor-zoom-in"
                          >
                            Lihat 🖼️
                          </button>
                        ) : <span className="text-xs text-slate-400">-</span>}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {u.status === "active" && <span className="bg-emerald-100 text-emerald-800 font-bold text-xs px-2.5 py-1 rounded-full">Aktif</span>}
                        {u.status === "pending" && <span className="bg-amber-100 text-amber-800 font-bold text-xs px-2.5 py-1 rounded-full animate-pulse">Pending</span>}
                        {u.status === "inactive" && <span className="bg-red-100 text-red-800 font-bold text-xs px-2.5 py-1 rounded-full">Nonaktif</span>}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                        {isKoord ? <span className="text-slate-400 text-xs italic">—</span> : `Rp ${(u.dailyWage || 0).toLocaleString("id-ID")}`}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5">
                        {u.status === "pending" && (
                          <button onClick={() => handleUserStatusChange(u.id, "active")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg">Setujui</button>
                        )}
                        {u.status === "active" ? (
                          <button onClick={() => handleUserStatusChange(u.id, "inactive")} className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg">Nonaktifkan</button>
                        ) : (
                          <button onClick={() => handleUserStatusChange(u.id, "active")} className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg">Aktifkan</button>
                        )}
                        <button onClick={() => setReportUser(u)} className="bg-indigo-100 text-indigo-800 hover:bg-indigo-200 p-1.5 rounded-lg" title="Lihat Report Lengkap"><FileText className="w-4 h-4" /></button>
                        <button onClick={() => handleResetPasswordQuick(u)} className="bg-amber-100 text-amber-800 hover:bg-amber-200 p-1.5 rounded-lg" title="Reset Sandi"><Key className="w-4 h-4" /></button>
                        <button onClick={() => openUserEdit(u)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 p-1.5 rounded-lg" title="Edit Data"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => handleDeleteUser(u)} className="bg-red-100 text-red-700 hover:bg-red-200 p-1.5 rounded-lg" title="Hapus Akun"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ====================== TAB: TEAMS ============================== */}
      {activeTab === "teams" && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-lg text-slate-800">Master Data Tim Kerja</h3>
            <button onClick={handleAddTeam} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-md text-sm">
              <Plus className="w-4 h-4" /> <span>Tambah Tim</span>
            </button>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.length === 0 ? (
              <div className="col-span-full text-center py-8 text-slate-400">Belum ada tim. Klik Tambah Tim.</div>
            ) : teams.map((t) => {
              const memberCount = pekerjaUsers.filter((u) => u.team === t.name).length;
              return (
                <div key={t.id} className="border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow bg-white flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500">{memberCount} pekerja aktif di tim ini</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEditTeam(t)} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDeleteTeam(t)} className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ====================== TAB: WAGE RATES ========================= */}
      {activeTab === "wagerates" && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg text-slate-800">Tarif Gaji Harian per Tanggal</h3>
              <p className="text-xs text-slate-500 mt-0.5">Override tarif default pekerja untuk tanggal-tanggal tertentu (lembur, tanggal merah, dll). Berlaku otomatis saat pekerja absen masuk.</p>
            </div>
            <button onClick={openWageRateNew} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-md text-sm">
              <Plus className="w-4 h-4" /> <span>Tambah Tarif</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
                  <th className="py-3 px-4">Tanggal</th>
                  <th className="py-3 px-4">Berlaku Untuk</th>
                  <th className="py-3 px-4 text-right">Nominal Tarif</th>
                  <th className="py-3 px-4">Keterangan</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {wageRates.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium">Belum ada tarif khusus. Tarif default mengikuti gaji harian pekerja.</td></tr>
                ) : wageRates.map((r) => {
                  const start = r.startDate || r.date || "";
                  const end = r.endDate || r.date || start;
                  const isRange = start !== end;
                  return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-bold text-slate-900 whitespace-nowrap">
                      {isRange ? (
                        <div className="space-y-0.5">
                          <div>{start}</div>
                          <div className="text-xs text-slate-500">s.d. {end}</div>
                        </div>
                      ) : start}
                    </td>
                    <td className="py-3.5 px-4">
                      {r.appliesToTeam
                        ? <span className="bg-purple-100 text-purple-800 px-2.5 py-1 rounded text-xs font-bold">Tim: {r.appliesToTeam}</span>
                        : <span className="bg-blue-100 text-blue-800 px-2.5 py-1 rounded text-xs font-bold">Semua Pekerja</span>}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-emerald-700 whitespace-nowrap">Rp {r.amount.toLocaleString("id-ID")}</td>
                    <td className="py-3.5 px-4 text-slate-600">{r.note || "-"}</td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button onClick={() => openWageRateEdit(r)} className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg mr-1"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => handleDeleteWageRate(r)} className="p-1.5 bg-red-100 hover:bg-red-200 rounded-lg text-red-700"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ====================== TAB: LOCATIONS ========================== */}
      {activeTab === "locations" && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-lg text-slate-800">Titik Lokasi Kerja & Radius GPS</h3>
            <button onClick={() => { setLocForm({ id: "", name: "", latitude: "-7.250445", longitude: "112.768845", radius: "50", isDefault: false }); setShowLocModal(true); }} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-md text-sm">
              <Plus className="w-4 h-4" /> <span>Tambah Lokasi</span>
            </button>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {locations.map((loc) => (
              <div key={loc.id} className="border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md bg-white flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="font-bold text-slate-900 text-lg leading-snug">{loc.name}</h4>
                    {loc.isDefault && <span className="bg-blue-100 text-blue-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase">Default</span>}
                  </div>
                  <div className="space-y-1.5 text-xs text-slate-600 mb-6 bg-slate-50 p-3 rounded-xl border border-slate-100 font-mono">
                    <div>📍 {loc.latitude}, {loc.longitude}</div>
                    <div>🎯 Radius: <strong className="text-slate-900 font-bold">{loc.radius} m</strong></div>
                  </div>
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                  <a href={`https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600 hover:underline">Google Maps 🗺️</a>
                  <div className="flex gap-2">
                    <button onClick={() => { setLocForm({ id: loc.id, name: loc.name, latitude: String(loc.latitude), longitude: String(loc.longitude), radius: String(loc.radius), isDefault: loc.isDefault }); setShowLocModal(true); }} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDeleteLocation(loc)} className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ====================== TAB: SHIFTS ============================= */}
      {activeTab === "shifts" && (
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-lg text-slate-800">Jam Kerja / Shift & Toleransi</h3>
            <button onClick={() => { setShiftForm({ id: "", name: "", startTime: "07:00", endTime: "16:00", lateToleranceMinutes: "30", rolloverNextDay: false, isDefault: false }); setShowShiftModal(true); }} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-md text-sm">
              <Plus className="w-4 h-4" /> <span>Tambah Shift</span>
            </button>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {shifts.map((s) => (
              <div key={s.id} className="border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md bg-white flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="font-bold text-slate-900 text-lg">{s.name}</h4>
                    {s.isDefault && <span className="bg-blue-100 text-blue-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase">Default</span>}
                  </div>
                  <div className="space-y-2 text-sm text-slate-700 mb-6 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                    <div className="flex justify-between"><span>⏰ Masuk</span><strong className="font-mono text-blue-700">{s.startTime}</strong></div>
                    <div className="flex justify-between">
                      <span>⌛ Pulang</span>
                      <strong className="font-mono text-indigo-700">
                        {s.endTime}
                        {s.rolloverNextDay && <span className="ml-1 text-[10px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.5 rounded">+1 hari</span>}
                      </strong>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-200 text-xs"><span>⏳ Toleransi</span><strong>{s.lateToleranceMinutes} menit</strong></div>
                    {s.rolloverNextDay && (
                      <div className="pt-1 border-t border-slate-200 text-[11px] text-purple-700 font-semibold italic">
                        🌙 Shift menyebrang hari (sore/malam)
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button onClick={() => { setShiftForm({ id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime, lateToleranceMinutes: String(s.lateToleranceMinutes), rolloverNextDay: !!s.rolloverNextDay, isDefault: s.isDefault }); setShowShiftModal(true); }} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg"><Edit className="w-4 h-4" /></button>
                  <button onClick={() => handleDeleteShift(s)} className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ====================== TAB: SETTINGS =========================== */}
      {activeTab === "settings" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
            <div className="p-6 bg-slate-50 border-b border-slate-200">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <ExternalLink className="w-5 h-5 text-emerald-600" />
                <span>Tautan Google Spreadsheet Tujuan Rekap</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">Saat menekan tombol <strong>Salin (Sheets)</strong> di halaman Rekap/Penggajian, link ini akan dibuka otomatis.</p>
            </div>
            <form onSubmit={handleSaveSettings} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">URL Google Spreadsheet</label>
                <input
                  type="url"
                  value={sheetUrlDraft}
                  onChange={(e) => setSheetUrlDraft(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/........./edit"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1.5">Kosongkan untuk menonaktifkan tombol buka otomatis.</p>
              </div>

              {appSettings.googleSpreadsheetUrl && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-bold text-emerald-900 mb-0.5">Spreadsheet Aktif</p>
                    <p className="text-xs text-emerald-700 font-mono break-all">{appSettings.googleSpreadsheetUrl}</p>
                  </div>
                  <a href={appSettings.googleSpreadsheetUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 shadow-sm">
                    <ExternalLink className="w-3.5 h-3.5" /> <span>Buka</span>
                  </a>
                </div>
              )}

              {/* Auto-TUMBANG Tolerance Setting */}
              <div className="border-t border-slate-200 pt-5 mt-5">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                  <h4 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
                    🌙 Auto-TUMBANG (Lupa Absen Pulang)
                  </h4>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Jika pekerja sudah absen masuk tapi <strong>tidak absen pulang</strong> setelah jam pulang shift + toleransi ini,
                    sistem otomatis tandai sebagai <strong>TUMBANG</strong> di rekap admin. Pekerja tetap bisa absen pulang
                    nanti kapan saja untuk mengubahnya jadi FINISH.
                  </p>
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-bold text-amber-900">Toleransi setelah jam pulang:</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="24"
                      value={tumbangToleranceDraft}
                      onChange={(e) => setTumbangToleranceDraft(e.target.value)}
                      className="w-24 px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <span className="text-xs font-bold text-amber-900">jam</span>
                  </div>
                  <p className="text-[11px] text-amber-700 italic">
                    Contoh: Jam pulang shift 16:00, toleransi {tumbangToleranceDraft || 1} jam → pekerja yg belum absen pulang sampai jam {(() => {
                      const h = Math.floor(16 + Number(tumbangToleranceDraft || 1));
                      const m = Math.round(((Number(tumbangToleranceDraft || 1)) % 1) * 60);
                      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                    })()} otomatis TUMBANG.
                  </p>
                </div>
              </div>

              <button type="submit" disabled={savingSettings} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl shadow-md flex items-center gap-2 disabled:opacity-70">
                {savingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{savingSettings ? "Menyimpan..." : "Simpan Pengaturan"}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ============== MODALS ============== */}
      {showLocModal && (
        <Modal title={locForm.id ? "Edit Titik Lokasi" : "Tambah Titik Lokasi"} onClose={() => setShowLocModal(false)}>
          <form onSubmit={handleSaveLocation} className="p-6 space-y-4">
            <Field label="Nama Lokasi">
              <input type="text" required value={locForm.name} onChange={(e) => setLocForm({...locForm, name: e.target.value})} placeholder="Kantor Pusat / Site A" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Latitude"><input type="text" required value={locForm.latitude} onChange={(e) => setLocForm({...locForm, latitude: e.target.value})} placeholder="-7.250445" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono" /></Field>
              <Field label="Longitude"><input type="text" required value={locForm.longitude} onChange={(e) => setLocForm({...locForm, longitude: e.target.value})} placeholder="112.768845" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono" /></Field>
            </div>
            <Field label="Radius (meter)"><input type="number" required value={locForm.radius} onChange={(e) => setLocForm({...locForm, radius: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" /></Field>
            <label className="flex items-center gap-2 pt-2">
              <input type="checkbox" checked={locForm.isDefault} onChange={(e) => setLocForm({...locForm, isDefault: e.target.checked})} className="w-4 h-4 text-blue-600 rounded" />
              <span className="text-sm font-semibold text-slate-700">Jadikan Default</span>
            </label>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg mt-4">Simpan Lokasi</button>
          </form>
        </Modal>
      )}

      {showShiftModal && (
        <Modal title={shiftForm.id ? "Edit Shift" : "Tambah Shift"} onClose={() => setShowShiftModal(false)}>
          <form onSubmit={handleSaveShift} className="p-6 space-y-4">
            <Field label="Nama Shift"><input type="text" required value={shiftForm.name} onChange={(e) => setShiftForm({...shiftForm, name: e.target.value})} placeholder="Shift Pagi Reguler" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Jam Masuk"><input type="time" required value={shiftForm.startTime} onChange={(e) => setShiftForm({...shiftForm, startTime: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono" /></Field>
              <Field label="Jam Pulang"><input type="time" required value={shiftForm.endTime} onChange={(e) => setShiftForm({...shiftForm, endTime: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono" /></Field>
            </div>
            <Field label="Toleransi Terlambat (menit)"><input type="number" required value={shiftForm.lateToleranceMinutes} onChange={(e) => setShiftForm({...shiftForm, lateToleranceMinutes: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" /></Field>

            <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${shiftForm.rolloverNextDay ? "bg-purple-50 border-purple-300" : "bg-slate-50 border-slate-200 hover:border-slate-300"}`}>
              <input type="checkbox" checked={shiftForm.rolloverNextDay} onChange={(e) => setShiftForm({...shiftForm, rolloverNextDay: e.target.checked})} className="mt-0.5 w-5 h-5 text-purple-600 rounded" />
              <div>
                <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  🌙 Shift Menyebrang Hari (Rollover)
                </div>
                <div className="text-xs text-slate-600 mt-0.5 leading-snug">
                  Centang jika shift ini pulangnya keesokan harinya, misalnya shift sore/malam:
                  <br />
                  <strong>masuk 22:00 hari ini → pulang 06:00 besok</strong>
                </div>
              </div>
            </label>

            <label className="flex items-center gap-2 pt-2">
              <input type="checkbox" checked={shiftForm.isDefault} onChange={(e) => setShiftForm({...shiftForm, isDefault: e.target.checked})} className="w-4 h-4 text-blue-600 rounded" />
              <span className="text-sm font-semibold text-slate-700">Jadikan Default</span>
            </label>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg mt-4">Simpan Shift</button>
          </form>
        </Modal>
      )}

      {showUserModal && (
        <Modal title={`Edit Data ${userForm.role === "koordinator" ? "Koordinator" : "Pekerja"}`} onClose={() => setShowUserModal(false)}>
          <form onSubmit={handleSaveUser} className="p-6 space-y-4">
            <Field label="Nama Lengkap">
              <input type="text" required value={userForm.name} onChange={(e) => setUserForm({...userForm, name: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
            </Field>
            <Field label="No Telepon">
              <input type="tel" value={userForm.phone} onChange={(e) => setUserForm({...userForm, phone: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
            </Field>

            {userForm.role === "pekerja" && (
              <>
                <Field label="Tim Kerja">
                  <select value={userForm.team} onChange={(e) => setUserForm({...userForm, team: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium">
                    <option value="">(belum diatur)</option>
                    {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </Field>
                <Field label="Gaji Harian (Rp)">
                  <input type="number" value={userForm.dailyWage} onChange={(e) => setUserForm({...userForm, dailyWage: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
                </Field>
              </>
            )}

            {/* Sandi */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">🔒 Sandi Akun</h4>
                <span className="text-[10px] bg-amber-200 text-amber-900 font-bold px-2 py-0.5 rounded">Hanya admin yang bisa ubah</span>
              </div>
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">Sandi Saat Ini</label>
                <div className="font-mono bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm select-all">
                  {userForm.currentPassword || <span className="text-slate-400 italic">(tidak diset)</span>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">Sandi Baru (kosongkan jika tidak ingin diubah)</label>
                <input
                  type="text"
                  value={userForm.newPassword}
                  onChange={(e) => setUserForm({...userForm, newPassword: e.target.value})}
                  placeholder="Ketik sandi baru di sini"
                  className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="text-[11px] text-amber-700 mt-1 italic">💡 Min 4 karakter. Sandi ditampilkan terbuka agar Admin bisa langsung beritahu karyawan.</p>
              </div>
            </div>

            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg mt-2">
              Simpan Perubahan
            </button>
          </form>
        </Modal>
      )}

      {showAddUserModal && (
        <Modal title="Tambah Karyawan Baru" onClose={() => setShowAddUserModal(false)}>
          <form onSubmit={handleSaveNewUser} className="p-6 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 leading-relaxed">
              ℹ️ Karyawan yang ditambahkan oleh Admin <strong>langsung berstatus Aktif</strong> dan bisa langsung absen tanpa perlu menunggu persetujuan.
            </div>

            <Field label="Jenis Akun">
              <div className="grid grid-cols-2 gap-2">
                {(["pekerja", "koordinator"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAddUserForm((f) => ({ ...f, role: r, dailyWage: r === "koordinator" ? "0" : f.dailyWage }))}
                    className={`px-4 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${
                      addUserForm.role === r
                        ? "bg-blue-600 text-white border-blue-700 shadow-md"
                        : "bg-white text-slate-700 border-slate-300 hover:border-blue-400"
                    }`}
                  >
                    {r === "pekerja" ? "👷 Pekerja PHL" : "🧑‍💼 Koordinator"}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nama Lengkap">
                <input type="text" required value={addUserForm.name}
                  onChange={(e) => setAddUserForm({...addUserForm, name: e.target.value})}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
              </Field>
              <Field label="NIK (KTP) — jadi Username">
                <input type="text" required value={addUserForm.nik}
                  onChange={(e) => setAddUserForm({...addUserForm, nik: e.target.value})}
                  placeholder="16 digit angka"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="No Telepon / WA">
                <input type="tel" required value={addUserForm.phone}
                  onChange={(e) => setAddUserForm({...addUserForm, phone: e.target.value})}
                  placeholder="08xxxxxxxxxx"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
              </Field>
              <Field label="Sandi Awal">
                <input type="text" required value={addUserForm.password}
                  onChange={(e) => setAddUserForm({...addUserForm, password: e.target.value})}
                  placeholder="Sandi untuk login"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
              </Field>
            </div>

            {addUserForm.role === "pekerja" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tim Kerja">
                  <select required value={addUserForm.team}
                    onChange={(e) => setAddUserForm({...addUserForm, team: e.target.value})}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium">
                    <option value="">(pilih tim)</option>
                    {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </Field>
                <Field label="Tarif / Gaji Harian (Rp)">
                  <input type="number" required value={addUserForm.dailyWage}
                    onChange={(e) => setAddUserForm({...addUserForm, dailyWage: e.target.value})}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
                </Field>
              </div>
            )}

            <Field label="Foto KTP (Opsional)">
              <div className="border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl p-3 text-center bg-slate-50/50 cursor-pointer transition-colors relative">
                <input type="file" accept="image/*" onChange={handleAddUserPhoto}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                {addUserForm.ktpPreview ? (
                  <div className="space-y-2">
                    <img src={addUserForm.ktpPreview} alt="KTP" className="max-h-28 mx-auto rounded-lg shadow" />
                    <p className="text-xs text-emerald-600 font-semibold">✓ Foto KTP siap diunggah (klik untuk ganti)</p>
                  </div>
                ) : (
                  <div className="py-3 space-y-1">
                    <Upload className="w-6 h-6 text-slate-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-600">Klik untuk pilih foto KTP (opsional)</p>
                  </div>
                )}
              </div>
            </Field>

            <button
              type="submit"
              disabled={addUserLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg mt-2 flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {addUserLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{addUserLoading ? "Menyimpan..." : "Tambah Karyawan"}</span>
            </button>
          </form>
        </Modal>
      )}

      {showWageRateModal && (
        <Modal title={wageRateForm.id ? "Edit Tarif Tanggal" : "Tambah Tarif Tanggal"} onClose={() => setShowWageRateModal(false)}>
          <form onSubmit={handleSaveWageRate} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tanggal Mulai">
                <input type="date" required value={wageRateForm.startDate}
                  onChange={(e) => {
                    const start = e.target.value;
                    setWageRateForm((f) => ({
                      ...f,
                      startDate: start,
                      // auto-extend endDate kalau masih lebih kecil
                      endDate: !f.endDate || f.endDate < start ? start : f.endDate,
                    }));
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
              </Field>
              <Field label="Tanggal Selesai">
                <input type="date" required value={wageRateForm.endDate}
                  min={wageRateForm.startDate}
                  onChange={(e) => setWageRateForm({...wageRateForm, endDate: e.target.value})}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" />
              </Field>
            </div>
            <p className="text-[11px] text-slate-500 -mt-2">Untuk satu hari saja, isi tanggal mulai & selesai dengan tanggal yang sama.</p>
            <Field label="Nominal Tarif Harian (Rp)"><input type="number" required value={wageRateForm.amount} onChange={(e) => setWageRateForm({...wageRateForm, amount: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" /></Field>
            <Field label="Berlaku Untuk Tim (opsional)">
              <select value={wageRateForm.appliesToTeam} onChange={(e) => setWageRateForm({...wageRateForm, appliesToTeam: e.target.value})} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium">
                <option value="">Semua Pekerja</option>
                {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Keterangan / Alasan"><input type="text" value={wageRateForm.note} onChange={(e) => setWageRateForm({...wageRateForm, note: e.target.value})} placeholder="Misal: Lembur tanggal merah / Bonus akhir bulan" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium" /></Field>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg mt-2">Simpan Tarif</button>
          </form>
        </Modal>
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

/* ----------------- helper components ----------------- */

function FilterBar(props: {
  users: AppUser[];
  teams: Team[];
  selectedUserId: string; setSelectedUserId: (v: string) => void;
  selectedTeam: string; setSelectedTeam: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void;
  endDate: string; setEndDate: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Pekerja</label>
        <select value={props.selectedUserId} onChange={(e) => props.setSelectedUserId(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium">
          <option value="">Semua Pekerja</option>
          {props.users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Tim</label>
        <select value={props.selectedTeam} onChange={(e) => props.setSelectedTeam(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium">
          <option value="">Semua Tim</option>
          {props.teams.map((t) => (<option key={t.id} value={t.name}>{t.name}</option>))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Mulai</label>
        <input type="date" value={props.startDate} onChange={(e) => props.setStartDate(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium" />
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Sampai</label>
        <input type="date" value={props.endDate} onChange={(e) => props.setEndDate(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium" />
      </div>
      {(props.selectedUserId || props.selectedTeam || props.startDate || props.endDate) && (
        <button
          type="button"
          onClick={() => { props.setSelectedUserId(""); props.setSelectedTeam(""); props.setStartDate(""); props.setEndDate(""); }}
          className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs px-3 py-2 rounded-xl"
        >
          Reset Filter
        </button>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`bg-gradient-to-br ${color} p-5 rounded-2xl text-white shadow-xl`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-90">{label}</p>
      <h3 className="text-2xl sm:text-3xl font-extrabold mt-1.5 break-words">{value}</h3>
    </div>
  );
}

function PayrollTable({ title, description, headers, rows }: { title: string; description: string; headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
      <div className="p-5 bg-slate-50 border-b border-slate-200">
        <h3 className="font-bold text-base text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
              {headers.map((h, i) => <th key={i} className={`py-3 px-4 ${i >= 3 ? "text-right" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} className="py-8 text-center text-slate-400 font-medium">Belum ada data.</td></tr>
            ) : rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-slate-50">
                {row.map((cell, ci) => <td key={ci} className={`py-3 px-4 whitespace-nowrap ${ci >= 3 ? "text-right" : ""}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-100 my-8">
        <div className="bg-blue-900 px-6 py-4 text-white flex justify-between items-center">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose}><XCircle className="w-6 h-6 text-blue-200 hover:text-white" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">{label}</label>
      {children}
    </div>
  );
}
