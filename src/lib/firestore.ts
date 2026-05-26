"use client";

import { db } from "./firebase";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { AppUser, WorkLocation, Shift, Attendance, UserStatus, AppSettings, Team, WageRate } from "./types";

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------

const USERS_COL = "users";

export async function findUserByUsername(username: string): Promise<AppUser | null> {
  const q = query(collection(db, USERS_COL), where("username", "==", username));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<AppUser, "id">) };
}

export async function findUserByNik(nik: string): Promise<AppUser | null> {
  const q = query(collection(db, USERS_COL), where("nik", "==", nik));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<AppUser, "id">) };
}

export async function createUser(payload: Omit<AppUser, "id" | "createdAt"> & { createdAt?: number }): Promise<AppUser> {
  const data = { ...payload, createdAt: payload.createdAt ?? Date.now() };
  const ref = await addDoc(collection(db, USERS_COL), data);
  return { id: ref.id, ...data };
}

export async function updateUser(id: string, patch: Partial<AppUser>): Promise<void> {
  await updateDoc(doc(db, USERS_COL, id), patch);
}

export async function deleteUser(id: string): Promise<void> {
  await deleteDoc(doc(db, USERS_COL, id));
}

/**
 * Hapus user beserta SELURUH absensinya (cascade delete).
 * Mengembalikan jumlah absensi yang ikut terhapus.
 */
export async function deleteUserCascade(userId: string): Promise<{ deletedAttendances: number }> {
  const attSnap = await getDocs(query(collection(db, ATTENDANCES_COL), where("userId", "==", userId)));
  const batch = writeBatch(db);
  attSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, USERS_COL, userId));
  await batch.commit();
  return { deletedAttendances: attSnap.size };
}

/**
 * Hitung jumlah absensi milik user (untuk konfirmasi sebelum hapus).
 */
export async function countAttendancesForUser(userId: string): Promise<number> {
  const snap = await getDocs(query(collection(db, ATTENDANCES_COL), where("userId", "==", userId)));
  return snap.size;
}

export function subscribeUsers(cb: (users: AppUser[]) => void): Unsubscribe {
  const q = query(collection(db, USERS_COL), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const list: AppUser[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppUser, "id">) }));
    cb(list);
  });
}

// ---------------------------------------------------------------------------
// LOCATIONS
// ---------------------------------------------------------------------------

const LOCATIONS_COL = "locations";

export async function createLocation(payload: Omit<WorkLocation, "id" | "createdAt">): Promise<WorkLocation> {
  if (payload.isDefault) await clearDefaultLocations();
  const data = { ...payload, createdAt: Date.now() };
  const ref = await addDoc(collection(db, LOCATIONS_COL), data);
  return { id: ref.id, ...data };
}

export async function updateLocation(id: string, patch: Partial<WorkLocation>): Promise<void> {
  if (patch.isDefault) await clearDefaultLocations();
  await updateDoc(doc(db, LOCATIONS_COL, id), patch);
}

export async function deleteLocation(id: string): Promise<void> {
  await deleteDoc(doc(db, LOCATIONS_COL, id));
}

async function clearDefaultLocations() {
  const snap = await getDocs(collection(db, LOCATIONS_COL));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { isDefault: false }));
  await batch.commit();
}

export function subscribeLocations(cb: (locs: WorkLocation[]) => void): Unsubscribe {
  return onSnapshot(collection(db, LOCATIONS_COL), (snap) => {
    const list: WorkLocation[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkLocation, "id">) }));
    list.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || b.createdAt - a.createdAt);
    cb(list);
  });
}

// ---------------------------------------------------------------------------
// SHIFTS
// ---------------------------------------------------------------------------

const SHIFTS_COL = "shifts";

export async function createShift(payload: Omit<Shift, "id" | "createdAt">): Promise<Shift> {
  if (payload.isDefault) await clearDefaultShifts();
  const data = { ...payload, createdAt: Date.now() };
  const ref = await addDoc(collection(db, SHIFTS_COL), data);
  return { id: ref.id, ...data };
}

export async function updateShift(id: string, patch: Partial<Shift>): Promise<void> {
  if (patch.isDefault) await clearDefaultShifts();
  await updateDoc(doc(db, SHIFTS_COL, id), patch);
}

export async function deleteShift(id: string): Promise<void> {
  await deleteDoc(doc(db, SHIFTS_COL, id));
}

async function clearDefaultShifts() {
  const snap = await getDocs(collection(db, SHIFTS_COL));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { isDefault: false }));
  await batch.commit();
}

export function subscribeShifts(cb: (shifts: Shift[]) => void): Unsubscribe {
  return onSnapshot(collection(db, SHIFTS_COL), (snap) => {
    const list: Shift[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Shift, "id">) }));
    list.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || b.createdAt - a.createdAt);
    cb(list);
  });
}

// ---------------------------------------------------------------------------
// ATTENDANCES
// ---------------------------------------------------------------------------

const ATTENDANCES_COL = "attendances";

export async function createAttendance(payload: Omit<Attendance, "id" | "createdAt">): Promise<Attendance> {
  const data = { ...payload, createdAt: Date.now() };
  const ref = await addDoc(collection(db, ATTENDANCES_COL), data);
  return { id: ref.id, ...data };
}

export async function updateAttendance(id: string, patch: Partial<Attendance>): Promise<void> {
  await updateDoc(doc(db, ATTENDANCES_COL, id), patch);
}

/**
 * Hapus 1 dokumen absensi (reset/ulang absensi).
 * Setelah dipanggil, pekerja boleh absen masuk lagi pada tanggal yang sama.
 */
export async function deleteAttendance(id: string): Promise<void> {
  await deleteDoc(doc(db, ATTENDANCES_COL, id));
}

/**
 * Reset hanya bagian absen pulang (clock-out) saja → pekerja bisa absen pulang ulang.
 * Absen masuk tetap utuh.
 */
export async function resetClockOut(id: string): Promise<void> {
  await updateDoc(doc(db, ATTENDANCES_COL, id), {
    clockOutTime: null,
    clockOutPhotoUrl: null,
    clockOutLat: null,
    clockOutLng: null,
    clockOutNotes: "",
    clockOutStatus: null,
    clockOutLocationLabel: "",
    workStatus: "absen_masuk",
  });
}

export async function findTodayAttendance(userId: string, dateStr: string): Promise<Attendance | null> {
  const q = query(
    collection(db, ATTENDANCES_COL),
    where("userId", "==", userId),
    where("date", "==", dateStr)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<Attendance, "id">) };
}

/**
 * Subscribe ke attendances dengan filter opsional.
 * - Jika userId diberikan → hanya absensi user itu (untuk dashboard pekerja)
 * - Jika sinceDate diberikan (YYYY-MM-DD) → hanya absensi dari tanggal itu ke atas
 *   (penting untuk hemat Firestore read di koordinator/admin dashboard)
 */
/**
 * Normalisasi dokumen attendance dari Firestore agar tahan banting
 * terhadap data legacy / corrupt (mis. impor manual yang tidak lengkap).
 * Semua field wajib di-default ke nilai yang aman dirender.
 */
function normalizeAttendance(raw: any, id: string): Attendance {
  // Convert clockInTime/clockOutTime → number (ms), terima number atau ISO string
  const toMs = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    // Firestore Timestamp
    if (typeof v?.toMillis === "function") return v.toMillis();
    return null;
  };

  return {
    id,
    userId: String(raw.userId || ""),
    userName: String(raw.userName || "(tanpa nama)"),
    userNik: String(raw.userNik || "-"),
    userPhone: String(raw.userPhone || ""),
    userTeam: String(raw.userTeam || "-"),

    date: String(raw.date || ""),
    shiftId: raw.shiftId ?? null,
    shiftName: raw.shiftName ?? null,
    locationId: raw.locationId ?? null,
    locationName: raw.locationName ?? null,

    clockInTime: toMs(raw.clockInTime),
    clockInPhotoUrl: raw.clockInPhotoUrl ?? null,
    clockInLat: typeof raw.clockInLat === "number" ? raw.clockInLat : null,
    clockInLng: typeof raw.clockInLng === "number" ? raw.clockInLng : null,
    clockInNotes: String(raw.clockInNotes || ""),
    clockInStatus: raw.clockInStatus ?? null,
    clockInLocationLabel: String(raw.clockInLocationLabel || ""),

    clockOutTime: toMs(raw.clockOutTime),
    clockOutPhotoUrl: raw.clockOutPhotoUrl ?? null,
    clockOutLat: typeof raw.clockOutLat === "number" ? raw.clockOutLat : null,
    clockOutLng: typeof raw.clockOutLng === "number" ? raw.clockOutLng : null,
    clockOutNotes: String(raw.clockOutNotes || ""),
    clockOutStatus: raw.clockOutStatus ?? null,
    clockOutLocationLabel: String(raw.clockOutLocationLabel || ""),

    workStatus: (raw.workStatus || "absen_masuk") as Attendance["workStatus"],
    koordinatorNote: String(raw.koordinatorNote || ""),

    earlyClockOutApproved: !!raw.earlyClockOutApproved,
    earlyClockOutApprovedBy: raw.earlyClockOutApprovedBy || "",

    wageAmount: typeof raw.wageAmount === "number" ? raw.wageAmount : 0,
    isPaid: !!raw.isPaid,
    paidDate: toMs(raw.paidDate),
    paidBy: String(raw.paidBy || ""),

    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : (toMs(raw.createdAt) ?? 0),
  };
}

export function subscribeAttendances(
  cb: (atts: Attendance[]) => void,
  userId?: string,
  sinceDate?: string
): Unsubscribe {
  const ref = collection(db, ATTENDANCES_COL);
  const filters: any[] = [];
  if (userId) filters.push(where("userId", "==", userId));
  if (sinceDate) filters.push(where("date", ">=", sinceDate));
  const q = filters.length > 0 ? query(ref, ...filters) : query(ref);
  return onSnapshot(q, (snap) => {
    const list: Attendance[] = [];
    snap.docs.forEach((d) => {
      try {
        list.push(normalizeAttendance(d.data(), d.id));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[Firestore] Lewati doc absensi rusak ${d.id}:`, err);
      }
    });
    list.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.createdAt - a.createdAt;
    });
    cb(list);
  });
}

/**
 * Helper: kembalikan YYYY-MM-DD untuk N hari yang lalu (default 90 hari).
 * Dipakai sebagai default sinceDate di dashboard admin/koordinator
 * agar tidak load seluruh history (hemat baca Firestore).
 */
export function dateNDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// TEAMS (master list, editable by admin)
// ---------------------------------------------------------------------------

const TEAMS_COL = "teams";

export async function createTeam(name: string): Promise<Team> {
  const data = { name: name.trim(), createdAt: Date.now() };
  const ref = await addDoc(collection(db, TEAMS_COL), data);
  return { id: ref.id, ...data };
}

export async function updateTeam(id: string, newName: string, oldName?: string): Promise<void> {
  const trimmed = newName.trim();
  await updateDoc(doc(db, TEAMS_COL, id), { name: trimmed });
  // Cascade: update all users in oldName → newName so existing pekerja tetap konsisten
  if (oldName && oldName !== trimmed) {
    const usersSnap = await getDocs(query(collection(db, USERS_COL), where("team", "==", oldName)));
    const batch = writeBatch(db);
    usersSnap.docs.forEach((d) => batch.update(d.ref, { team: trimmed }));
    await batch.commit();
  }
}

export async function deleteTeam(id: string): Promise<void> {
  await deleteDoc(doc(db, TEAMS_COL, id));
}

export function subscribeTeams(cb: (teams: Team[]) => void): Unsubscribe {
  return onSnapshot(collection(db, TEAMS_COL), (snap) => {
    const list: Team[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Team, "id">) }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    cb(list);
  });
}

// ---------------------------------------------------------------------------
// WAGE RATES (tarif gaji harian khusus untuk tanggal tertentu)
// ---------------------------------------------------------------------------

const WAGE_RATES_COL = "wage_rates";

export async function createWageRate(payload: Omit<WageRate, "id" | "createdAt">): Promise<WageRate> {
  const data = { ...payload, createdAt: Date.now() };
  const ref = await addDoc(collection(db, WAGE_RATES_COL), data);
  return { id: ref.id, ...data };
}

export async function updateWageRate(id: string, patch: Partial<WageRate>): Promise<void> {
  await updateDoc(doc(db, WAGE_RATES_COL, id), patch);
}

export async function deleteWageRate(id: string): Promise<void> {
  await deleteDoc(doc(db, WAGE_RATES_COL, id));
}

/**
 * Normalize wage rate (backwards compatibility: old docs use `date`, new docs use `startDate`/`endDate`).
 */
function normalizeWageRate(raw: any, id: string): WageRate {
  const start = raw.startDate || raw.date || "";
  const end = raw.endDate || raw.date || start;
  return {
    id,
    startDate: start,
    endDate: end,
    date: raw.date,
    amount: Number(raw.amount) || 0,
    appliesToTeam: raw.appliesToTeam || undefined,
    note: raw.note || "",
    createdAt: raw.createdAt || 0,
  };
}

export function subscribeWageRates(cb: (rates: WageRate[]) => void): Unsubscribe {
  return onSnapshot(collection(db, WAGE_RATES_COL), (snap) => {
    const list: WageRate[] = snap.docs.map((d) => normalizeWageRate(d.data(), d.id));
    list.sort((a, b) => b.startDate.localeCompare(a.startDate));
    cb(list);
  });
}

/**
 * Hitung tarif harian untuk pekerja tertentu pada tanggal tertentu.
 * Prioritas: WageRate range yang match team → WageRate range global → default user.dailyWage.
 */
export async function resolveWageForDate(userTeam: string, dateStr: string, fallback: number): Promise<number> {
  // Ambil semua wage rates yang startDate <= dateStr
  const q = query(collection(db, WAGE_RATES_COL), where("startDate", "<=", dateStr));
  const snap = await getDocs(q);

  const rates: WageRate[] = snap.docs
    .map((d) => normalizeWageRate(d.data(), d.id))
    .filter((r) => r.endDate >= dateStr); // tanggal masih dalam range

  // Juga ambil data legacy yang masih pakai field `date` (== dateStr) tanpa startDate
  const legacyQ = query(collection(db, WAGE_RATES_COL), where("date", "==", dateStr));
  const legacySnap = await getDocs(legacyQ);
  legacySnap.docs.forEach((d) => {
    const raw = d.data() as any;
    if (!raw.startDate) rates.push(normalizeWageRate(raw, d.id));
  });

  if (rates.length === 0) return fallback;

  // Team-specific lebih prioritas
  const teamSpecific = rates.find((r) => r.appliesToTeam && r.appliesToTeam === userTeam);
  if (teamSpecific) return teamSpecific.amount;
  const global = rates.find((r) => !r.appliesToTeam);
  if (global) return global.amount;
  return fallback;
}

// ---------------------------------------------------------------------------
// APP SETTINGS (single document)
// ---------------------------------------------------------------------------

const SETTINGS_COL = "settings";
const SETTINGS_DOC_ID = "app";

export async function getAppSettings(): Promise<AppSettings> {
  const ref = doc(db, SETTINGS_COL, SETTINGS_DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const initial: AppSettings = {
      googleSpreadsheetUrl: "",
      companyName: "PT. Bimantara Mitra Persada",
      updatedAt: Date.now(),
    };
    await setDoc(ref, initial);
    return initial;
  }
  return snap.data() as AppSettings;
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const ref = doc(db, SETTINGS_COL, SETTINGS_DOC_ID);
  await setDoc(ref, { ...patch, updatedAt: Date.now() }, { merge: true });
}

export function subscribeAppSettings(cb: (s: AppSettings) => void): Unsubscribe {
  const ref = doc(db, SETTINGS_COL, SETTINGS_DOC_ID);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      cb(snap.data() as AppSettings);
    } else {
      cb({ googleSpreadsheetUrl: "", companyName: "PT. Bimantara Mitra Persada", updatedAt: Date.now() });
    }
  });
}

// ---------------------------------------------------------------------------
// SEED defaults (admin, koordinator, default location, default shift)
// ---------------------------------------------------------------------------

export async function ensureSeedData(): Promise<void> {
  // Admin
  const admin = await findUserByUsername("adminbimantara");
  if (!admin) {
    await createUser({
      role: "admin",
      username: "adminbimantara",
      password: "Surabaya26",
      name: "Super Admin BIMANTARA",
      nik: "0000000000000001",
      phone: "081234567890",
      team: "Manajemen",
      ktpPhotoUrl: "",
      status: "active",
      dailyWage: 0,
    });
  }

  // Koordinator (tidak menerima gaji harian → dailyWage = 0)
  const koord = await findUserByUsername("koordinator");
  if (!koord) {
    await createUser({
      role: "koordinator",
      username: "koordinator",
      password: "Surabaya26",
      name: "Koordinator Lapangan",
      nik: "0000000000000002",
      phone: "081298765432",
      team: "Koordinator",
      ktpPhotoUrl: "",
      status: "active",
      dailyWage: 0,
    });
  } else if ((koord.dailyWage ?? 0) !== 0) {
    // Migrasi: pastikan dailyWage koordinator selalu 0
    await updateUser(koord.id, { dailyWage: 0 });
  }

  // Default location
  const locSnap = await getDocs(collection(db, LOCATIONS_COL));
  if (locSnap.empty) {
    await createLocation({
      name: "Kantor Pusat Surabaya (PT. Bimantara Mitra Persada)",
      latitude: -7.250445,
      longitude: 112.768845,
      radius: 100,
      isDefault: true,
    });
  }

  // Default shift
  const shiftSnap = await getDocs(collection(db, SHIFTS_COL));
  if (shiftSnap.empty) {
    await createShift({
      name: "Shift Reguler Pagi",
      startTime: "07:00",
      endTime: "16:00",
      lateToleranceMinutes: 30,
      isDefault: true,
    });
  }

  // Default teams
  const teamsSnap = await getDocs(collection(db, TEAMS_COL));
  if (teamsSnap.empty) {
    const defaults = ["Tim Lapangan", "Tim Proyek A", "Tim Kebersihan", "Tim Konstruksi", "Tim Logistik"];
    for (const t of defaults) await createTeam(t);
  }

  // App settings (ensures the document exists with sensible defaults)
  await getAppSettings();
}
