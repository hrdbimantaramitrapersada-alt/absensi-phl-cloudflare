"use client";

import React, { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, X, CheckCircle2, AlertTriangle, RotateCcw, FlipHorizontal2 } from "lucide-react";
import { startCamera, stopStream, captureWithWatermark } from "@/lib/camera";

interface CameraCaptureProps {
  workerName: string;
  workerTeam: string;
  locationLabel: string;
  lat: number | null;
  lng: number | null;
  companyName?: string;
  onCapture: (dataUrl: string) => void;
  capturedPreview?: string;
  onClearPreview?: () => void;
}

/**
 * Live camera preview component with built-in watermark.
 * NO file picker / browse — only direct camera capture.
 */
export function CameraCapture({
  workerName,
  workerTeam,
  locationLabel,
  lat,
  lng,
  companyName,
  onCapture,
  capturedPreview,
  onClearPreview,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Live clock ticking so the timestamp on the overlay stays current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const open = async (facingMode: "user" | "environment" = facing) => {
    setError("");
    setLoading(true);
    setReady(false);
    try {
      stopStream(streamRef.current);
      const s = await startCamera(facingMode);
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
        setReady(true);
      }
    } catch (err: any) {
      setError(err?.message || "Tidak dapat mengakses kamera. Pastikan ijin kamera diaktifkan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!capturedPreview) open(facing);
    return () => stopStream(streamRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const swapCamera = async () => {
    const next: "user" | "environment" = facing === "user" ? "environment" : "user";
    setFacing(next);
    await open(next);
  };

  const handleShoot = () => {
    if (!videoRef.current) return;
    try {
      const dataUrl = captureWithWatermark(
        videoRef.current,
        {
          name: workerName,
          team: workerTeam,
          locationLabel,
          lat,
          lng,
          timestampMs: Date.now(),
          company: companyName,
        }
      );
      onCapture(dataUrl);
      stopStream(streamRef.current);
    } catch (err: any) {
      setError(err?.message || "Gagal mengambil foto.");
    }
  };

  const handleRetake = () => {
    if (onClearPreview) onClearPreview();
    setTimeout(() => open(facing), 50);
  };

  // -------- Display preview ------------------------------------------------
  if (capturedPreview) {
    return (
      <div className="space-y-3">
        <div className="relative rounded-2xl overflow-hidden bg-black shadow-lg">
          <img src={capturedPreview} alt="Foto Absen" className="w-full h-auto" />
          <div className="absolute top-3 left-3 bg-emerald-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-md flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Foto siap dikirim
          </div>
        </div>
        <button
          type="button"
          onClick={handleRetake}
          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm transition-all"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Ambil Ulang</span>
        </button>
      </div>
    );
  }

  // -------- Live camera --------------------------------------------------
  return (
    <div className="space-y-3">
      <div className="relative rounded-2xl overflow-hidden bg-slate-900 shadow-lg aspect-[4/3]">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
          style={{ transform: facing === "user" ? "scaleX(-1)" : "none" }}
        />

        {/* Live overlay simulating the watermark */}
        {ready && (
          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 via-black/55 to-transparent pointer-events-none">
            {companyName && <div className="text-blue-200 text-[10px] font-bold tracking-wide">{companyName}</div>}
            <div className="text-white text-sm font-extrabold uppercase leading-tight drop-shadow">{workerName}</div>
            <div className="text-amber-300 text-[11px] font-semibold">{workerTeam || "-"}</div>
            <div className="text-white text-[11px] font-medium mt-0.5">📍 {locationLabel}</div>
            <div className="text-emerald-200 text-[11px] font-medium font-mono">
              🛰️ {lat !== null && lng !== null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "GPS tidak tersedia"}
            </div>
            <div className="text-white text-[11px] font-bold mt-0.5">
              {new Date(now).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              {" • "}
              {new Date(now).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} WIB
            </div>
          </div>
        )}

        {/* Timestamp badge */}
        {ready && (
          <div className="absolute top-3 right-3 bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-md flex items-center gap-1">
            ● <span>{new Date(now).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        )}

        {/* Loader */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <RefreshCw className="w-10 h-10 text-white animate-spin" />
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
            <div className="space-y-3">
              <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
              <p className="text-white font-semibold">{error}</p>
              <button
                type="button"
                onClick={() => open(facing)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-sm"
              >
                Coba Lagi
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={swapCamera}
          disabled={loading || !ready}
          className="flex-shrink-0 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          title="Ganti kamera depan / belakang"
        >
          <FlipHorizontal2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleShoot}
          disabled={loading || !ready || !!error}
          className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
        >
          <Camera className="w-5 h-5" />
          <span>Jepret Foto Sekarang</span>
        </button>
      </div>
    </div>
  );
}
