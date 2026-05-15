import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
      {
        protocol: "https",
        hostname: "www.themoviedb.org",
        pathname: "/t/p/**",
      },
    ],
    // TMDB já entrega variantes pré-otimizadas (w185, w342, w500, original).
    // Não precisamos repassar pelo otimizador do next/image — economiza
    // tempo de CPU no servidor e evita o bloqueio que ocorreu antes.
    unoptimized: true,
  },
};

export default nextConfig;