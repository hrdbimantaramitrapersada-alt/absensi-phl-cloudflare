import { Attendance } from "./types";
import { computeEffectiveStatus, EffectiveStatusInfo } from "./attendance-helpers";

/**
 * Builder baris Rekap Absensi (untuk Excel + Copy ke Spreadsheet).
 * Pemakai harus pass-in shifts & toleransi agar status auto-tumbang ikut ter-export.
 */
export function buildAttendanceRows(
  attendances: Attendance[],
  effectiveStatusOf: (att: Attendance) => EffectiveStatusInfo
) {
  return attendances.map((att, i) => {
    const eff = effectiveStatusOf(att);
    const statusKerja =
      eff.status === "finish" ? "FINISH" :
      eff.status === "tumbang" ? "TUMBANG" :
      eff.status === "auto_tumbang" ? "TUMBANG (otomatis - tidak absen pulang)" :
      "BELUM SELESAI";

    return {
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
      "Status Kerja": statusKerja,
      "Catatan Koordinator": att.koordinatorNote || "-",
      "Tarif Hari Itu": att.wageAmount || 0,
      "Status Gaji": att.isPaid ? `Terbayar (${att.paidBy || "-"})` : "Belum Terbayar",
    };
  });
}

/**
 * Salin TSV ke clipboard (untuk paste ke Google Sheets / Excel).
 */
export async function copyRowsToClipboard(rows: Record<string, any>[]): Promise<boolean> {
  if (rows.length === 0) return false;
  const headers = Object.keys(rows[0]).join("\t");
  const data = rows.map((r) => Object.values(r).join("\t")).join("\n");
  await navigator.clipboard.writeText(`${headers}\n${data}`);
  return true;
}
