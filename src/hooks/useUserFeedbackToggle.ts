"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { notifyUserTitlesUpdated } from "@/hooks/useTitleToggle";
import type { MediaType } from "@/types/user";

type Input = {
  tmdbId: number;
  mediaType: MediaType;
  source: string;
  initialNotInterested?: boolean;
};

export function useUserFeedbackToggle({
  tmdbId,
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
    const params = new URLSearchParams({
      tmdb_id: String(tmdbId),
      media_type: mediaType,
      feedback_type: "not_interested",
    });

    fetch(`/api/user/feedback?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (json) setNotInterested(Boolean(json.titleState?.userFeedback?.notInterested));
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") console.error(error);
      });

    return () => controller.abort();
  }, [authLoading, initialNotInterested, mediaType, tmdbId, user]);

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
    } catch (error) {
      console.error(error);
      setNotInterested(!next);
    } finally {
      setSaving(false);
    }
  }, [mediaType, notInterested, saving, source, tmdbId, user]);

  return {
    notInterested,
    saving,
    loading: authLoading,
    error,
    isLoggedIn: Boolean(user),
    toggleNotInterested,
  };
}
