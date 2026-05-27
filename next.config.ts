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
    // CinematicBackground e TitleHero usam quality={100} para evitar artefatos
    // de compressão em backdrops full-screen. Next.js 16 valida contra esta lista
    // mesmo com unoptimized:true, por isso incluímos 75 (default) e 100.
    qualities: [75, 100],
  },
};

export default nextConfig;
