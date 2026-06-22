// src/components/CinematicBackground.tsx
"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type Props = {
  images: string[];
  interval?: number;
};

export default function CinematicBackground({ images, interval = 12000 }: Props) {
  const safeImages = images.filter(Boolean);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextIndex, setNextIndex] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (safeImages.length <= 1) return;

    const timer = setInterval(() => {
      const upcoming = (currentIndex + 1) % safeImages.length;
      setNextIndex(upcoming);
      setIsTransitioning(true);

      setTimeout(() => {
        setCurrentIndex(upcoming);
        setIsTransitioning(false);
      }, 1800);
    }, interval);

    return () => clearInterval(timer);
  }, [currentIndex, interval, safeImages.length]);

  if (safeImages.length === 0) return null;

  const sharedImageClass =
    "object-cover object-center brightness-[0.82] contrast-[1.12] saturate-[1.18] transition-opacity duration-[1800ms] ease-in-out";

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Imagem atual */}
      <div className="absolute inset-0">
        <Image
          src={safeImages[currentIndex]}
          alt=""
          fill
          priority
          quality={100}
          sizes="100vw"
          className={[sharedImageClass, isTransitioning ? "opacity-0" : "opacity-100"].join(" ")}
        />
      </div>

      {/* Próxima imagem (crossfade) */}
      <div className="absolute inset-0">
        <Image
          src={safeImages[nextIndex] ?? safeImages[0]}
          alt=""
          fill
          priority
          quality={100}
          sizes="100vw"
          className={[sharedImageClass, isTransitioning ? "opacity-100" : "opacity-0"].join(" ")}
        />
      </div>

      {/* Overlays */}
      <div className="absolute inset-0 bg-[rgba(2,6,23,0.52)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.14),transparent_45%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.74)_0%,rgba(2,6,23,0.44)_35%,rgba(2,6,23,0.88)_100%)]" />
      <div className="absolute right-0 top-0 h-full w-[40%] bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.10),transparent_70%)]" />
    </div>
  );
}