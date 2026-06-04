"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { notifyUserTitlesUpdated } from "@/hooks/useTitleToggle";
import { enqueueFeedbackBatch } from "@/lib/feedbackBatchLoader";
import type { MediaType } from "@/types/user";

type Input = {
  tmdbId: number;
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  mediaType: MediaType;
  source: string;
  initialNotInterested?: boolean;
};

export function useUserFeedbackToggle({
  tmdbId,
  poplogId = null,
  imdbId = null,
  slug = null,
  mediaType,
  source,
  initialNotInterested = false,
}: Input) {
  const { user, loading: authLoading } = useAuth();
  const [notInterested, setNotInterested] = useState(initialNotInterested);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;

    const controller = new AbortController();

    // Usa o batcher para consolidar as leituras de todos os cards
    // que montam no mesmo ciclo em um único POST /api/user/feedback/batch.
    enqueueFeedbackBatch(tmdbId, mediaType, controller.signal)
      .then((state) => {
        setNotInterested(Boolean(state.notInterested));
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== "AbortError") console.error(err);
      });

    return () => controller.abort();
  }, [authLoading, mediaType, tmdbId, user]);

  const toggleNotInterested = useCallback(async () => {
    if (!user || saving) return;

    const next = !notInterested;
    setNotInterested(next);
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/user/feedback", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdb_id: tmdbId,
          poplogId,
          imdbId,
          slug,
          media_type: mediaType,
          feedback_type: "not_interested",
          source,
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        const message = json?.error ?? `Feedback failed: ${response.status}`;
        setError(message);
        setNotInterested(!next);
        return;
      }
      setNotInterested(Boolean(json.titleState?.userFeedback?.notInterested));
      notifyUserTitlesUpdated();
    } catch (err) {
      console.error(err);
      setNotInterested(!next);
    } finally {
      setSaving(false);
    }
  }, [mediaType, notInterested, saving, source, tmdbId, poplogId, imdbId, slug, user]);

  return {
    notInterested,
    saving,
    loading: authLoading,
    error,
    isLoggedIn: Boolean(user),
    toggleNotInterested,
  };
}
