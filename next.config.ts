import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow images from Cloudinary (kalau suatu saat pakai next/image)
  Output:'export'
  images: {
    unoptimized: true
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
};

export default nextConfig;
