"use client";

/**
 * Compresses an image File/Blob or data URL using HTML5 Canvas.
 * Returns a JPEG base64 data URL.
 */
export async function compressImage(
  fileOrDataUrl: File | Blob | string,
  maxWidth = 800,
  quality = 0.7
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported"));
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve(dataUrl);
    };
    img.onerror = (err) => reject(err);

    if (typeof fileOrDataUrl === "string") {
      img.src = fileOrDataUrl;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
}

const CLOUDINARY_CLOUD_NAME = "dguglx3y9";
// You can configure multiple preset names. The first that works will be used.
const CANDIDATE_PRESETS = ["absenphlbimantara", "ml_default", "unsigned_preset"];

/**
 * Uploads a base64 image to Cloudinary using an unsigned upload preset.
 * If upload fails (e.g. preset not configured yet in Cloudinary dashboard),
 * the compressed base64 data URL is returned instead, so the app still works.
 *
 * To make uploads work end-to-end, create an UNSIGNED upload preset named
 * "absenphlbimantara" in your Cloudinary dashboard:
 *   Settings → Upload → Add upload preset → Signing mode: Unsigned.
 */
export async function uploadToCloudinary(base64DataUrl: string, folder = "absensi-phl"): Promise<string> {
  for (const preset of CANDIDATE_PRESETS) {
    try {
      const formData = new FormData();
      formData.append("file", base64DataUrl);
      formData.append("upload_preset", preset);
      formData.append("folder", folder);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: "POST", body: formData }
      );
      const data = await res.json();
      if (data.secure_url) {
        return data.secure_url as string;
      }
      // If preset is wrong, try next one
      // eslint-disable-next-line no-console
      console.warn(`Cloudinary preset "${preset}" failed:`, data?.error?.message || data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Cloudinary upload error with preset "${preset}":`, err);
    }
  }

  // Fallback: return compressed base64 so the app continues to work
  // (image will be stored inside Firestore document — fine for small previews).
  // eslint-disable-next-line no-console
  console.warn("All Cloudinary presets failed — using base64 fallback. Create an unsigned preset named 'absenphlbimantara' to enable Cloudinary storage.");
  return base64DataUrl;
}
