import { Attendance, Shift } from "./types";

export type EffectiveWorkStatus = "absen_masuk" | "finish" | "tumbang" | "auto_tumbang";

export interface EffectiveStatusInfo {
  status: EffectiveWorkStatus;
  isAuto: boolean;       // true kalau dihitung otomatis (bukan dari Firestore)
  reason?: string;       // alasan untuk tooltip / audit
}

/**
 * Hitung "jam pulang" akhir (dengan toleransi) untuk satu absensi.
 * Pekerja yang sudah melewati waktu ini DAN belum clock-out → dianggap TUMBANG otomatis.
 *
 * Return null kalau shift tidak ada / tanggal absen kosong.
 */
export function computeShiftEndDeadlineMs(
  att: Attendance,
  shifts: Shift[],
  toleranceHours = 1
): number | null {
  if (!att.date || !att.shiftId) return null;
  const shift = shifts.find((s) => s.id === att.shiftId);
  if (!shift || !shift.endTime) return null;

  const [eh, em] = shift.endTime.split(":").map(Number);
  if (isNaN(eh) || isNaN(em)) return null;

  // Parse tanggal absen sebagai local time (YYYY-MM-DD)
  const [y, mo, d] = att.date.split("-").map(Number);
  if (!y || !mo || !d) return null;

  const endDate = new Date(y, mo - 1, d, eh, em, 0, 0);
  if (shift.rolloverNextDay) {
    // shift menyebrang hari → jam pulang besok-nya tanggal absen
    endDate.setDate(endDate.getDate() + 1);
  }

  return endDate.getTime() + toleranceHours * 60 * 60 * 1000;
}

/**
 * Tentukan status kerja efektif untuk sebuah absensi:
 *
 * - Kalau pekerja sudah clock-out → pakai workStatus dari Firestore (finish/tumbang)
 * - Kalau belum clock-out:
 *     - Sekarang masih dalam jadwal kerja → "absen_masuk" (sedang kerja)
 *     - Sekarang sudah lewat jam pulang + toleransi → "auto_tumbang"
 *       (di UI tetap ditampilkan sebagai TUMBANG, dengan badge "Otomatis")
 *
 * @param nowMs - waktu sekarang dalam ms (untuk testability)
 */
export function computeEffectiveStatus(
  att: Attendance,
  shifts: Shift[],
  toleranceHours = 1,
  nowMs: number = Date.now()
): EffectiveStatusInfo {
  // Sudah clock-out → status sudah final dari pekerja sendiri
  if (att.clockOutTime) {
    return {
      status: (att.workStatus || "finish") as EffectiveWorkStatus,
      isAuto: false,
    };
  }

  // Belum clock-out: cek apakah sudah lewat jam pulang + toleransi
  const deadlineMs = computeShiftEndDeadlineMs(att, shifts, toleranceHours);
  if (deadlineMs === null) {
    // Tidak ada shift terdeteksi → biarkan apa adanya
    return {
      status: (att.workStatus || "absen_masuk") as EffectiveWorkStatus,
      isAuto: false,
    };
  }

  if (nowMs > deadlineMs) {
    return {
      status: "auto_tumbang",
      isAuto: true,
      reason: `Lewat ${toleranceHours} jam setelah jam pulang shift, pekerja tidak absen pulang. Otomatis ditandai TUMBANG.`,
    };
  }

  // Masih dalam jadwal kerja
  return { status: "absen_masuk", isAuto: false };
}

/**
 * Label tampilan untuk status efektif.
 */
export function statusLabel(s: EffectiveWorkStatus): { text: string; color: string } {
  switch (s) {
    case "finish": return { text: "FINISH", color: "bg-emerald-500 text-white" };
    case "tumbang": return { text: "TUMBANG", color: "bg-amber-500 text-white" };
    case "auto_tumbang": return { text: "TUMBANG (Otomatis)", color: "bg-orange-500 text-white" };
    case "absen_masuk":
    default: return { text: "Sedang Kerja", color: "bg-blue-100 text-blue-800" };
  }
}
