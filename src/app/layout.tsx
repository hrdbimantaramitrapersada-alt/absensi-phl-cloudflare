import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Absensi PHL BIMANTARA (PT. Bimantara Mitra Persada)",
  description: "Sistem Absensi Pekerja Harian Lepas dengan verifikasi foto dan GPS",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased font-sans flex flex-col">
        {children}
      </body>
    </html>
  );
}
