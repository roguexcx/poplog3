import { useEffect, useRef, useState } from "react";
import type { TMDBItem } from "@/types/tmdb";

const DEBOUNCE_MS = 400;
const MAX_RESULTS = 10;

export function useSearch(query: string) {
  const [results, setResults] = useState<TMDBItem[]>([]);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setLoading(true);

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Search failed: ${res.status}`);

        const data = await res.json();

        const filtered = (data.results as TMDBItem[] | undefined ?? [])
          .filter((item) => (item.media_type === "movie" || item.media_type === "tv") && item.id != null)
          .slice(0, MAX_RESULTS);

        setResults(filtered);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Erro na busca:", err);
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controllerRef.current?.abort();
    };
  }, [query]);

  return { results, loading };
}
