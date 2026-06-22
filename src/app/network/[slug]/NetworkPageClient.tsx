"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useCallback } from "react";

type NetworkTitle = {
  id: string;
  tmdbId: number;
  imdbId: string | null;
  mediaType: string;
  title: string | null;
  year: number | null;
  posterUrl: string | null;
  rating: number | null;
  genres: string[];
};

type NetworkPageClientProps = {
  slug: string;
  displayName: string;
  initialTitles: NetworkTitle[];
  initialTotal: number;
  pageSize: number;
};

function buildTitleHref(title: NetworkTitle): string {
  const mediaSegment = title.mediaType === "tv" ? "tv" : "movie";
  if (title.imdbId) return `/title/${mediaSegment}/${title.imdbId}`;
  return `/title/${mediaSegment}/${title.tmdbId}`;
}

function TitleCard({ title }: { title: NetworkTitle }) {
  const href = buildTitleHref(title);

  return (
    <Link href={href} className="group flex flex-col gap-2">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-white/[0.05] ring-1 ring-white/[0.07] transition-all duration-200 group-hover:ring-white/20 group-hover:scale-[1.02]">
        {title.posterUrl ? (
          <Image
            src={title.posterUrl}
            alt={title.title ?? ""}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 768px) 30vw, 180px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/20">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 5h16v14H4V5zm2 2v10h12V7H6zm3 2h6v2H9V9zm0 4h6v2H9v-2z" />
            </svg>
          </div>
        )}
        {title.rating != null && title.rating > 0 && (
          <div className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-400 backdrop-blur-sm">
            {title.rating.toFixed(1)}
          </div>
        )}
      </div>
      <div className="px-0.5">
        <p className="line-clamp-2 text-[11.5px] font-semibold leading-snug text-white/80 transition-colors group-hover:text-white">
          {title.title}
        </p>
        {title.year && (
          <p className="mt-0.5 text-[10px] text-white/35">{title.year}</p>
        )}
      </div>
    </Link>
  );
}

export default function NetworkPageClient({
  slug,
  displayName,
  initialTitles,
  initialTotal,
}: NetworkPageClientProps) {
  const [titles, setTitles] = useState<NetworkTitle[]>(initialTitles);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(initialTitles.length >= initialTotal);

  const loadMore = useCallback(async () => {
    if (loading || exhausted) return;
    setLoading(true);
    try {
      const nextPage = page + 1;
      const res = await fetch(`/api/network/${slug}?page=${nextPage}`);
      if (!res.ok) return;
      const data = await res.json() as { titles: NetworkTitle[]; pagination: { totalPages: number } };
      setTitles((prev) => [...prev, ...data.titles]);
      setPage(nextPage);
      if (nextPage >= data.pagination.totalPages) setExhausted(true);
    } finally {
      setLoading(false);
    }
  }, [loading, exhausted, page, slug]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/35 transition-colors hover:text-white/60"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Início
          </Link>

          <div className="flex items-end gap-4">
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
                Emissora
              </p>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                {displayName}
              </h1>
              {initialTotal > 0 && (
                <p className="mt-1.5 text-sm text-white/40">
                  {initialTotal} {initialTotal === 1 ? "título" : "títulos"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Grid */}
        {titles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] py-20 text-center">
            <p className="text-sm text-white/40">
              Nenhum título encontrado para <span className="text-white/60">{displayName}</span>.
            </p>
            <p className="text-xs text-white/25">
              Os dados de rede são sincronizados progressivamente ao visitar páginas de título.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {titles.map((title) => (
                <TitleCard key={title.id} title={title} />
              ))}
            </div>

            {!exhausted && (
              <div className="mt-10 flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="rounded-full border border-white/[0.12] bg-white/[0.04] px-6 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white/55 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white/80 disabled:opacity-50"
                >
                  {loading ? "Carregando…" : "Ver mais"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
