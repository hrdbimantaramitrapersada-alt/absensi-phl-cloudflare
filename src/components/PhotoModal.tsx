"use client";

import React, { useEffect, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCw, Download, ExternalLink, Maximize2 } from "lucide-react";

interface PhotoModalProps {
  url: string | null;
  caption?: string;
  subtitle?: string;
  onClose: () => void;
}

/**
 * Modal popup besar untuk menampilkan foto dari Cloudinary
 * dengan kontrol zoom in/out, rotate, download, dan buka di tab baru.
 * Tutup dengan Esc atau klik luar.
 */
export function PhotoModal({ url, caption, subtitle, onClose }: PhotoModalProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setImgLoaded(false);
    setImgError(false);
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.25, 5));
      if (e.key === "-") setZoom((z) => Math.max(z - 0.25, 0.25));
      if (e.key.toLowerCase() === "r") setRotation((r) => (r + 90) % 360);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 inset-x-0 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-white min-w-0">
          {caption && <div className="font-bold text-sm sm:text-base truncate">{caption}</div>}
          {subtitle && <div className="text-xs text-white/70 truncate mt-0.5">{subtitle}</div>}
        </div>
        <button
          onClick={onClose}
          className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl transition-colors flex-shrink-0"
          title="Tutup (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Image area */}
      <div
        className="relative max-w-full max-h-full overflow-auto flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {!imgLoaded && !imgError && (
          <div className="text-white text-sm font-semibold flex items-center gap-2">
            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Memuat foto dari Cloudinary...
          </div>
        )}
        {imgError && (
          <div className="text-white text-sm font-semibold text-center space-y-2">
            <p>❌ Gagal memuat foto.</p>
            <a href={url} target="_blank" rel="noreferrer" className="text-blue-300 underline">Buka URL langsung</a>
          </div>
        )}
        <img
          src={url}
          alt={caption || "Foto"}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          className="max-w-[92vw] max-h-[80vh] object-contain rounded-lg shadow-2xl select-none"
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transition: "transform 0.2s ease-out",
            opacity: imgLoaded ? 1 : 0,
          }}
          draggable={false}
        />
      </div>

      {/* Bottom toolbar */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm text-white rounded-2xl px-2 py-1.5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          title="Zoom out (-)"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <span className="text-xs font-bold w-12 text-center select-none">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.25, 5))}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          title="Zoom in (+)"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          onClick={() => { setZoom(1); setRotation(0); }}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          title="Reset ukuran"
        >
          <Maximize2 className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-white/20 mx-1" />
        <button
          onClick={() => setRotation((r) => (r + 90) % 360)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          title="Putar 90° (R)"
        >
          <RotateCw className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-white/20 mx-1" />
        <a
          href={url}
          download
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          title="Unduh foto"
        >
          <Download className="w-5 h-5" />
        </a>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          title="Buka di tab baru"
        >
          <ExternalLink className="w-5 h-5" />
        </a>
      </div>

      {/* Shortcut hint */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-[10px] text-white/40 font-medium select-none pointer-events-none">
        Esc: Tutup · + / − : Zoom · R: Putar
      </div>
    </div>
  );
}

/**
 * Hook pembantu untuk mengelola state PhotoModal di komponen pemanggil.
 */
export function usePhotoModal() {
  const [photo, setPhoto] = useState<{ url: string; caption?: string; subtitle?: string } | null>(null);
  const open = (url: string, caption?: string, subtitle?: string) => {
    if (!url) return;
    setPhoto({ url, caption, subtitle });
  };
  const close = () => setPhoto(null);
  return { photo, open, close };
}

/**
 * Thumbnail clickable yang langsung buka PhotoModal saat diklik.
 * Pakai komponen ini di tabel/daftar agar foto Cloudinary konsisten dibuka via popup.
 */
export function PhotoThumb({
  url, caption, subtitle, size = "md", openPhoto,
}: {
  url: string | null | undefined;
  caption?: string;
  subtitle?: string;
  size?: "sm" | "md" | "lg";
  openPhoto: (url: string, caption?: string, subtitle?: string) => void;
}) {
  const sizes = {
    sm: "w-10 h-10",
    md: "w-14 h-14",
    lg: "w-20 h-20",
  };
  if (!url) {
    return (
      <div className={`${sizes[size]} rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 text-xs`}>
        -
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openPhoto(url, caption, subtitle); }}
      className={`${sizes[size]} block rounded-lg overflow-hidden border border-slate-200 shadow hover:ring-2 hover:ring-blue-500 hover:scale-105 transition-all flex-shrink-0 bg-slate-100 cursor-zoom-in relative group`}
      title="Klik untuk perbesar"
    >
      <img src={url} alt={caption || "Foto"} loading="lazy" className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
        <ZoomIn className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
      </div>
    </button>
  );
}
