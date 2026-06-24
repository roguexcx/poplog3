"use client";

import Link from "next/link";
import { Orbit } from "lucide-react";

import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import type { TitleUniverse } from "./types";

type TitleUniverseSectionProps = {
  universe?: TitleUniverse | null;
};

export default function TitleUniverseSection({
  universe,
}: TitleUniverseSectionProps) {
  const parts = universe?.parts ?? [];
  if (!universe || parts.length === 0) return null;

  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-cyan-400/[0.14] bg-[linear-gradient(135deg,rgba(8,145,178,0.08)_0%,rgba(14,165,233,0.035)_48%,rgba(17,24,39,0.28)_100%)] p-5 shadow-[inset_0_1px_0_rgba(103,232,249,0.07)] backdrop-blur-sm sm:p-6">
      <div className="relative mb-5 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-400/[0.12] text-cyan-200">
          <Orbit className="h-[15px] w-[15px]" strokeWidth={2.2} />
        </div>

        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-cyan-200/55">Universo Compartilhado</p>
          <h2 className="mt-0.5 truncate text-[15px] font-black tracking-[-0.025em] text-white/92">
            {universe.name}
          </h2>
        </div>

        <span className="ml-auto shrink-0 rounded-full border border-cyan-300/20 bg-cyan-400/[0.10] px-2.5 py-1 text-[10px] font-black text-cyan-100/70">
          {parts.length} {parts.length === 1 ? "título" : "títulos"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {parts.map((part) => (
          <Link
            key={`${part.mediaType ?? "movie"}:${part.id}`}
            href={`/title/${part.mediaType ?? "movie"}/${part.id}`}
            className="group block"
          >
            <article>
              <div className="relative overflow-hidden rounded-[1rem] border border-white/[0.08] bg-white/[0.035] shadow-[0_12px_34px_rgba(0,0,0,0.30)] transition duration-300 group-hover:-translate-y-1 group-hover:border-cyan-300/30">
                <div className="relative aspect-[2/3] overflow-hidden">
                  <TmdbImage
                    path={part.posterPath ?? null}
                    fallbackPath={null}
                    size="w500"
                    alt={part.title}
                    fallbackLabel={part.title}
                    className="h-full w-full object-cover brightness-[0.92] transition duration-500 group-hover:scale-[1.045] group-hover:brightness-100"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/10" aria-hidden />
                </div>
              </div>

              <div className="px-0.5 pt-2.5">
                <p className="line-clamp-2 text-[12px] font-semibold leading-[1.35] text-white/86">
                  {part.title}
                </p>
                {part.year && (
                  <p className="mt-1 text-[11px] text-white/32">{part.year}</p>
                )}
              </div>
            </article>
          </Link>
        ))}
      </div>
    </section>
  );
}
