"use client";

/**
 * useUserRating
 *
 * Gerencia a avaliação pessoal do usuário para um título/episódio/temporada.
 *
 * Fluxo:
 *   1. Inicializa com o valor vindo do server (initialRating).
 *   2. Ao usuário selecionar uma nota, aplica update otimista imediato.
 *   3. Persiste via POST /api/ratings (debounced 400ms para evitar spam).
 *   4. Em caso de erro, reverte para o valor anterior.
 *   5. Clique na nota atual → DELETE /api/ratings (remove avaliação).
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  CommunityRatingData,
  RatingMediaType,
  UserRatingData,
} from "@/types/user";

type UseUserRatingOptions = {
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  initialRating?: UserRatingData | null;
  isAuthenticated?: boolean;
  onCommunityRatingChange?: (rating: CommunityRatingData | null) => void;
  onParentCommunityRatingChange?: (rating: CommunityRatingData | null) => void;
};

type UseUserRatingReturn = {
  /** Nota atual (otimista). null = sem avaliação. */
  rating: number | null;
  /** true enquanto aguarda resposta da API. */
  isPending: boolean;
  /** Mensagem de erro se a última operação falhou. */
  error: string | null;
  /** Seleciona uma nota. Se for igual à atual, remove a avaliação. */
  selectRating: (value: number) => void;
  /** Remove a avaliação diretamente. */
  clearRating: () => void;
};

const DEBOUNCE_MS = 400;

export function useUserRating({
  mediaType,
  tmdbId,
  seasonNumber = null,
  episodeNumber = null,
  initialRating = null,
  isAuthenticated = false,
  onCommunityRatingChange,
  onParentCommunityRatingChange,
}: UseUserRatingOptions): UseUserRatingReturn {
  const router = useRouter();
  const [rating, setRating] = useState<number | null>(
    initialRating?.rating ?? null
  );
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guarda o valor "confirmado" pelo servidor para rollback
  const committedRating = useRef<number | null>(initialRating?.rating ?? null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationVersion = useRef(0);

  const baseParams = {
    mediaType,
    tmdbId,
    seasonNumber,
    episodeNumber,
  };

  useEffect(() => {
    let cancelled = false;
    const versionAtStart = mutationVersion.current;
    const initialValue = initialRating?.rating ?? null;

    setRating(initialValue);
    committedRating.current = initialValue;
    setError(null);

    if (!isAuthenticated) return;

    const params = new URLSearchParams({
      mediaType,
      tmdbId: String(tmdbId),
    });

    if (seasonNumber !== null) {
      params.set("seasonNumber", String(seasonNumber));
    }

    if (episodeNumber !== null) {
      params.set("episodeNumber", String(episodeNumber));
    }

    fetch(`/api/ratings?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(json?.error ?? `GET /api/ratings → ${res.status}`);
        }

        return json as {
          data?: {
            userRating?: UserRatingData | null;
            communityRating?: CommunityRatingData | null;
          };
        };
      })
      .then((json) => {
        if (cancelled || mutationVersion.current !== versionAtStart) return;

        const nextRating = json.data?.userRating?.rating ?? null;
        setRating(nextRating);
        committedRating.current = nextRating;
        onCommunityRatingChange?.(json.data?.communityRating ?? null);
      })
      .catch((err) => {
        if (cancelled || mutationVersion.current !== versionAtStart) return;

        setError(
          err instanceof Error
            ? err.message
            : "Falha ao carregar avaliação."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    initialRating?.rating,
    isAuthenticated,
    mediaType,
    tmdbId,
    seasonNumber,
    episodeNumber,
    onCommunityRatingChange,
  ]);

  const persist = useCallback(
    async (newRating: number | null, previousRating: number | null) => {
      setIsPending(true);
      setError(null);

      try {
        let json: {
          data?: {
            userRating?: UserRatingData | null;
            communityRating?: CommunityRatingData | null;
            parentCommunityRating?: CommunityRatingData | null;
          };
        } | null = null;

        if (newRating === null) {
          const res = await fetch("/api/ratings", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(baseParams),
          });

          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(
              json.error ?? `DELETE /api/ratings → ${res.status}`
            );
          }

          json = await res.json().catch(() => null);
        } else {
          const res = await fetch("/api/ratings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...baseParams, rating: newRating }),
          });

          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(
              json.error ?? `POST /api/ratings → ${res.status}`
            );
          }

          json = await res.json().catch(() => null);
        }

        committedRating.current = newRating;
        onCommunityRatingChange?.(json?.data?.communityRating ?? null);
        if ("parentCommunityRating" in (json?.data ?? {})) {
          onParentCommunityRatingChange?.(
            json?.data?.parentCommunityRating ?? null
          );
        }

        window.dispatchEvent(
          new CustomEvent("poplog:rating-mutated", {
            detail: {
              mediaType,
              tmdbId,
              seasonNumber,
              episodeNumber,
              rating: newRating,
              communityRating: json?.data?.communityRating ?? null,
              parentCommunityRating:
                json?.data?.parentCommunityRating ?? null,
            },
          })
        );
        router.refresh();
      } catch (err) {
        // Rollback otimista
        setRating(previousRating);
        setError(
          err instanceof Error
            ? err.message
            : "Falha ao salvar avaliação. Tente novamente."
        );
      } finally {
        setIsPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      mediaType,
      tmdbId,
      seasonNumber,
      episodeNumber,
      onCommunityRatingChange,
      onParentCommunityRatingChange,
      router,
    ]
  );

  const schedule = useCallback(
    (newRating: number | null, previousRating: number | null) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      debounceTimer.current = setTimeout(() => {
        void persist(newRating, previousRating);
      }, DEBOUNCE_MS);
    },
    [persist]
  );

  const selectRating = useCallback(
    (value: number) => {
      if (!isAuthenticated) return;

      mutationVersion.current += 1;
      const previous = rating;

      // Clique na nota atual → remove a avaliação
      if (value === previous) {
        setRating(null);
        schedule(null, previous);
        return;
      }

      setRating(value);
      schedule(value, previous);
    },
    [isAuthenticated, rating, schedule]
  );

  const clearRating = useCallback(() => {
    if (!isAuthenticated) return;

    mutationVersion.current += 1;
    const previous = rating;
    setRating(null);
    schedule(null, previous);
  }, [isAuthenticated, rating, schedule]);

  return { rating, isPending, error, selectRating, clearRating };
}
