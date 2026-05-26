"use client";

import React, { useState, useEffect, useMemo } from "react";
import { MapPin, CheckCircle2, AlertTriangle, RefreshCw, Calendar, Loader2, Clock, LockKeyhole } from "lucide-react";
import { SessionUser, WorkLocation, Shift, Attendance, AppSettings } from "@/lib/types";
import { uploadToCloudinary } from "@/lib/upload";
import {
  subscribeLocations, subscribeShifts, subscribeAttendances,
  createAttendance, updateAttendance, findTodayAttendance,
  subscribeAppSettings, resolveWageForDate,
} from "@/lib/firestore";
import { CameraCapture } from "./CameraCapture";
import { PhotoModal, PhotoThumb, usePhotoModal } from "./PhotoModal";

// Toleransi waktu pulang lebih awal sebelum jam pulang shift = 1 jam
const EARLY_OUT_TOLERANCE_MS = 60 * 60 * 1000;

interface PekerjaDashboardProps {
  user: SessionUser;
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function PekerjaDashboard({ user }: PekerjaDashboardProps) {
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ googleSpreadsheetUrl: "", companyName: "PT. Bimantara Mitra Persada", updatedAt: 0 });

  const [selectedLocId, setSelectedLocId] = useState<string>("");
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");

  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [dist, setDist] = useState<number | null>(null);

  const [photoPreview, setPhotoPreview] = useState("");
  const [notes, setNotes] = useState("");
  const [isTumbang, setIsTumbang] = useState(false);

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Ticking clock untuk gating jam pulang real-time (update tiap 30 detik)
  const [nowMs, setNowMs] = useState(Date.now());

  // Photo modal Cloudinary popup
  const { photo, open: openPhoto, close: closePhoto } = usePhotoModal();

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const u1 = subscribeLocations((list) => {
      setLocations(list);
      if (list.length > 0 && !selectedLocId) {
        const def = list.find((l) => l.isDefault) || list[0];
        setSelectedLocId(def.id);
      }
    });
    const u2 = subscribeShifts((list) => {
      setShifts(list);
      if (list.length > 0 && !selectedShiftId) {
        const def = list.find((s) => s.isDefault) || list[0];
        setSelectedShiftId(def.id);
      }
    });
    const u3 = subscribeAttendances(setAttendances, user.id);
    const u4 = subscribeAppSettings(setSettings);
    getLocation();
    return () => { u1(); u2(); u3(); u4(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getLocation = () => {
    setGpsLoading(true);
    setGpsError("");
    if (!navigator.geolocation) {
      setGpsError("GPS tidak didukung di perangkat ini.");
      setGpsLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLat(pos.coords.latitude);
        setUserLng(pos.coords.longitude);
        setGpsLoading(false);
      },
      () => {
        setGpsError("Gagal mengambil lokasi GPS. Pastikan ijin lokasi aktif.");
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    if (userLat !== null && userLng !== null && selectedLocId) {
      const target = locations.find((l) => l.id === selectedLocId);
      if (target) setDist(distanceMeters(userLat, userLng, target.latitude, target.longitude));
    }
  }, [userLat, userLng, selectedLocId, locations]);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const activeLoc = locations.find((l) => l.id === selectedLocId);
  const activeShift = shifts.find((s) => s.id === selectedShiftId);
  const isOutOfRadius = dist !== null && !!activeLoc && dist > activeLoc.radius;

  const todayStr = new Date().toISOString().split("T")[0];
  const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().split("T")[0];
  // Cari absensi yang masih "open" (sudah clock-in, belum clock-out).
  // - Untuk shift biasa: absensi hari ini
  // - Untuk shift rollover (sore/malam yang pulang besok): absensi kemarin
  //   yang shift-nya rolloverNextDay & belum clock-out
  const openYesterday = attendances.find(
    (a) => a.date === yesterdayStr && !a.clockOutTime &&
           shifts.find((s) => s.id === a.shiftId)?.rolloverNextDay
  );
  const todayAtt = openYesterday || attendances.find((a) => a.date === todayStr);

  // ---------- Gating ABSEN PULANG ----------
  // Pekerja baru boleh ambil foto pulang jika:
  //   - sudah lewat (jam pulang shift − 1 jam) toleransi, ATAU
  //   - koordinator/admin sudah memberi ijin pulang awal (earlyClockOutApproved)
  const clockOutGate = useMemo(() => {
    if (!todayAtt) return { allowed: true, reason: "" as string, earliestAllowedMs: 0, shiftEndMs: 0 };

    // Kalau koordinator/admin sudah memberi ijin pulang awal → langsung boleh
    if (todayAtt.earlyClockOutApproved) {
      return {
        allowed: true,
        reason: `Ijin pulang awal disetujui${todayAtt.earlyClockOutApprovedBy ? ` oleh ${todayAtt.earlyClockOutApprovedBy}` : ""}`,
        earliestAllowedMs: 0,
        shiftEndMs: 0,
      };
    }

    // Cari shift terkait absensi ini
    const shiftForAtt = shifts.find((s) => s.id === todayAtt.shiftId);
    if (!shiftForAtt) {
      // Tanpa shift terdeteksi, biarkan boleh
      return { allowed: true, reason: "Shift tidak terdeteksi", earliestAllowedMs: 0, shiftEndMs: 0 };
    }

    // Hitung jam pulang shift sesuai tanggal absen
    const [eh, em] = shiftForAtt.endTime.split(":").map(Number);
    const baseDate = new Date(todayAtt.date + "T00:00:00");
    if (shiftForAtt.rolloverNextDay) {
      // shift menyebrang hari → jam pulang besok-nya tanggal absen
      baseDate.setDate(baseDate.getDate() + 1);
    }
    baseDate.setHours(eh, em, 0, 0);
    const shiftEndMs = baseDate.getTime();
    const earliestAllowedMs = shiftEndMs - EARLY_OUT_TOLERANCE_MS;

    if (nowMs >= earliestAllowedMs) {
      return { allowed: true, reason: "", earliestAllowedMs, shiftEndMs };
    }
    return {
      allowed: false,
      reason: `Belum waktunya pulang. Boleh absen pulang mulai jam ${new Date(earliestAllowedMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`,
      earliestAllowedMs,
      shiftEndMs,
    };
  }, [todayAtt, shifts, nowMs]);

  // Label yang dibakar ke watermark foto
  const locationLabel = activeLoc
    ? isOutOfRadius
      ? `${activeLoc.name} (LUAR RADIUS ${dist}m)`
      : `${activeLoc.name} (${dist ?? "?"}m dari titik)`
    : "Lokasi belum dipilih";

  const handleClockIn = async () => {
    if (!photoPreview) return alert("Silakan jepret foto selfie terlebih dahulu.");
    if (userLat === null || userLng === null) return alert("Lokasi GPS belum tersedia.");
    if (!activeShift || !activeLoc) return alert("Pilih shift dan lokasi terlebih dahulu.");

    setLoading(true);
    try {
      let clockInStatus: Attendance["clockInStatus"] = "on_time";
      if (isOutOfRadius) {
        clockInStatus = "pending_approval";
      } else {
        const now = new Date();
        const [sh, sm] = activeShift.startTime.split(":").map(Number);
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm);
        const tolMs = activeShift.lateToleranceMinutes * 60 * 1000;
        if (now.getTime() > start.getTime() + tolMs) clockInStatus = "late";
      }

      const existing = await findTodayAttendance(user.id, todayStr);
      if (existing) return alert("Anda sudah absen masuk hari ini.");

      const wageAmount = await resolveWageForDate(user.team || "", todayStr, user.dailyWage || 0);
      const photoUrl = await uploadToCloudinary(photoPreview, "absensi-phl/clockin");

      await createAttendance({
        userId: user.id,
        userName: user.name,
        userNik: user.username,
        userPhone: user.phone || "",
        userTeam: user.team || "",

        date: todayStr,
        shiftId: activeShift.id,
        shiftName: activeShift.name,
        locationId: activeLoc.id,
        locationName: activeLoc.name,

        clockInTime: Date.now(),
        clockInPhotoUrl: photoUrl,
        clockInLat: userLat,
        clockInLng: userLng,
        clockInNotes: notes,
        clockInStatus,
        clockInLocationLabel: locationLabel,

        clockOutTime: null,
        clockOutPhotoUrl: null,
        clockOutLat: null,
        clockOutLng: null,
        clockOutNotes: "",
        clockOutStatus: null,
        clockOutLocationLabel: "",

        workStatus: "absen_masuk",
        koordinatorNote: "",
        wageAmount,
        isPaid: false,
        paidDate: null,
        paidBy: "",
      });

      triggerSuccess(isOutOfRadius
        ? "Absen masuk terkirim! Status menunggu persetujuan Koordinator karena Anda di luar radius."
        : "Absen masuk berhasil!"
      );
      setPhotoPreview(""); setNotes("");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!todayAtt) return;
    if (!clockOutGate.allowed) return alert(clockOutGate.reason);
    if (!photoPreview) return alert("Silakan jepret foto pulang terlebih dahulu.");
    if (userLat === null || userLng === null) return alert("Lokasi GPS belum tersedia.");

    setLoading(true);
    try {
      const photoUrl = await uploadToCloudinary(photoPreview, "absensi-phl/clockout");
      const clockOutStatus: Attendance["clockOutStatus"] = isOutOfRadius ? "pending_approval" : "completed";

      await updateAttendance(todayAtt.id, {
        clockOutTime: Date.now(),
        clockOutPhotoUrl: photoUrl,
        clockOutLat: userLat,
        clockOutLng: userLng,
        clockOutNotes: notes,
        clockOutStatus,
        clockOutLocationLabel: locationLabel,
        workStatus: isTumbang ? "tumbang" : "finish",
      });

      triggerSuccess(isOutOfRadius
        ? "Absen pulang terkirim! Status menunggu persetujuan Koordinator."
        : "Absen pulang berhasil!"
      );
      setPhotoPreview(""); setNotes(""); setIsTumbang(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const totalMasuk = attendances.length;
  const belumDibayar = attendances.filter((a) => !a.isPaid);

  if (user.status !== "active") {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="bg-white p-10 rounded-3xl shadow-xl border border-amber-200 space-y-6">
          <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto animate-bounce">
            <AlertTriangle className="w-12 h-12" />
          </div>
          <h2 className="text-3xl font-extrabold text-slate-800">Akun Belum Diverifikasi</h2>
          <p className="text-slate-600 max-w-md mx-auto leading-relaxed">
            Status akun Anda <strong className="text-amber-700 bg-amber-100 px-2 py-0.5 rounded uppercase">Pending</strong>. Hubungi Koordinator/Admin untuk menyetujui akun Anda.
          </p>
          <button onClick={() => window.location.reload()} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg">Cek Ulang</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-8">
      {successMsg && (
        <div className="p-4 bg-emerald-600 text-white font-semibold rounded-xl shadow-lg flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg("")}>✕</button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-3xl text-white shadow-xl flex items-center justify-between">
          <div>
            <p className="text-blue-100 text-sm font-semibold uppercase tracking-wider">Total Kehadiran</p>
            <h3 className="text-4xl font-extrabold">{totalMasuk} <span className="text-lg font-normal">Hari</span></h3>
            <p className="text-xs text-blue-200">Riwayat absen masuk & pulang</p>
          </div>
          <div className="bg-white/10 p-4 rounded-2xl"><Calendar className="w-8 h-8" /></div>
        </div>

        <div className="bg-gradient-to-br from-amber-500 to-amber-700 p-6 rounded-3xl text-white shadow-xl flex items-center justify-between">
          <div>
            <p className="text-amber-100 text-sm font-semibold uppercase tracking-wider">Hari Belum Terbayar</p>
            <h3 className="text-4xl font-extrabold">{belumDibayar.length} <span className="text-lg font-normal">Hari</span></h3>
            <p className="text-xs text-amber-200">Menunggu pembayaran dari Admin</p>
          </div>
          <div className="bg-white/10 p-4 rounded-2xl"><Clock className="w-8 h-8" /></div>
        </div>
      </div>

      {/* Action area */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-slate-100 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <div className="space-y-6">
          <div className="flex justify-between items-center pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-xl font-bold text-slate-800">Verifikasi Lokasi & Shift</h3>
              <p className="text-xs text-slate-500 mt-0.5">Pastikan posisi Anda di titik kerja yang tepat</p>
            </div>
            <button onClick={getLocation} disabled={gpsLoading} className="flex items-center gap-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 px-3.5 py-2 rounded-xl text-xs font-bold">
              <RefreshCw className={`w-3.5 h-3.5 ${gpsLoading ? "animate-spin" : ""}`} /> <span>Perbarui GPS</span>
            </button>
          </div>

          {gpsLoading ? (
            <div className="bg-blue-50 text-blue-800 p-4 rounded-2xl text-sm font-medium flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin" /> <span>Mencari koordinat GPS...</span>
            </div>
          ) : gpsError ? (
            <div className="bg-red-50 text-red-700 p-4 rounded-2xl text-sm font-medium flex items-center gap-3 border border-red-200">
              <AlertTriangle className="w-5 h-5" /> <span>{gpsError}</span>
            </div>
          ) : userLat !== null && userLng !== null ? (
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-slate-800 font-semibold">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span>Koordinat: <span className="font-mono">{userLat.toFixed(6)}, {userLng.toFixed(6)}</span></span>
              </div>
              {activeLoc && (
                <div className="pt-1 border-t border-slate-200 flex justify-between items-center text-xs">
                  <span>Jarak: <strong className="text-slate-900">{dist} m</strong></span>
                  {isOutOfRadius ? (
                    <span className="bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded">Luar Radius ({activeLoc.radius}m) — Perlu persetujuan</span>
                  ) : (
                    <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">Dalam Radius ✓</span>
                  )}
                </div>
              )}
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Pilih Titik Lokasi</label>
            <select value={selectedLocId} onChange={(e) => setSelectedLocId(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm font-semibold">
              {locations.map((loc) => (<option key={loc.id} value={loc.id}>{loc.name} (Radius {loc.radius}m)</option>))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Pilih Shift</label>
            <select value={selectedShiftId} onChange={(e) => setSelectedShiftId(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm font-semibold">
              {shifts.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.startTime} - {s.endTime})</option>))}
            </select>
          </div>

          {isOutOfRadius && (
            <div className="bg-amber-50 border border-amber-300 p-4 rounded-2xl text-sm text-amber-900 leading-relaxed">
              ⚠️ Anda berada <strong>di luar radius</strong> titik kerja. Anda <strong>tetap bisa</strong> mengambil foto dan mengirim absen, namun status absensi otomatis menjadi <strong>Menunggu Persetujuan Koordinator</strong>.
            </div>
          )}
        </div>

        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 flex flex-col justify-between space-y-6">

          {/* Apakah pekerja sedang dalam fase clock-out tapi belum boleh? */}
          {todayAtt && !todayAtt.clockOutTime && !clockOutGate.allowed ? (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 rounded-3xl p-6 text-center space-y-4">
                <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <LockKeyhole className="w-11 h-11" />
                </div>
                <div>
                  <h4 className="text-xl font-extrabold text-slate-800">Absen Pulang Terkunci 🔒</h4>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-sm mx-auto">
                    Kamera absen pulang baru bisa dibuka pada <strong>1 jam sebelum jam pulang shift</strong>.
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-4 border border-amber-200 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600 font-semibold">Jam Pulang Shift:</span>
                    <span className="font-bold text-indigo-700">
                      {new Date(clockOutGate.shiftEndMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 font-semibold">Mulai Boleh Pulang:</span>
                    <span className="font-bold text-emerald-700">
                      {new Date(clockOutGate.earliestAllowedMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-amber-200">
                    <span className="text-slate-600 font-semibold">Waktu Sekarang:</span>
                    <span className="font-bold text-slate-900">
                      {new Date(nowMs).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
                    </span>
                  </div>
                  <div className="bg-amber-100 text-amber-900 rounded-xl p-2.5 mt-2 text-xs font-bold flex items-center justify-center gap-1.5">
                    ⏱️ Sisa: {(() => {
                      const remaining = clockOutGate.earliestAllowedMs - nowMs;
                      const h = Math.floor(remaining / 3600000);
                      const m = Math.floor((remaining % 3600000) / 60000);
                      return h > 0 ? `${h} jam ${m} menit lagi` : `${m} menit lagi`;
                    })()}
                  </div>
                </div>

                <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-900 leading-relaxed">
                  💡 Jika Anda perlu pulang lebih awal (misal sakit atau keperluan mendesak), hubungi <strong>Koordinator Lapangan</strong> Anda untuk memberi <strong>Ijin Pulang Awal</strong>. Setelah disetujui, kamera akan langsung terbuka secara otomatis.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div>
                <h4 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
                  Kamera Absensi
                  {todayAtt && todayAtt.earlyClockOutApproved && !todayAtt.clockOutTime && (
                    <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-full">
                      🕗 Ijin Pulang Awal Aktif
                    </span>
                  )}
                </h4>
                <p className="text-xs text-slate-500 mb-4">Foto langsung dengan watermark nama, tim, lokasi & GPS</p>

                <CameraCapture
                  workerName={user.name}
                  workerTeam={user.team || "-"}
                  locationLabel={locationLabel}
                  lat={userLat}
                  lng={userLng}
                  companyName={settings.companyName}
                  capturedPreview={photoPreview}
                  onCapture={setPhotoPreview}
                  onClearPreview={() => setPhotoPreview("")}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Keterangan (Opsional)</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Misal: Hadir tepat waktu / Siap kerja" className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {todayAtt && !todayAtt.clockOutTime ? (
                <div className="space-y-4 pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-sm font-bold text-slate-700">Status Penyelesaian:</span>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 cursor-pointer">
                        <input type="radio" checked={!isTumbang} onChange={() => setIsTumbang(false)} className="w-4 h-4 text-emerald-600" /> <span>FINISH</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-sm font-bold text-amber-700 cursor-pointer">
                        <input type="radio" checked={isTumbang} onChange={() => setIsTumbang(true)} className="w-4 h-4 text-amber-600" /> <span>TUMBANG</span>
                      </label>
                    </div>
                  </div>
                  <button onClick={handleClockOut} disabled={loading || !photoPreview} className="w-full bg-gradient-to-r from-indigo-600 to-blue-700 hover:from-indigo-700 hover:to-blue-800 text-white font-extrabold py-4 px-6 rounded-2xl shadow-xl flex items-center justify-center gap-2 text-base disabled:opacity-50">
                    {loading && <Loader2 className="w-5 h-5 animate-spin" />}
                    <span>{loading ? "Menyimpan..." : "Kirim Absen Pulang"}</span>
                  </button>
                </div>
              ) : todayAtt && todayAtt.clockOutTime ? (
                <div className="bg-emerald-100 border border-emerald-300 text-emerald-900 p-4 rounded-2xl text-center font-bold">
                  🎉 Anda telah menyelesaikan absen masuk & pulang hari ini!
                </div>
              ) : (
                <button onClick={handleClockIn} disabled={loading || !photoPreview} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold py-4 px-6 rounded-2xl shadow-xl flex items-center justify-center gap-2 text-base disabled:opacity-50">
                  {loading && <Loader2 className="w-5 h-5 animate-spin" />}
                  <span>{loading ? "Merekam..." : "Kirim Absen Masuk"}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* History */}
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-bold text-lg text-slate-800">Riwayat Kehadiran & Status Gaji</h3>
          <span className="text-xs font-semibold text-slate-500">Tersinkron real-time Firestore</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 text-xs font-bold uppercase border-b border-slate-200">
                <th className="py-3 px-6">Tanggal</th>
                <th className="py-3 px-6">Lokasi & Shift</th>
                <th className="py-3 px-6">Jam Masuk</th>
                <th className="py-3 px-6">Jam Pulang</th>
                <th className="py-3 px-6">Status Kerja</th>
                <th className="py-3 px-6 text-center">Status Gaji</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {attendances.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400 font-medium">Belum ada riwayat absensi.</td></tr>
              ) : attendances.map((att) => (
                <tr key={att.id} className="hover:bg-slate-50">
                  <td className="py-4 px-6 font-bold text-slate-900 whitespace-nowrap">{att.date}</td>
                  <td className="py-4 px-6">
                    <div className="font-semibold text-slate-800">{att.locationName || "-"}</div>
                    <div className="text-xs text-slate-500">{att.shiftName || "-"}</div>
                  </td>
                  <td className="py-4 px-6 whitespace-nowrap">
                    <div className="flex items-start gap-2">
                      <PhotoThumb
                        url={att.clockInPhotoUrl}
                        caption={`Foto Absen Masuk · ${att.date}`}
                        subtitle={`${att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID") : "-"} • ${att.clockInLocationLabel || ""}`}
                        size="sm"
                        openPhoto={openPhoto}
                      />
                      <div>
                        <div className="font-semibold">{att.clockInTime ? new Date(att.clockInTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}</div>
                        {att.clockInStatus === "late" && <div className="text-[10px] text-red-600 font-bold">Terlambat</div>}
                        {att.clockInStatus === "pending_approval" && <div className="text-[10px] text-amber-600 font-bold">Menunggu Persetujuan</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6 whitespace-nowrap">
                    <div className="flex items-start gap-2">
                      <PhotoThumb
                        url={att.clockOutPhotoUrl}
                        caption={`Foto Absen Pulang · ${att.date}`}
                        subtitle={`${att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID") : "-"} • ${att.clockOutLocationLabel || ""}`}
                        size="sm"
                        openPhoto={openPhoto}
                      />
                      <div className="font-semibold">{att.clockOutTime ? new Date(att.clockOutTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}</div>
                    </div>
                  </td>
                  <td className="py-4 px-6 whitespace-nowrap">
                    {att.workStatus === "finish" && <span className="bg-emerald-500 text-white font-bold text-xs px-2.5 py-1 rounded-full">FINISH</span>}
                    {att.workStatus === "tumbang" && <span className="bg-amber-500 text-white font-bold text-xs px-2.5 py-1 rounded-full">TUMBANG</span>}
                    {att.workStatus === "absen_masuk" && <span className="bg-blue-100 text-blue-800 font-bold text-xs px-2.5 py-1 rounded-full">Sedang Kerja</span>}
                  </td>
                  <td className="py-4 px-6 text-center whitespace-nowrap">
                    {att.isPaid ? <span className="bg-emerald-100 text-emerald-800 font-bold text-xs px-3 py-1.5 rounded-full">Terbayar ✓</span> : <span className="bg-red-100 text-red-800 font-bold text-xs px-3 py-1.5 rounded-full">Belum Dibayar</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Popup foto Cloudinary */}
      <PhotoModal
        url={photo?.url || null}
        caption={photo?.caption}
        subtitle={photo?.subtitle}
        onClose={closePhoto}
      />
    </div>
  );
}
