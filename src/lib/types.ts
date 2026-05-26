// Shared types used across the app (Firestore-based, no PostgreSQL)

export type UserRole = "admin" | "koordinator" | "pekerja";
export type UserStatus = "pending" | "active" | "inactive";
export type WorkStatus = "absen_masuk" | "finish" | "tumbang";
export type ClockStatus = "on_time" | "late" | "pending_approval" | "exception_approved" | "completed" | null;

export interface AppUser {
  id: string; // Firestore doc id
  role: UserRole;
  username: string; // adminbimantara, koordinator, or NIK
  password: string;
  name: string;
  nik: string;
  phone: string;
  team: string;
  ktpPhotoUrl: string;
  status: UserStatus;
  dailyWage: number; // for pekerja only; koordinator has 0
  createdAt: number; // ms
}

export interface WorkLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number; // meters
  isDefault: boolean;
  createdAt: number;
}

export interface Shift {
  id: string;
  name: string;
  startTime: string; // "HH:MM"
  endTime: string;
  lateToleranceMinutes: number;
  // Untuk shift sore/malam yang pulangnya keesokan harinya
  // (mis. masuk 22:00 → pulang 06:00 keesokan hari)
  rolloverNextDay?: boolean;
  isDefault: boolean;
  createdAt: number;
}

// Team master list — editable by Admin
export interface Team {
  id: string;
  name: string;
  createdAt: number;
}

// Date-range override tarif (mis. lembur 17–20 Agustus, periode proyek tertentu)
export interface WageRate {
  id: string;
  // Periode berlaku tarif (inklusif). Untuk satu hari, isi sama.
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
  // Legacy field, masih dibaca demi backward compatibility data lama
  date?: string;
  amount: number;         // Rp per hari
  appliesToTeam?: string; // optional, kalau kosong = berlaku semua tim
  note: string;           // keterangan kenapa tarif beda
  createdAt: number;
}

export interface Attendance {
  id: string;
  userId: string;
  userName: string; // denormalized for fast reads
  userNik: string;
  userPhone: string;
  userTeam: string;

  date: string; // YYYY-MM-DD
  shiftId: string | null;
  shiftName: string | null;
  locationId: string | null;
  locationName: string | null;

  clockInTime: number | null; // ms
  clockInPhotoUrl: string | null;
  clockInLat: number | null;
  clockInLng: number | null;
  clockInNotes: string;
  clockInStatus: ClockStatus;
  clockInLocationLabel: string; // marker text yang di-burn ke foto

  clockOutTime: number | null;
  clockOutPhotoUrl: string | null;
  clockOutLat: number | null;
  clockOutLng: number | null;
  clockOutNotes: string;
  clockOutStatus: ClockStatus;
  clockOutLocationLabel: string;

  workStatus: WorkStatus;
  koordinatorNote: string;

  // Ijin pulang lebih awal dari koordinator/admin
  // (kalau true, pekerja boleh clock-out sebelum jam pulang shift)
  earlyClockOutApproved?: boolean;
  earlyClockOutApprovedBy?: string;

  // Snapshot tarif gaji untuk hari ini (default = user.dailyWage, dapat di-override oleh WageRate)
  wageAmount: number;

  isPaid: boolean;
  paidDate: number | null;
  paidBy: string;

  createdAt: number;
}

// Global app settings (single document in 'settings' collection, id='app')
export interface AppSettings {
  googleSpreadsheetUrl: string;
  companyName: string;
  // Berapa jam toleransi setelah jam pulang shift sebelum dianggap TUMBANG (default 1 jam)
  autoTumbangToleranceHours?: number;
  updatedAt: number;
}

// Session shape stored in localStorage
export interface SessionUser {
  id: string;
  role: UserRole;
  username: string;
  name: string;
  status: UserStatus;
  team: string;
  phone: string;
  dailyWage: number;
}
