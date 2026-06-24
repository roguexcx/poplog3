import { useEffect, useRef, useState } from "react";
import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";

const DEBOUNCE_MS = 300;
const MAX_TITLES = 8;
const MAX_PEOPLE = 4;
const MAX_COMPANIES = 3;

export type QuickSearchTitle = TMDBItem & {
  id: number;
  media_type: TMDBMediaType;
  tmdb_id?: number;
};

export type QuickSearchPerson = {
  id: string;
  imdb_id?: string | null;
  name: string;
  profile_path: string | null;
  known_for_department: string | null;
  known_for: Array<{
    title: string;
    media_type?: string;
    year?: number | null;
    poster_path?: string | null;
  }>;
  href: string;
};

export type QuickSearchCompany = {
  id?: string | null;
  name: string;
  logo_path?: string | null;
  origin_country?: string | null;
  description?: string | null;
};

type RawSearchTitle = Partial<TMDBItem> & {
  id?: number;
  tmdb_id?: number;
  media_type?: TMDBMediaType;
};

type QuickSearchResponse = {
  ok: boolean;
  titles?: RawSearchTitle[];
  results?: RawSearchTitle[];
  people?: QuickSearchPerson[];
  companies?: QuickSearchCompany[];
};

function normalizeTitle(item: RawSearchTitle): QuickSearchTitle | null {
  const id =
    typeof item.id === "number"
      ? item.id
      : typeof item.tmdb_id === "number"
        ? item.tmdb_id
        : item.externalIds?.tmdbId;

  if (!id) return null;

  const mediaType = item.media_type === "tv" ? "tv" : "movie";

  return {
    ...item,
    id,
    media_type: mediaType,
  };
}

export function useSearch(query: string) {
  const [results, setResults] = useState<QuickSearchTitle[]>([]);
  const [people, setPeople] = useState<QuickSearchPerson[]>([]);
  const [companies, setCompanies] = useState<QuickSearchCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      setResults([]);
      setPeople([]);
      setCompanies([]);
      setLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setLoading(true);

      try {
        const params = new URLSearchParams({
          q: trimmed,
          type: "all",
          page: "1",
        });
        const res = await fetch(`/api/poplog3/search?${params}`, {
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Search failed: ${res.status}`);

        const data = (await res.json()) as QuickSearchResponse;

        const titles = (data.titles ?? data.results ?? [])
          .map(normalizeTitle)
          .filter((item): item is QuickSearchTitle => item !== null)
          .slice(0, MAX_TITLES);

        setResults(titles);
        setPeople((data.people ?? []).filter((person) => Boolean(person.href)).slice(0, MAX_PEOPLE));
        setCompanies((data.companies ?? []).filter((company) => Boolean(company.name)).slice(0, MAX_COMPANIES));
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Erro na busca:", err);
          setResults([]);
          setPeople([]);
          setCompanies([]);
        }
      } finally {
        if (controllerRef.current === controller) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controllerRef.current?.abort();
    };
  }, [query]);

  return { results, people, companies, loading };
}
