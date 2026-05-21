"use client";

import ContextualAttribution from "@/components/attribution/ContextualAttribution";
import SourceChip from "@/components/attribution/SourceChip";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type MovieSocialModalProps = {
  movieTmdbId: number;
  movieTitle: string;
  overview: string | null;
  backdropUrl: string | null;
  year?: string | number | null;
  runtime?: string | null;
  voteAverage?: number | null;
  watched: boolean;
  saving?: boolean;
  mediaType?: "movie" | "tv";
  onClose: () => void;
  onToggleWatched: (next: boolean) => void;
};

type UnifiedSocialComment = {
  id: string;
  source: "tmdb" | "trakt";
  author: string;
  content: string;
  originalContent?: string;
  translationStatus?: "translated" | "original";
  sourceLanguage?: string | null;
  spoiler?: boolean;
  likes?: number;
};

type SocialCommentsResponse = {
  ok?: boolean;
  counts?: {
    all?: number;
    tmdb?: number;
    trakt?: number;
  };
  comments?: {
    all?: UnifiedSocialComment[];
    tmdb?: UnifiedSocialComment[];
    trakt?: UnifiedSocialComment[];
  };
  error?: string;
  message?: string;
};

type CommentsCount = {
  all: number;
  tmdb: number;
  trakt: number;
};

type SocialTab = "all" | "tmdb" | "trakt" | "reddit";

type RedditCommentDto = {
  id: string;
  parentId: string | null;
  author: string;
  body: string;
  bodyOriginal?: string;
  bodyTranslated?: string;
  translated?: boolean;
  score: number;
  createdUtc: number;
  permalink: string;
  depth: number;
  replyCount: number;
};

type RedditThreadDto = {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  comments: number;
  createdUtc: number;
  url: string;
  permalink: string;
  selftext: string;
  relevance: number;
  category: string;
  isOfficialDiscussion: boolean;
  topComments: RedditCommentDto[];
  totalUsefulComments: number;
};

type RedditResponse = {
  threads?: RedditThreadDto[];
  error?: string;
  message?: string;
};

function getOriginalTmdbImageUrl(url: string | null) {
  if (!url) return null;
  return url.replace(/\/t\/p\/[^/]+\//, "/t/p/original/");
}

function getRedditCategoryLabel(category: string) {
  switch (category) {
    case "movie_official_discussion":
      return "Discussão oficial";
    case "review":
      return "Review";
    case "reaction":
      return "Reação";
    case "explained":
      return "Explicação";
    case "theory":
      return "Teoria";
    case "movie_general":
      return "Geral";
    default:
      return category;
  }
}

function getRedditHeatLabel(thread: RedditThreadDto) {
  const heat =
    (thread.comments || 0) +
    (thread.totalUsefulComments || 0) +
    (thread.topComments?.length || 0) * 4;

  if (heat >= 300) return "Comunidade em alta";
  if (heat >= 180) return "Discussão intensa";
  if (heat >= 90) return "Muito comentado";
  return "Conversando sobre";
}

export default function MovieSocialModal({
  movieTmdbId,
  movieTitle,
  backdropUrl,
  year,
  runtime,
  voteAverage,
  watched,
  saving = false,
  mediaType = "movie",
  onClose,
  onToggleWatched,
}: MovieSocialModalProps) {
  const modalBackdropUrl = useMemo(
    () => getOriginalTmdbImageUrl(backdropUrl),
    [backdropUrl],
  );

  const [allComments, setAllComments] = useState<UnifiedSocialComment[]>([]);
  const [tmdbComments, setTmdbComments] = useState<UnifiedSocialComment[]>([]);
  const [traktComments, setTraktComments] = useState<UnifiedSocialComment[]>([]);
  const [commentsCount, setCommentsCount] = useState<CommentsCount>({
    all: 0,
    tmdb: 0,
    trakt: 0,
  });

  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsRefreshToken, setCommentsRefreshToken] = useState(0);

  const [redditThreads, setRedditThreads] = useState<RedditThreadDto[]>([]);
  const [redditLoading, setRedditLoading] = useState(false);
  const [redditError, setRedditError] = useState<string | null>(null);
  const [redditRequested, setRedditRequested] = useState(false);

  const [socialTab, setSocialTab] = useState<SocialTab>("all");

  const [originalCommentIds, setOriginalCommentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(
    () => new Set(),
  );

  const mixedAllComments = useMemo(() => {
  const mixed = [...tmdbComments, ...traktComments];

  return mixed.sort(() => Math.random() - 0.5);
}, [tmdbComments, traktComments]);

const activeComments =
  socialTab === "tmdb"
    ? tmdbComments
    : socialTab === "trakt"
      ? traktComments
      : mixedAllComments;

  useEffect(() => {
    let cancelled = false;

    setCommentsLoading(true);
    setCommentsError(null);

    const params = new URLSearchParams({
      tmdbId: String(movieTmdbId),
    });

    fetch(`/api/social/movie-comments?${params.toString()}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | SocialCommentsResponse
          | null;

        if (cancelled) return null;
        if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
        if (body?.error) throw new Error(body.message || body.error);

        return body;
      })
      .then((body) => {
        if (cancelled || !body) return;

        const nextAll = Array.isArray(body.comments?.all)
          ? body.comments.all
          : [];
        const nextTmdb = Array.isArray(body.comments?.tmdb)
          ? body.comments.tmdb
          : [];
        const nextTrakt = Array.isArray(body.comments?.trakt)
          ? body.comments.trakt
          : [];

        setAllComments(nextAll);
        setTmdbComments(nextTmdb);
        setTraktComments(nextTrakt);
        setCommentsCount({
          all: body.counts?.all ?? nextAll.length,
          tmdb: body.counts?.tmdb ?? nextTmdb.length,
          trakt: body.counts?.trakt ?? nextTrakt.length,
        });
      })
      .catch((err) => {
        if (cancelled) return;

        setCommentsError(
          err instanceof Error ? err.message : "Erro ao carregar comentários",
        );
        setAllComments([]);
        setTmdbComments([]);
        setTraktComments([]);
        setCommentsCount({ all: 0, tmdb: 0, trakt: 0 });
      })
      .finally(() => {
        if (cancelled) return;
        setCommentsLoading(false);
        if (commentsRefreshToken > 0) setCommentsRefreshToken(0);
      });

    return () => {
      cancelled = true;
    };
  }, [movieTmdbId, commentsRefreshToken]);

  function loadReddit() {
    if (redditRequested || redditLoading) return;

    setRedditRequested(true);
    setRedditThreads([]);
    setRedditError(null);
    setRedditLoading(true);

    const params = new URLSearchParams({
      tmdbId: String(movieTmdbId),
      mediaType,
    });

    fetch(`/api/social/reddit/contextual?${params.toString()}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as RedditResponse | null;

        if (!res.ok) {
          throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
        }

        if (body?.error) {
          throw new Error(body.message || body.error);
        }

        return body;
      })
      .then((body) => {
        setRedditThreads(Array.isArray(body?.threads) ? body.threads : []);
      })
      .catch((err) => {
        setRedditError(
          err instanceof Error ? err.message : "Erro ao carregar Reddit",
        );
        setRedditThreads([]);
      })
      .finally(() => {
        setRedditLoading(false);
      });
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const socialTabs: Array<{
    id: SocialTab;
    label: string;
    count?: number;
    loading?: boolean;
  }> = [
    { id: "all", label: "Todos", count: commentsCount.all, loading: commentsLoading },
    { id: "tmdb", label: "TMDB", count: commentsCount.tmdb, loading: commentsLoading },
    { id: "trakt", label: "Trakt", count: commentsCount.trakt, loading: commentsLoading },
    { id: "reddit", label: "Reddit", count: redditThreads.length, loading: redditLoading },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-5 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Contexto social de ${movieTitle}`}
      onMouseDown={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.7rem] border border-white/[0.10] bg-zinc-950 shadow-[0_20px_80px_rgba(0,0,0,0.55)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-white/[0.12] bg-black/55 text-lg leading-none text-white/80 backdrop-blur-sm transition hover:border-white/[0.25] hover:bg-white/[0.10] hover:text-white"
          aria-label="Fechar modal"
        >
          ×
        </button>

        <div className="max-h-[92vh] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-white/[0.03] scrollbar-thumb-white/[0.16]">
          <div className="relative min-h-[330px] overflow-hidden sm:min-h-[430px]">
            {modalBackdropUrl ? (
              <Image
                src={modalBackdropUrl}
                alt={movieTitle}
                fill
                unoptimized
                sizes="(max-width: 768px) 100vw, 1180px"
                className="object-cover brightness-[0.78] saturate-[1.04]"
                priority
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(99,102,241,0.20),transparent_42%),linear-gradient(135deg,#111827,#020617_65%,#000)]" />
            )}

            <div
              className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/42 to-black/18"
              aria-hidden
            />

            <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-3 p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggleWatched(!watched)}
                  disabled={saving}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] backdrop-blur-sm transition duration-200",
                    watched
                      ? "border-emerald-300/40 bg-emerald-500/22 text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-500/35"
                      : "border-white/[0.14] bg-black/45 text-white/60 hover:border-indigo-300/40 hover:bg-indigo-500/20 hover:text-indigo-100",
                    saving ? "cursor-wait opacity-70" : "",
                  ].join(" ")}
                >
                  {saving ? (
                    <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                  ) : watched ? (
                    <>✓ Assistido</>
                  ) : (
                    "Marcar como visto"
                  )}
                </button>

                <span className="rounded-md border border-white/[0.10] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                  {mediaType === "tv" ? "Série" : "Filme"}
                </span>
              </div>

              <div className="max-w-3xl">
                <h2 className="text-2xl font-black tracking-[-0.045em] text-white sm:text-4xl">
                  {movieTitle}
                </h2>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">
                  {year && <span>{year}</span>}
                  {year && runtime && (
                    <span aria-hidden className="text-white/25">
                      ·
                    </span>
                  )}
                  {runtime && <span>{runtime}</span>}
                  {typeof voteAverage === "number" && voteAverage > 0 && (
                    <>
                      {(year || runtime) && (
                        <span aria-hidden className="text-white/25">
                          ·
                        </span>
                      )}
                      <span className="text-amber-100">
                        ★ {voteAverage.toFixed(1)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 p-5 sm:p-7">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/10">
                    {commentsLoading || redditLoading ? (
                      <span className="h-2 w-2 animate-pulse rounded-full bg-fuchsia-400/70" />
                    ) : commentsCount.all > 0 || redditThreads.length > 0 ? (
                      <>
                        <span className="absolute inset-0 animate-ping rounded-full bg-fuchsia-500/20" />
                        <span className="h-2 w-2 rounded-full bg-fuchsia-400" />
                      </>
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-white/20" />
                    )}
                  </div>

                  <div>
                    <p className="text-[9.5px] font-black uppercase tracking-[0.24em] text-fuchsia-300/55">
                      Comunidade reagindo
                    </p>
                    <h3 className="mt-0.5 text-[15px] font-bold tracking-[-0.025em] text-white/90">
                      {commentsLoading
                        ? "Carregando comentários do público…"
                        : `${commentsCount.all} ${
                            commentsCount.all === 1 ? "comentário" : "comentários"
                          } entre TMDB e Trakt${
                            redditRequested
                              ? ` · ${redditThreads.length} ${
                                  redditThreads.length === 1
                                    ? "thread no Reddit"
                                    : "threads no Reddit"
                                }`
                              : ""
                          }`}
                    </h3>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCommentsRefreshToken((prev) => prev + 1)}
                  disabled={commentsLoading}
                  className="shrink-0 rounded-full border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-[9.5px] font-black uppercase tracking-[0.18em] text-white/45 transition hover:border-white/[0.18] hover:bg-white/[0.07] hover:text-white/70 disabled:opacity-35"
                >
                  ↺ Atualizar
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {socialTabs.map((tab) => {
                  const active = socialTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setSocialTab(tab.id);
                        if (tab.id === "reddit") loadReddit();
                      }}
                      className={[
                        "rounded-full border px-3.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition",
                        active
                          ? "border-fuchsia-300/35 bg-fuchsia-500/18 text-fuchsia-50"
                          : "border-white/[0.08] bg-white/[0.03] text-white/45 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white/72",
                      ].join(" ")}
                    >
                      {tab.label}
                      {tab.loading ? (
                        <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-50" />
                      ) : tab.id === "reddit" && !redditRequested ? (
                        <span className="ml-1.5 text-white/30">buscar</span>
                      ) : typeof tab.count === "number" && tab.count > 0 ? (
                        <span className="ml-1.5 text-white/45">{tab.count}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {socialTab !== "reddit" && (
                <>
                  {commentsLoading && (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4"
                        >
                          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/[0.07]" />
                          <div className="flex-1 space-y-2.5 pt-1">
                            <div className="h-2.5 w-28 animate-pulse rounded-full bg-white/[0.08]" />
                            <div className="h-2.5 w-full animate-pulse rounded-full bg-white/[0.055]" />
                            <div className="h-2.5 w-8/12 animate-pulse rounded-full bg-white/[0.04]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!commentsLoading && commentsError && (
                    <div className="flex items-start gap-3 rounded-2xl border border-rose-300/14 bg-rose-500/[0.07] p-4">
                      <span className="mt-0.5 text-base leading-none text-rose-400/60">
                        ⚠
                      </span>
                      <p className="text-[12.5px] leading-6 text-rose-100/68">
                        Não conseguimos carregar os comentários: {commentsError}
                      </p>
                    </div>
                  )}

                  {!commentsLoading && !commentsError && activeComments.length === 0 && (
                    <p className="text-[12.5px] leading-6 text-white/38">
                      Nenhum comentário encontrado nesta aba.
                    </p>
                  )}

                  {!commentsLoading && activeComments.length > 0 && (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {activeComments.map((comment) => {
                        const id = `${comment.source}-${comment.id}`;
                        const isSpoiler = Boolean(comment.spoiler);
                        const spoilerRevealed = revealedSpoilers.has(id);
                        const showingOriginal = originalCommentIds.has(id);

                        const originalText = comment.originalContent?.trim();
                        const translatedText = comment.content?.trim();
                        const text =
                          showingOriginal && originalText
                            ? originalText
                            : translatedText || originalText || "";

                        const username = comment.author?.trim() || "user";
                        const initial = username[0]?.toUpperCase() || "?";
                        const hue =
                          username
                            .split("")
                            .reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

                        const hasTranslationToggle =
                          Boolean(originalText) &&
                          Boolean(translatedText) &&
                          originalText !== translatedText;

                        return (
                          <div
                            key={id}
                            className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
                          >
                            <div
                              className="absolute bottom-3 left-0 top-3 w-[2px] rounded-full"
                              style={{
                                background: `hsl(${hue}, 55%, 62%)`,
                                opacity: 0.35,
                              }}
                              aria-hidden
                            />

                            <div className="flex gap-3 pl-2.5">
                              <div
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white/85"
                                style={{
                                  background: `hsl(${hue}, 38%, 20%)`,
                                  outline: `1.5px solid hsl(${hue}deg 38% 38% / 0.35)`,
                                }}
                              >
                                {initial}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[12px] font-bold text-white/78">
                                    @{username}
                                  </span>

                                  <SourceChip
                                    sourceId={comment.source}
                                    className="border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 text-white/36 ring-0"
                                  />

                                  {typeof comment.likes === "number" && comment.likes > 0 && (
                                    <span className="text-[10px] font-semibold text-white/32">
                                      ♥ {comment.likes}
                                    </span>
                                  )}

                                  {isSpoiler && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/18 bg-amber-400/[0.08] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.13em] text-amber-200/75">
                                      ⚠ Spoiler
                                    </span>
                                  )}

                                  {comment.translationStatus === "translated" &&
                                    !showingOriginal && (
                                      <span className="rounded-full border border-emerald-300/12 bg-emerald-500/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-100/55">
                                        PT-BR
                                      </span>
                                    )}
                                </div>

                                {isSpoiler && !spoilerRevealed ? (
                                  <div className="mt-2.5 rounded-xl border border-amber-300/10 bg-amber-400/[0.04] px-3.5 py-3">
                                    <p className="text-[12px] leading-5 text-white/42">
                                      Este comentário pode revelar partes importantes da história.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setRevealedSpoilers((prev) => {
                                          const next = new Set(prev);
                                          next.add(id);
                                          return next;
                                        })
                                      }
                                      className="mt-2 rounded-full border border-amber-300/18 bg-amber-400/[0.08] px-3 py-1.5 text-[9.5px] font-black uppercase tracking-[0.16em] text-amber-200/85 transition hover:bg-amber-400/12"
                                    >
                                      Revelar comentário
                                    </button>
                                  </div>
                                ) : (
                                  <div className="mt-2">
                                    <p className="whitespace-pre-line text-[13px] leading-[1.68] text-white/60">
                                      {text}
                                    </p>

                                    {hasTranslationToggle && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setOriginalCommentIds((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(id)) next.delete(id);
                                            else next.add(id);
                                            return next;
                                          })
                                        }
                                        className="mt-2.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[9.5px] font-black uppercase tracking-[0.16em] text-white/38 transition hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white/64"
                                      >
                                        {showingOriginal
                                          ? "← Ver tradução"
                                          : "Ver original →"}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {socialTab === "reddit" && (
                <>
                  {!redditRequested && (
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                      <p className="text-[12.5px] leading-6 text-white/45">
                        O Reddit só é carregado quando esta aba é aberta.
                      </p>

                      <button
                        type="button"
                        onClick={loadReddit}
                        className="mt-3 rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-fuchsia-100/75 transition hover:border-fuchsia-300/35 hover:bg-fuchsia-500/18 hover:text-white"
                      >
                        Buscar Reddit
                      </button>
                    </div>
                  )}

                  {redditLoading && (
                    <div className="grid gap-3">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-32 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]"
                        />
                      ))}
                    </div>
                  )}

                  {!redditLoading && redditError && (
                    <div className="flex items-start gap-3 rounded-2xl border border-rose-300/14 bg-rose-500/[0.07] p-4">
                      <span className="mt-0.5 text-base leading-none text-rose-400/60">
                        ⚠
                      </span>
                      <p className="text-[12.5px] leading-6 text-rose-100/68">
                        Não consegui carregar discussões do Reddit agora:{" "}
                        {redditError}
                      </p>
                    </div>
                  )}

                  {!redditLoading &&
                    redditRequested &&
                    !redditError &&
                    redditThreads.length === 0 && (
                      <p className="text-[12.5px] leading-6 text-white/38">
                        Nenhuma discussão relevante do Reddit foi encontrada.
                      </p>
                    )}

                  {!redditLoading && redditThreads.length > 0 && (
                    <div className="flex flex-col gap-4">
                      {redditThreads.map((thread) => (
                        <div
                          key={thread.id}
                          className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]"
                        >
                          <div className="border-b border-white/[0.06] p-4">
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded-full border border-fuchsia-300/18 bg-fuchsia-500/[0.08] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-fuchsia-100/75">
                                {getRedditHeatLabel(thread)}
                              </span>
                              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white/45">
                                {getRedditCategoryLabel(thread.category)}
                              </span>
                              {thread.isOfficialDiscussion && (
                                <span className="rounded-full border border-emerald-300/18 bg-emerald-500/[0.08] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-100/75">
                                  Oficial
                                </span>
                              )}
                              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[9px] font-bold text-white/42">
                                r/{thread.subreddit}
                              </span>
                            </div>

                            <h4 className="mt-3 text-[15px] font-bold leading-snug tracking-[-0.02em] text-white/88">
                              {thread.title}
                            </h4>

                            <div className="mt-2 flex flex-wrap gap-3 text-[10.5px] font-semibold text-white/30">
                              <span>⬆ {thread.score}</span>
                              <span>💬 {thread.comments}</span>
                              <span>úteis {thread.totalUsefulComments}</span>
                            </div>
                          </div>

                          {thread.topComments.length > 0 && (
                            <div className="grid gap-3 p-4 lg:grid-cols-2">
                              {thread.topComments.map((comment) => (
                                <div
                                  key={comment.id}
                                  className="rounded-xl border border-white/[0.05] bg-black/20 p-3.5"
                                >
                                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/32">
                                    <span className="font-bold text-white/55">
                                      u/{comment.author}
                                    </span>
                                    <span>⬆ {comment.score}</span>
                                    {comment.replyCount > 0 && (
                                      <span>{comment.replyCount} respostas</span>
                                    )}
                                    {comment.translated && (
                                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-200/70">
                                        PT-BR
                                      </span>
                                    )}
                                  </div>

                                  <p className="mt-2 whitespace-pre-line text-[12.5px] leading-6 text-white/58">
                                    {comment.bodyTranslated || comment.body}
                                  </p>

                                  {comment.translated && comment.bodyOriginal && (
                                    <details className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                                      <summary className="cursor-pointer text-[9px] font-black uppercase tracking-[0.16em] text-white/35">
                                        Ver original
                                      </summary>
                                      <p className="mt-2 whitespace-pre-line text-[12px] leading-6 text-white/42">
                                        {comment.bodyOriginal}
                                      </p>
                                    </details>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="border-t border-white/[0.06] px-4 py-3">
                            <a
                              href={thread.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-black uppercase tracking-[0.16em] text-white/42 underline decoration-white/20 underline-offset-4 transition hover:text-white/70"
                            >
                              Abrir thread no Reddit
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <ContextualAttribution
                context="community"
                sourcesUsed={["tmdb", "trakt"]}
                className="pt-1"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
