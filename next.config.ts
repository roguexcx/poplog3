import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // TMDB is already an optimized CDN. Re-optimizing via Vercel
    // adds failure modes (size limits on `original` backdrops,
    // quota of 1000 images/month on Hobby, cold-start timeouts).
    // With `unoptimized: true` next/image still does lazy-load,
    // srcset and sizes — only re-encoding is skipped.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org", pathname: "/t/p/**" },
    ],
  },
};

export default nextConfig;
