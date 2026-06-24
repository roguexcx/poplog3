"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import TmdbImage from "@/components/images/TmdbImage";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import { CardActionButton } from "@/components/ui/CardActionButton";
import { IconBookmark, IconCheck, IconStar, IconX } from "@/components/ui/icons";
import LibraryStateBadge from "@/components/ui/LibraryStateBadge";
import { useOptionalUserData } from "@/context/UserDataContext";
import { useUserAction } from "@/hooks/useUserAction";
import { useUserFeedbackToggle } from "@/hooks/useUserFeedbackToggle";
import { usePoplogUserState } from "@/stores/user-states-store";
import { titleIdentityKeys, userTitleIdentityKeys } from "@/lib/user-title-identity";

// ─── Types ────────────────────────────────────────────────────────────────────

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

const PAGE_SIZE = 20;
const SESSION_HISTORY_CAP = 160;

// ─── Actions ──────────────────────────────────────────────────────────────────

function ForYouActions({ item, onDismiss }: { item: ForYouItem; onDismiss?: () => void }) {
  const userData = useOptionalUserData();
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
    // Qualquer entrada na biblioteca torna o título inelegível imediatamente.
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
    <div className="absolute right-2 top-2 z-40 flex gap-1">
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
          onDismiss?.();
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

// ─── Card ─────────────────────────────────────────────────────────────────────

function ForYouCard({ item, onDismiss }: { item: ForYouItem; onDismiss?: () => void }) {
  const imagePath = item.posterUrl ?? item.backdropUrl ?? null;
  const imageKind: "poster" | "backdrop" = item.posterUrl ? "poster" : "backdrop";
  const rating = formatRating(item.rating);

  return (
    <article className="group relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.04] shadow-[0_16px_55px_rgba(0,0,0,0.38)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/40 hover:shadow-[0_20px_75px_rgba(56,189,248,0.14)]" style={{ aspectRatio: "2/3" }}>
      <Link
        href={`/title/${item.mediaType}/${item.linkId ?? item.id}`}
        className="absolute inset-0 z-10"
        aria-label={`Abrir ${item.title}`}
      />

      <ForYouActions item={item} onDismiss={onDismiss} />
      <LibraryStateBadge
        tmdbId={item.id > 0 ? item.id : undefined}
        mediaType={item.mediaType}
        className="bottom-[4.5rem] left-2.5 top-auto group-hover:opacity-0 transition-opacity duration-200"
      />

      {imagePath ? (
        <TmdbImage
          path={imagePath}
          kind={imageKind}
          size="card"
          alt={item.title}
          fill
          sizes="(max-width: 640px) 44vw, (max-width: 1024px) 28vw, 18vw"
          className="object-cover transition duration-700 group-hover:scale-110"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-sky-950/60 via-zinc-900 to-zinc-950">
          <div className="flex h-full items-center justify-center text-4xl font-black text-white/10 select-none">
            {item.title.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#020617] via-black/72 via-48% to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/18 via-transparent to-black/15" />
      <div className="pointer-events-none absolute inset-0 opacity-0 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.28)] transition duration-300 group-hover:opacity-100" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3.5">
        {rating && (
          <div className="mb-2 inline-flex items-center gap-[3px] rounded-full border border-white/[0.14] bg-black/75 px-2 py-[3px] text-[10px] font-semibold text-amber-400 backdrop-blur-[10px]">
            <IconStar />
            {rating}
          </div>
        )}

        <LocalizedTitle
          as="h3"
          title={item.title}
          originalTitle={item.originalTitle}
          variant="poster"
          className={[
            "min-h-[2.35rem] line-clamp-2 leading-tight tracking-tight text-white",
            item.title.length > 22
              ? "text-[0.88rem] font-extrabold"
              : "text-[1rem] font-black",
          ].join(" ")}
        />

        <p className="mt-1.5 text-[10px] font-semibold text-zinc-300 line-clamp-1">
          {item.year ? `${item.year} · ` : ""}
          {item.mediaLabel ?? "Título"}
          {item.genreLabel ? ` · ${item.genreLabel}` : ""}
        </p>

        <p className="mt-2 min-h-[1.5rem] line-clamp-2 text-[9px] font-bold leading-snug text-sky-300">
          {item.reason ?? "Combina com você"}
        </p>
      </div>
    </article>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function GridSkeleton({ count = 20 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-[1.35rem] bg-white/5" style={{ aspectRatio: "2/3" }} />
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 text-4xl opacity-30">✦</div>
      <p className="text-base font-semibold text-white/60">Nenhuma recomendação disponível</p>
      <p className="mt-2 max-w-sm text-sm text-white/35">
        Adicione títulos à sua biblioteca para que possamos personalizar sugestões para você.
      </p>
      <Link
        href="/buscar"
        className="mt-6 rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-semibold text-white/70 transition hover:border-sky-400/40 hover:text-sky-300"
      >
        Explorar títulos
      </Link>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function NotLoggedInState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 text-4xl opacity-30">✦</div>
      <p className="text-base font-semibold text-white/60">Entre para ver suas recomendações</p>
      <p className="mt-2 max-w-sm text-sm text-white/35">
        Crie uma conta ou faça login para receber sugestões personalizadas com base na sua biblioteca.
      </p>
      <Link
        href="/login"
        className="mt-6 rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-semibold text-white/70 transition hover:border-sky-400/40 hover:text-sky-300"
      >
        Entrar
      </Link>
    </div>
  );
}

export default function ForYouAllPage() {
  const userData = useOptionalUserData();
  const titles = useMemo(() => userData?.titles ?? [], [userData?.titles]);
  const titlesLoading = userData?.loading ?? false;
  const [items, setItems] = useState<ForYouItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());

  const libraryIdentities = useMemo(
    () => new Set(titles.flatMap(userTitleIdentityKeys)),
    [titles],
  );

  function dismissItem(id: number, mediaType: "movie" | "tv") {
    setDismissedKeys((prev) => new Set([...prev, `${id}:${mediaType}`]));
  }

  function isHidden(item: ForYouItem): boolean {
    const tmdbKey = `${item.id}:${item.mediaType}`;
    const aliases = titleIdentityKeys({
      mediaType: item.mediaType,
      tmdbId: item.id,
      poplogId: item.poplogId,
      imdbId: item.imdbId ?? (item.linkId?.startsWith("tt") ? item.linkId : null),
      traktId: item.traktId,
      slug: item.slug,
    });
    return aliases.some((key) => libraryIdentities.has(key))
      || dismissedKeys.has(tmdbKey);
  }

  const shownHistoryRef = useRef<string[]>([]);

  const fetchPage = useCallback(
    async (titlesSnapshot: typeof titles, isLoadMore: boolean) => {
      if (!titlesSnapshot.length) {
        setLoading(false);
        setInitialized(true);
        return;
      }

      if (isLoadMore) setLoadingMore(true);
      else setLoading(true);

      try {
        const res = await fetch("/api/user/for-you", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titles: titlesSnapshot,
            exclude: shownHistoryRef.current.slice(-SESSION_HISTORY_CAP),
            limit: PAGE_SIZE,
            surface: "page",
            mode: "full",
            includeProviders: false,
          }),
        });

        if (!res.ok) throw new Error("fetch failed");
        const json = await res.json();

        const allItems: ForYouItem[] = [
          ...(json.featured ? [json.featured] : []),
          ...(json.items ?? []),
        ];

        // Accumulate history to exclude on next load
        for (const it of allItems) {
          shownHistoryRef.current.push(`${it.mediaType}:${it.id}`);
        }
        shownHistoryRef.current = shownHistoryRef.current.slice(-SESSION_HISTORY_CAP);

        setItems((prev) => {
          const next = isLoadMore ? [...prev, ...allItems] : allItems;
          const seen = new Set<string>();
          return next.filter((item) => {
            const aliases = titleIdentityKeys({
              mediaType: item.mediaType,
              tmdbId: item.id,
              poplogId: item.poplogId,
              imdbId: item.imdbId,
              traktId: item.traktId,
              slug: item.slug,
            });
            if (aliases.some((key) => seen.has(key))) return false;
            for (const key of aliases) seen.add(key);
            return true;
          });
        });
        setHasMore(allItems.length >= PAGE_SIZE);
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setInitialized(true);
      }
    },
    [],
  );

  useEffect(() => {
    if (titlesLoading || initialized) return;
    fetchPage(titles, false);
  }, [titlesLoading, initialized, titles, fetchPage]);

  function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    fetchPage(titles, true);
  }

  const visibleItems = items.filter((item) => !isHidden(item));
  const isEmpty = initialized && !loading && visibleItems.length === 0;
  const isNotLoggedIn = userData === null;

  return (
    <div className="pt-8 pb-16">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <Link
            href="/"
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white/40 transition hover:text-white/70"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Início
          </Link>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Para você</h1>
          <p className="mt-1.5 text-sm text-white/50">
            Escolhas personalizadas com base no que você ama.
          </p>
        </div>
      </div>

      {/* Grid */}
      {isNotLoggedIn ? (
        <NotLoggedInState />
      ) : loading ? (
        <GridSkeleton count={18} />
      ) : isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {visibleItems.map((item) => (
              <ForYouCard
                key={`${item.mediaType}-${item.id}`}
                item={item}
                onDismiss={() => dismissItem(item.id, item.mediaType)}
              />
            ))}
            {loadingMore &&
              Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={`skel-${i}`}
                  className="animate-pulse rounded-[1.35rem] bg-white/5"
                  style={{ aspectRatio: "2/3" }}
                />
              ))}
          </div>

          {hasMore && !loadingMore && (
            <div className="mt-10 flex justify-center">
              <button
                onClick={handleLoadMore}
                className={[
                  "flex items-center gap-2 rounded-full border px-6 py-2.5 backdrop-blur-[8px]",
                  "text-sm font-semibold transition-[transform,background,border-color] duration-200 hover:scale-105",
                  "border-white/[0.18] bg-black/[0.72] text-white/60",
                  "hover:border-sky-500/40 hover:text-white/85",
                ].join(" ")}
              >
                Carregar mais
              </button>
            </div>
          )}

          {!hasMore && items.length > 0 && (
            <p className="mt-10 text-center text-xs text-white/25">
              Você chegou ao fim das recomendações desta sessão.
            </p>
          )}
        </>
      )}
    </div>
  );
}
