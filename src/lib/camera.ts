"use client";

/**
 * Take a snapshot from a live MediaStream <video> element and burn watermarks
 * onto it (worker name, team, location label, GPS coords, timestamp).
 * Returns a compressed JPEG data URL.
 */
export function captureWithWatermark(
  video: HTMLVideoElement,
  watermark: {
    name: string;
    team: string;
    locationLabel: string;
    lat: number | null;
    lng: number | null;
    timestampMs: number;
    company?: string;
  },
  maxWidth = 720,
  quality = 0.7
): string {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  let w = vw;
  let h = vh;
  if (w > maxWidth) {
    h = Math.round((h * maxWidth) / w);
    w = maxWidth;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  // Draw video frame
  ctx.drawImage(video, 0, 0, w, h);

  // -------- Watermark overlay (bottom) ------------------------------------
  const padding = Math.round(w * 0.025);
  const lineGap = Math.round(w * 0.012);
  const baseFont = Math.max(11, Math.round(w * 0.028));
  const smallFont = Math.max(10, Math.round(w * 0.022));

  const ts = new Date(watermark.timestampMs);
  const dateStr = ts.toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = ts.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const gpsStr = watermark.lat !== null && watermark.lng !== null
    ? `${watermark.lat.toFixed(6)}, ${watermark.lng.toFixed(6)}`
    : "GPS tidak tersedia";

  const lines: { text: string; font: string; bold?: boolean; color?: string }[] = [
    { text: watermark.name.toUpperCase(), font: `bold ${baseFont}px Arial, sans-serif`, color: "#ffffff" },
    { text: `${watermark.team || "-"}`, font: `${smallFont}px Arial, sans-serif`, color: "#FCD34D" },
    { text: `📍 ${watermark.locationLabel}`, font: `${smallFont}px Arial, sans-serif`, color: "#ffffff" },
    { text: `🛰️  ${gpsStr}`, font: `${smallFont}px Arial, sans-serif`, color: "#A7F3D0" },
    { text: `${dateStr} • ${timeStr} WIB`, font: `bold ${smallFont}px Arial, sans-serif`, color: "#ffffff" },
  ];

  if (watermark.company) {
    lines.unshift({ text: watermark.company, font: `bold ${smallFont}px Arial, sans-serif`, color: "#93C5FD" });
  }

  const totalH = lines.length * (smallFont + lineGap) + padding * 2;
  // semi-transparent gradient background
  const grad = ctx.createLinearGradient(0, h - totalH, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.4, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - totalH, w, totalH);

  // Draw lines
  let y = h - padding;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    ctx.font = line.font;
    ctx.fillStyle = line.color || "#fff";
    // text shadow for legibility
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 3;
    ctx.fillText(line.text, padding, y);
    y -= (smallFont + lineGap);
  }
  ctx.shadowBlur = 0;

  // Small top-right badge with timestamp
  const badge = timeStr;
  ctx.font = `bold ${smallFont}px Arial, sans-serif`;
  const tw = ctx.measureText(badge).width;
  const bx = w - tw - padding * 1.5;
  const by = padding * 1.5;
  ctx.fillStyle = "rgba(220, 38, 38, 0.9)";
  ctx.fillRect(bx - 8, by - smallFont, tw + 16, smallFont + 8);
  ctx.fillStyle = "#fff";
  ctx.fillText(badge, bx, by);

  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Start camera stream. Tries front camera first (selfie). Returns the stream.
 */
export async function startCamera(facingMode: "user" | "environment" = "user"): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Kamera tidak didukung di perangkat / browser ini.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    // Fallback: any camera
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

export function stopStream(stream: MediaStream | null) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}
