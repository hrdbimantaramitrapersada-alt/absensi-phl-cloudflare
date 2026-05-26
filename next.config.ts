import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  //output: 'export', // <-- Pastikan 'o' kecil dan ada koma (,) di ujungnya!
  images: {
    unoptimized: true, // <-- Pastikan ada koma (,) di ujungnya!
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
};

export default nextConfig;
