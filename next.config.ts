import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Todas as imagens de fontes externas (Trakt, TVDB, TMDB, Amazon, YouTube, etc.)
      // são servidas via /api/images/proxy — não expor CDNs externos diretamente no <img>.
      // Ver src/lib/images/proxy.ts para a lista de domínios autorizados.
      //
      // Mantém apenas origem própria para imagens gerenciadas fora do proxy
      // (ex: avatar OAuth do usuário em contextos onde proxy não se aplica).
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
    unoptimized: true,
    qualities: [75, 100],
  },
};

export default nextConfig;
