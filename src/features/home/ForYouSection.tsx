"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SynopsisText from "@/features/home/components/SynopsisText";
import { ScrollRowArrows } from "@/components/ScrollRowArrows";
import { CardActionButton } from "@/components/ui/CardActionButton";
import { IconBookmark, IconCheck, IconStar, IconX } from "@/components/ui/icons";
import { useUserAction } from "@/hooks/useUserAction";
import { useUserFeedbackToggle } from "@/hooks/useUserFeedbackToggle";
import { usePoplogUserState } from "@/stores/user-states-store";
import { useScrollRow } from "@/hooks/useScrollRow";
import { useUserData } from "@/context/UserDataContext";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import TmdbImage from "@/components/images/TmdbImage";
import SectionHeader from "@/components/ui/SectionHeader";
import CardProviderBadge from "@/components/ui/CardProviderBadge";
import { titleIdentityKeys, userTitleIdentityKeys } from "@/lib/user-title-identity";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ForYouItem = {
  id: number;
  /** CUID da tabela poplog3_titles quando encontrado no DB local */
  poplogId?: string | null;
  /** ID canônico para o href do link — pode ser tmdbId numérico (string) ou imdbId ("tt...") */
  linkId?: string;
  imdbId?: string | null;
  traktId?: number | null;
  slug?: string | null;
  title: string;
  originalTitle?: string | null;
  overview?: string;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  rating?: number;
  year?: string | null;
  mediaType: "movie" | "tv";
  mediaLabel?: string;
  genreLabel?: string | null;
  reason?: string;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  userFeedback?: { notInterested?: boolean };
};

function formatRating(value?: number): string | null {
  return value ? value.toFixed(1) : null;
}

function parseReleaseYear(year?: string | null): number | null {
  if (!year) return null;
  const n = Number(year);
  return Number.isFinite(n) ? n : null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function ForYouActions({ item, onDismiss }: { item: ForYouItem; onDismiss?: () => void }) {
  const userData = useUserData();
  const isLoggedIn = Boolean(userData && !userData.loading);

  const { executeAction, effectiveKey } = useUserAction({
    poplogId: item.poplogId,
    tmdbId: item.id,
    mediaType: item.mediaType,
    title: item.title,
    releaseYear: parseReleaseYear(item.year),
  });

  const zustandState = usePoplogUserState(effectiveKey);
  const inWatchlist = zustandState?.isInWatchlist ?? false;
  const isWatched   = zustandState?.isWatched   ?? false;

  const [saving, setSaving] = useState(false);

  async function handleAction(action: "addToWatchlist" | "removeFromWatchlist" | "markAsWatched" | "markAsUnwatched") {
    setSaving(true);
    const result = await executeAction(action);
    setSaving(false);
    // Ambos os estados fazem parte da biblioteca e são inelegíveis para o bloco.
    // Remove imediatamente, sem aguardar a atualização assíncrona do contexto.
    if (
      (action === "markAsWatched" || action === "addToWatchlist") &&
      (!("ok" in result) || result.ok)
    ) {
      onDismiss?.();
    }
  }

  const feedback = useUserFeedbackToggle({
    tmdbId: item.id,
    mediaType: item.mediaType,
    source: "for_you",
    initialNotInterested: Boolean(item.userFeedback?.notInterested),
  });

  return (
    <div className="absolute right-2.5 top-2.5 z-40 flex gap-1.5">
      <CardActionButton
        onClick={() => handleAction(inWatchlist ? "removeFromWatchlist" : "addToWatchlist")}
        disabled={!isLoggedIn || saving}
        title={inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
        active={inWatchlist}
        saving={saving}
        activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
      >
        <IconBookmark filled={inWatchlist} />
      </CardActionButton>

      <CardActionButton
        onClick={() => handleAction(isWatched ? "markAsUnwatched" : "markAsWatched")}
        disabled={!isLoggedIn || saving}
        title={isWatched ? "Desmarcar como assistido" : "Já vi"}
        active={isWatched}
        saving={saving}
        activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
      >
        <IconCheck />
      </CardActionButton>

      <CardActionButton
        onClick={() => {
          if (!feedback.notInterested) onDismiss?.();
          feedback.toggleNotInterested();
        }}
        disabled={!isLoggedIn || feedback.saving}
        title={feedback.notInterested ? "Remover sem interesse" : "Não tenho interesse"}
        active={feedback.notInterested}
        saving={feedback.saving}
        activeClass="border-rose-400/55 bg-rose-400/[0.18] text-rose-300 shadow-[0_0_10px_rgba(251,113,133,0.22)]"
      >
        <IconX />
      </CardActionButton>
    </div>
  );
}

// ─── FeaturedCard ─────────────────────────────────────────────────────────────

function FeaturedForYouCard({ item, onDismiss }: { item: ForYouItem; onDismiss?: () => void }) {
  const rating = formatRating(item.rating);
  const isLongTitle = item.title.length > 24;
  const isLongOverview = (item.overview?.length ?? 0) > 140;
  const slug = `/title/${item.mediaType}/${item.linkId ?? item.id}`;

  return (
    <article className="group relative h-[320px] overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[0.04] shadow-[0_20px_80px_rgba(0,0,0,0.42)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/40 hover:shadow-[0_24px_90px_rgba(56,189,248,0.16)]">
      <Link href={slug} className="absolute inset-0 z-[5]" aria-label={`Abrir ${item.title}`} />

      <ForYouActions item={item} onDismiss={onDismiss} />

      {item.backdropUrl && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-y-0 -left-[0%] right-50 w-[120%] aspect-video lg:aspect-auto">
            <TmdbImage
              path={item.backdropUrl}
              kind="backdrop"
              size="medium"
              alt={item.title}
              fill
              sizes="(max-width: 1024px) 100vw, 65vw"
              className="object-cover object-right"
            />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#020617] via-[#020617]/80 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,transparent_20%,rgba(2,6,23,0.4)_100%)]" />

      <div
        className={[
          "absolute inset-y-0 left-0 z-20 flex flex-col justify-center p-7",
          isLongTitle || isLongOverview ? "w-[66%]" : "w-[58%]",
        ].join(" ")}
      >
        <div className="mb-3 flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.24em] text-sky-300">
          <span>
            {item.year ? `${item.year} · ` : ""}
            {item.mediaLabel ?? "Título"}
          </span>
          {rating && (
            <span className="flex items-center gap-1 tracking-normal text-amber-400">
              <IconStar />
              {rating}
            </span>
          )}
          {item.best_provider_name && (
            <CardProviderBadge
              name={item.best_provider_name}
              logoPath={item.best_provider_logo}
              type={item.best_provider_type}
            />
          )}
        </div>

        <LocalizedTitle
          as="h3"
          title={item.title}
          originalTitle={item.originalTitle}
          variant="large"
          className="max-w-[360px] drop-shadow-[0_4px_18px_rgba(0,0,0,0.75)] transition group-hover:text-sky-100"
        />

        {item.genreLabel && (
          <p className="mt-2 text-[12px] font-semibold text-zinc-300">{item.genreLabel}</p>
        )}

        <SynopsisText text={item.overview ?? null} collapsedLines={3} className="mt-3 max-w-[420px]" />

        <p className="mt-3 line-clamp-1 text-[10px] font-bold text-sky-300">
          {item.reason ?? "Combina com você"}
        </p>
      </div>
    </article>
  );
}

// ─── SmallCard ────────────────────────────────────────────────────────────────

function SmallForYouCard({ item, onDismiss }: { item: ForYouItem; onDismiss?: () => void }) {
  // posterUrl and backdropUrl can be either TMDB relative paths ("/xxx.jpg")
  // or full CDN URLs ("https://...") — TmdbImage handles both via normalizeAbsoluteImageUrl
  const imagePath = item.posterUrl ?? item.backdropUrl ?? null;
  const imageKind: "poster" | "backdrop" = item.posterUrl ? "poster" : "backdrop";
  const rating = formatRating(item.rating);

  return (
    <article className="group relative h-[320px] overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.04] shadow-[0_16px_55px_rgba(0,0,0,0.38)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/40 hover:shadow-[0_20px_75px_rgba(56,189,248,0.14)]">
      <Link
        href={`/title/${item.mediaType}/${item.linkId ?? item.id}`}
        className="absolute inset-0 z-10"
        aria-label={`Abrir ${item.title}`}
      />

      <ForYouActions item={item} onDismiss={onDismiss} />

      {imagePath ? (
        <TmdbImage
          path={imagePath}
          kind={imageKind}
          size="card"
          alt={item.title}
          fill
          sizes="220px"
          className="object-cover transition duration-700 group-hover:scale-110"
        />
      ) : (
        // Fallback visual quando nenhuma imagem está disponível
        <div className="absolute inset-0 bg-gradient-to-br from-sky-950/60 via-zinc-900 to-zinc-950">
          <div className="flex h-full items-center justify-center text-4xl font-black text-white/10 select-none">
            {item.title.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#020617] via-black/72 via-48% to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/18 via-transparent to-black/15" />
      <div className="pointer-events-none absolute inset-0 opacity-0 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.28)] transition duration-300 group-hover:opacity-100" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4">
        <div className="mb-2 flex items-center gap-1.5">
          {rating && (
            <div className="inline-flex items-center gap-[3px] rounded-full border border-white/[0.14] bg-black/75 px-2 py-[3px] text-[10px] font-semibold text-amber-400 backdrop-blur-[10px]">
              <IconStar />
              {rating}
            </div>
          )}
          {item.best_provider_name && (
            <CardProviderBadge
              name={item.best_provider_name}
              logoPath={item.best_provider_logo}
              type={item.best_provider_type}
            />
          )}
        </div>

        <LocalizedTitle
          as="h3"
          title={item.title}
          originalTitle={item.originalTitle}
          variant="poster"
          className={[
            "min-h-[2.35rem] line-clamp-2 leading-tight tracking-tight text-white",
            item.title.length > 22
              ? "text-[0.9rem] font-extrabold"
              : "text-[1.05rem] font-black",
          ].join(" ")}
        />

        <p className="mt-2 line-clamp-1 text-xs font-semibold text-zinc-300">
          {item.year ? `${item.year} · ` : ""}
          {item.mediaLabel ?? "Título"}
        </p>

        <p className="mt-2 min-h-[1.65rem] line-clamp-2 text-[9px] font-bold leading-snug text-sky-300">
          {item.reason ?? "Combina com você"}
        </p>
      </div>
    </article>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ForYouSkeleton() {
  return (
    <>
      <div className="no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6 pb-2 lg:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[260px] w-[180px] shrink-0 animate-pulse rounded-[1.35rem] bg-white/5" />
        ))}
      </div>
      <div className="hidden gap-5 lg:grid lg:grid-cols-[2.05fr_repeat(5,0.72fr)]">
        <div className="h-[320px] animate-pulse rounded-[1.65rem] bg-white/5" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-[320px] animate-pulse rounded-[1.35rem] bg-white/5" />
        ))}
      </div>
    </>
  );
}

// ─── Seção principal ──────────────────────────────────────────────────────────

// Quantos slots mostrar no grid (1 featured + 5 small) e quantos buscar (buffer 2×)
const DISPLAY_COUNT = 6;
const FETCH_LIMIT   = 12;

export default function ForYouSection() {
  const { titles, loading: titlesLoading } = useUserData();
  const [featured, setFeatured] = useState<ForYouItem | null>(null);
  const [items, setItems] = useState<ForYouItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());

  // Conjuntos de exclusão: itens em qualquer estado da biblioteca são ocultados.
  const libraryIdentities = useMemo(() => {
    return new Set(titles.flatMap(userTitleIdentityKeys));
  }, [titles]);

  function dismissItem(id: number, mediaType: "movie" | "tv") {
    setDismissedKeys((prev) => new Set([...prev, `${id}:${mediaType}`]));
  }

  // Pool visível: combina featured + items, filtra ocultos, limita a DISPLAY_COUNT.
  // Quando um item é marcado/dispensado, o próximo do buffer preenche automaticamente.
  const visiblePool = useMemo(() => {
    const all: ForYouItem[] = featured ? [featured, ...items] : [...items];
    const seen = new Set<string>();
    return all.filter((item) => {
      const tmdbKey = `${item.id}:${item.mediaType}`;
      const aliases = titleIdentityKeys({
        mediaType: item.mediaType,
        tmdbId: item.id,
        poplogId: item.poplogId,
        imdbId: item.imdbId,
        traktId: item.traktId,
        slug: item.slug,
      });
      if (aliases.some((key) => libraryIdentities.has(key) || seen.has(key))) return false;
      for (const key of aliases) seen.add(key);
      return !dismissedKeys.has(tmdbKey);
    }).slice(0, DISPLAY_COUNT);
  }, [featured, items, libraryIdentities, dismissedKeys]);

  const visibleFeatured = visiblePool[0] ?? null;
  const visibleItems    = visiblePool.slice(1);

  const {
    ref: rowRef,
    canScrollLeft,
    canScrollRight,
    scrollLeft: doScrollLeft,
    scrollRight: doScrollRight,
  } = useScrollRow({ step: 392 });

  const didInitRef = useRef(false);
  const [refreshCount, setRefreshCount] = useState(0);

  // Session history: tracks shown item keys ("mediaType:id") across Sorteio rounds
  const shownHistoryRef = useRef<string[]>([]);
  const SHOWN_HISTORY_CAP = 40;

  const fetchForYou = useCallback((titlesSnapshot: typeof titles, exclude: string[]) => {
    if (titlesSnapshot.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/user/for-you", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles: titlesSnapshot, exclude, limit: FETCH_LIMIT }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json) {
          setFeatured(json.featured ?? null);
          setItems(json.items ?? []);

          // Accumulate shown items in session history for next Sorteio round
          const newKeys: string[] = [];
          if (json.featured) newKeys.push(`${json.featured.mediaType}:${json.featured.id}`);
          for (const it of json.items ?? []) newKeys.push(`${it.mediaType}:${it.id}`);

          shownHistoryRef.current = [
            ...shownHistoryRef.current,
            ...newKeys,
          ].slice(-SHOWN_HISTORY_CAP);
        }
      })
      .catch(() => {
        setFeatured(null);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (titlesLoading) return;
    if (didInitRef.current && refreshCount === 0) return;
    didInitRef.current = true;
    // First load: no exclusions; subsequent Sorteio rounds: pass history
    const exclude = refreshCount > 0 ? shownHistoryRef.current : [];
    fetchForYou(titles, exclude);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titlesLoading, refreshCount]);

  function handleRefresh() {
    if (loading) return;
    setRefreshCount((c) => c + 1);
  }

  if (!loading && visiblePool.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title="Para você"
        subtitle="Escolhas personalizadas com base no que você ama."
        className="mb-6"
        action={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className={[
                "flex items-center gap-2 rounded-full border px-4 py-1.5 backdrop-blur-[8px]",
                "text-[10px] font-semibold uppercase tracking-[0.08em]",
                "transition-[transform,background,border-color] duration-200 hover:scale-105",
                "border-white/[0.18] bg-black/[0.72] text-white/60",
                "hover:border-sky-500/40 hover:text-white/85",
                "disabled:pointer-events-none disabled:opacity-30",
              ].join(" ")}
              aria-label="Atualizar recomendações"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              Novos títulos
            </button>
            <Link
              href="/para-voce"
              className="hidden text-xs font-bold text-sky-300 transition hover:text-white md:block"
            >
              Ver todos →
            </Link>
            <div className="flex lg:hidden">
              <ScrollRowArrows
                canScrollLeft={canScrollLeft}
                canScrollRight={canScrollRight}
                onLeft={doScrollLeft}
                onRight={doScrollRight}
              />
            </div>
          </div>
        }
      />

      {loading ? (
        <ForYouSkeleton />
      ) : (
        <>
          <div ref={rowRef} className="no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6 pb-2 lg:hidden">
            {visibleFeatured && (
              <div className="w-[180px] shrink-0">
                <SmallForYouCard item={visibleFeatured} onDismiss={() => dismissItem(visibleFeatured.id, visibleFeatured.mediaType)} />
              </div>
            )}
            {visibleItems.map((item) => (
              <div key={`${item.mediaType}-${item.id}`} className="w-[180px] shrink-0">
                <SmallForYouCard item={item} onDismiss={() => dismissItem(item.id, item.mediaType)} />
              </div>
            ))}
          </div>

          <div
            className="hidden gap-5 lg:grid"
            style={visibleItems.length > 0
              ? { gridTemplateColumns: `2.05fr repeat(${visibleItems.length}, 0.72fr)` }
              : { gridTemplateColumns: "1fr" }
            }
          >
            {visibleFeatured && (
              <FeaturedForYouCard
                item={visibleFeatured}
                onDismiss={() => dismissItem(visibleFeatured.id, visibleFeatured.mediaType)}
              />
            )}
            {visibleItems.map((item) => (
              <SmallForYouCard
                key={`${item.mediaType}-${item.id}`}
                item={item}
                onDismiss={() => dismissItem(item.id, item.mediaType)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
