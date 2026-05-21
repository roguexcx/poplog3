type YouTubeCandidate = {
  videoId: string;
  title: string;
  channelTitle?: string;
};

type TrailerPreference = "dubbed" | "subtitled" | "english";

const TRUSTED_TRAILER_CHANNEL_HINTS = [
  "20th century",
  "a24",
  "amazon",
  "apple tv",
  "disney",
  "hbo",
  "hulu",
  "lionsgate",
  "marvel",
  "netflix",
  "paramount",
  "prime video",
  "sony",
  "universal",
  "warner",
];

const FAN_CONTENT_HINTS = [
  "dublagem caseira",
  "dublagem de fa",
  "dublagem fã",
  "fan dub",
  "fandub",
  "fanmade",
  "feito por fa",
  "feito por fã",
  "parody",
  "parodia",
  "paródia",
  "redublado",
  "trailer fan",
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isFanContent(value: string) {
  const normalized = normalize(value);
  return FAN_CONTENT_HINTS.some((hint) => normalized.includes(normalize(hint)));
}

function scoreCandidate(
  candidate: YouTubeCandidate,
  title: string,
  preference: TrailerPreference,
  year?: string | null,
): number {
  const haystack = normalize(`${candidate.title} ${candidate.channelTitle ?? ""}`);
  const normalizedTitle = normalize(title);
  let score = 0;

  if (isFanContent(`${candidate.title} ${candidate.channelTitle ?? ""}`)) return -999;
  if (haystack.includes(normalizedTitle)) score += 80;
  if (haystack.includes("official trailer")) score += 60;
  if (haystack.includes("trailer oficial")) score += 60;
  if (haystack.includes("trailer")) score += 24;
  if (year && haystack.includes(year)) score += 10;

  if (preference === "dubbed") {
    if (haystack.includes("dublado") || haystack.includes("dubbed")) score += 42;
    if (haystack.includes("legendado") || haystack.includes("subtitulado") || haystack.includes("subtitled")) score -= 12;
  }
  if (preference === "subtitled") {
    if (haystack.includes("legendado") || haystack.includes("subtitulado") || haystack.includes("subtitled")) score += 42;
    if (haystack.includes("dublado") || haystack.includes("dubbed")) score -= 10;
  }
  if (preference === "english") {
    if (haystack.includes("official trailer")) score += 16;
    if (haystack.includes("dublado") || haystack.includes("legendado") || haystack.includes("subtitled")) score -= 8;
  }

  if (TRUSTED_TRAILER_CHANNEL_HINTS.some((hint) => haystack.includes(hint))) score += 18;
  if (haystack.includes("reaction") || haystack.includes("review") || haystack.includes("explained")) score -= 45;
  if (haystack.includes("clip") || haystack.includes("scene")) score -= 20;
  if (haystack.includes("teaser")) score -= 8;

  return score;
}

async function searchWithYouTubeApi(query: string): Promise<YouTubeCandidate[]> {
  const apiKey = process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "8");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString(), { next: { revalidate: 60 * 60 * 24 } });
  if (!response.ok) return [];

  const data = await response.json() as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: { title?: string; channelTitle?: string };
    }>;
  };

  return (data.items ?? [])
    .map((item) => ({
      videoId: item.id?.videoId ?? "",
      title: item.snippet?.title ?? "",
      channelTitle: item.snippet?.channelTitle,
    }))
    .filter((item) => item.videoId && item.title);
}

async function searchWithYouTubePage(query: string): Promise<YouTubeCandidate[]> {
  const url = new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query", query);

  const response = await fetch(url.toString(), {
    next: { revalidate: 60 * 60 * 24 },
    headers: {
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "user-agent": "Mozilla/5.0 POPLOG trailer lookup",
    },
  });
  if (!response.ok) return [];

  const html = await response.text();
  const candidates: YouTubeCandidate[] = [];
  const seen = new Set<string>();
  const regex = /"videoRenderer":\{[\s\S]*?"videoId":"([^"]+)"[\s\S]*?"title":\{"runs":\[\{"text":"([^"]+)"\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) && candidates.length < 12) {
    const videoId = match[1];
    const rawTitle = match[2]
      .replace(/\\"/g, '"')
      .replace(/\\u0026/g, "&");

    if (seen.has(videoId)) continue;
    seen.add(videoId);
    candidates.push({ videoId, title: rawTitle });
  }

  return candidates;
}

export async function findOfficialTrailerOnYouTube(input: {
  title: string;
  year?: string | null;
  mediaType: "movie" | "tv";
}): Promise<string | null> {
  const title = input.title.trim();
  if (!title) return null;

  const mediaHint = input.mediaType === "tv" ? "series" : "movie";
  const searches: Array<{ preference: TrailerPreference; query: string; minScore: number }> = [
    {
      preference: "dubbed",
      query: [title, input.year, mediaHint, "trailer oficial dublado"].filter(Boolean).join(" "),
      minScore: 95,
    },
    {
      preference: "subtitled",
      query: [title, input.year, mediaHint, "trailer oficial legendado"].filter(Boolean).join(" "),
      minScore: 95,
    },
    {
      preference: "english",
      query: [title, input.year, mediaHint, "official trailer"].filter(Boolean).join(" "),
      minScore: 90,
    },
  ];

  try {
    for (const search of searches) {
      const apiResults = await searchWithYouTubeApi(search.query);
      const pageResults = apiResults.length > 0 ? [] : await searchWithYouTubePage(search.query);
      const candidates = [...apiResults, ...pageResults]
        .map((candidate) => ({
          ...candidate,
          score: scoreCandidate(candidate, title, search.preference, input.year),
        }))
        .filter((candidate) => candidate.score >= search.minScore)
        .sort((a, b) => b.score - a.score);

      if (candidates[0]?.videoId) return candidates[0].videoId;
    }

    return null;
  } catch {
    return null;
  }
}
