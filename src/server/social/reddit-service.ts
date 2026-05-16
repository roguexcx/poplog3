import { translateToPtBr } from "@/server/translate/translate-to-pt-br";

export type RedditMediaType = "tv" | "movie";

export type RedditSearchInput = {
  title: string;
  mediaType?: RedditMediaType;
  translatedTitle?: string | null;
  originalTitle?: string | null;
  year?: number | null;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
  /** Data de lançamento do episódio/filme (ISO "YYYY-MM-DD").
   *  Quando presente, posts anteriores a essa data são descartados —
   *  elimina automaticamente discussões de temporadas erradas. */
  airDate?: string | null;

  /**
   * Mantidos por compatibilidade com rotas antigas/contextuais.
   * Estes campos NUNCA validam resultado sozinhos.
   * Eles só reforçam ranking quando o título real já bateu.
   */
  network?: string | null;
  creator?: string | null;
  cast?: string[];

  maxThreads?: number;
  maxCommentsPerThread?: number;
};

export type RedditThreadCategory =
  | "episode_exact"
  | "episode_near"
  | "movie_official_discussion"
  | "series_general"
  | "movie_general"
  | "review"
  | "reaction"
  | "recap"
  | "explained"
  | "theory"
  | "meme"
  | "spam"
  | "irrelevant";

export type RedditThreadResult = {
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
  query: string;

  relevance: number;
  category: RedditThreadCategory;
  isOfficialDiscussion: boolean;
  isSpam: boolean;
  episodeMatch: boolean;

  titleMatches: string[];
  contextMatches: string[];
  matchReasons: string[];
};

export type RedditCommentResult = {
  id: string;
  parentId: string | null;
  author: string;

  body: string;
  bodyOriginal?: string;
  bodyTranslated?: string;
  translated?: boolean;
  sourceLanguage?: string | null;
  translationError?: string;

  score: number;
  createdUtc: number;
  permalink: string;
  depth: number;
  replyCount: number;
};

export type RedditThreadWithComments = RedditThreadResult & {
  topComments: RedditCommentResult[];
  totalFlatComments: number;
  totalUsefulComments: number;
};

export type RedditSocialResult = {
  source: "reddit_social_service";
  input: RedditSearchInput;
  titleAliases: string[];
  contextTerms: string[];
  queries: string[];
  totalRawResults: number;
  totalUniqueResults: number;
  threads: RedditThreadWithComments[];
  debug: {
    categoryCounts: Record<string, number>;
    redditRequests: RedditRequestDebug[];
  };
};

type RawRedditPost = {
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
  query: string;
};

type NestedRedditComment = {
  id: string;
  parentId: string | null;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  permalink: string;
  depth: number;
  replies: NestedRedditComment[];
};

type RedditRequestDebug = {
  query: string;
  status: number | null;
  ok: boolean;
  count: number;
  error?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cache em memória para resultados Reddit por episódio.
// TTL de 6 horas: suficiente para evitar rebuscas desnecessárias durante uma
// sessão de navegação, sem risco de mostrar dados muito antigos.
const REDDIT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type RedditCacheEntry = {
  result: RedditSocialResult;
  expiresAt: number;
};

const redditResultCache = new Map<string, RedditCacheEntry>();

function makeRedditCacheKey(input: RedditSearchInput): string {
  const title = (input.originalTitle || input.title || "").toLowerCase().replace(/\s+/g, "_");
  const mediaType = input.mediaType || "tv";
  const season = input.season ?? 0;
  const episode = input.episode ?? 0;
  return `${mediaType}:${title}:s${season}e${episode}`;
}

function getRedditCache(key: string): RedditSocialResult | null {
  const entry = redditResultCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    redditResultCache.delete(key);
    return null;
  }
  return entry.result;
}

function setRedditCache(key: string, result: RedditSocialResult): void {
  redditResultCache.set(key, {
    result,
    expiresAt: Date.now() + REDDIT_CACHE_TTL_MS,
  });
}

function normalizeBasic(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeCompact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeHashtag(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;

    const key = normalizeCompact(text);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    output.push(text);
  }

  return output;
}

function getMainTitle(input: RedditSearchInput) {
  return (input.originalTitle || input.title || input.translatedTitle || "").trim();
}

function buildTitleAliases(input: RedditSearchInput) {
  const titles = uniqueStrings([
    input.originalTitle,
    input.title,
    input.translatedTitle,
  ]);

  return uniqueStrings(
    titles.flatMap((title) => {
      const noSpaces = title.replace(/\s+/g, "");
      const dashed = title.replace(/\s+/g, "-");
      const hashtag = `#${normalizeHashtag(title)}`;

      return [title, noSpaces, dashed, hashtag];
    }),
  );
}

function splitContextList(value?: string | null) {
  if (!value) return [];

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildContextTerms(input: RedditSearchInput) {
  return uniqueStrings([
    input.episodeTitle,
    input.year ? String(input.year) : null,
    ...splitContextList(input.network),
    ...splitContextList(input.creator),
    ...(input.cast || []),
  ]);
}

function getEpisodeCodes(input: RedditSearchInput) {
  if ((input.mediaType || "tv") === "movie") return [];
  if (!input.season || !input.episode) return [];

  const season = input.season;
  const episode = input.episode;
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");

  return [
    `S${s}E${e}`,
    `S${season}E${episode}`,
    `${season}x${e}`,
    `${season}x${episode}`,
    `E${e}`,
    `E${episode}`,
    `Episode ${episode}`,
    `Ep ${episode}`,
  ];
}

function buildQueries(input: RedditSearchInput) {
  const mediaType = input.mediaType || "tv";
  const mainTitle = getMainTitle(input);
  const hashtag = normalizeHashtag(mainTitle);

  // Subreddit inferido do título principal (ex: "Half Man" → "halfman")
  // Usado como dica de busca para comunidades dedicadas — nem sempre existe,
  // mas quando existe melhora muito os resultados.
  const inferredSubreddit = mainTitle.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (mediaType === "movie") {
    return uniqueStrings([
      input.year ? `${mainTitle} ${input.year}` : null,
      input.year ? `"${mainTitle}" ${input.year}` : null,
      `${mainTitle} official discussion`,
      `"${mainTitle}" official discussion`,
      `${mainTitle} discussion`,
      `${mainTitle} review`,
      `${mainTitle} reaction`,
      `${mainTitle} ending explained`,
      `subreddit:${inferredSubreddit} discussion`,
      `#${hashtag}`,
      `#${hashtag}Review`,
    ]).slice(0, 10);
  }

  const season = input.season || 1;
  const episode = input.episode || 1;
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");

  // Título do episódio — só usar se não for genérico (ex: "Episode 2", "Pilot")
  const epTitle = input.episodeTitle?.trim();
  const epTitleUseful =
    epTitle &&
    epTitle.length > 4 &&
    !/^(episode|ep|pilot)\s*\d*$/i.test(epTitle);

  return uniqueStrings([
    // Formatos canônicos SxxExx
    `${mainTitle} S${s}E${e}`,
    `"${mainTitle}" S${s}E${e}`,
    `${mainTitle} S${s}E${e} Discussion`,

    // Formatos alternativos usados por comunidades (1x02, season 1 episode 2)
    `${mainTitle} ${season}x${e}`,
    `${mainTitle} season ${season} episode ${episode}`,

    // Discussões por número de episódio (sem código de temporada)
    `${mainTitle} Episode ${episode} Discussion`,
    `${mainTitle} E${e} Discussion`,

    // Discussões oficiais (megathreads, post-episode)
    `${mainTitle} Official Discussion`,
    `${mainTitle} Post Episode Discussion`,

    // Busca dentro do subreddit dedicado — muito mais preciso quando existe
    `subreddit:${inferredSubreddit} S${s}E${e}`,
    `subreddit:${inferredSubreddit} episode ${episode} discussion`,

    // Título do episódio quando útil (não genérico)
    epTitleUseful ? `"${mainTitle}" "${epTitle}"` : null,
    epTitleUseful ? `subreddit:${inferredSubreddit} "${epTitle}"` : null,
  ]).slice(0, 13);
}

function getSearchable(post: RawRedditPost) {
  return `${post.title} ${post.selftext} ${post.subreddit}`;
}

function getMatches(text: string, terms: string[]) {
  const basicText = normalizeBasic(text);
  const compactText = normalizeCompact(text);

  return terms.filter((term) => {
    const basicTerm = normalizeBasic(term);
    const compactTerm = normalizeCompact(term);
    if (!basicTerm && !compactTerm) return false;

    return basicText.includes(basicTerm) || compactText.includes(compactTerm);
  });
}

function getTitleMatches(post: RawRedditPost, titleAliases: string[]) {
  return getMatches(getSearchable(post), titleAliases);
}

function getStrongTitleMatches(post: RawRedditPost, titleAliases: string[]) {
  const strongText = `${post.title} ${post.subreddit}`;
  return getMatches(strongText, titleAliases);
}

function getContextMatches(post: RawRedditPost, contextTerms: string[]) {
  return getMatches(getSearchable(post), contextTerms);
}

function hasStrongTitleMatch(post: RawRedditPost, titleAliases: string[]) {
  return getStrongTitleMatches(post, titleAliases).length > 0;
}

function hasEpisodeMatch(post: RawRedditPost, input: RedditSearchInput) {
  if ((input.mediaType || "tv") === "movie") return false;

  return getMatches(`${post.title} ${post.selftext}`, getEpisodeCodes(input)).length > 0;
}

function hasEpisodeMatchInTitle(post: RawRedditPost, input: RedditSearchInput) {
  if ((input.mediaType || "tv") === "movie") return false;

  return getMatches(post.title, getEpisodeCodes(input)).length > 0;
}

function extractEpisodeNumbersFromTitle(title: string) {
  const normalized = normalizeBasic(title);
  const compact = normalizeCompact(title);
  const found = new Set<number>();

  const simplePatterns = [
    /\be\s*0?(\d{1,3})\b/gi,
    /\bep\s*0?(\d{1,3})\b/gi,
    /\bepisode\s*0?(\d{1,3})\b/gi,
  ];

  for (const pattern of simplePatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const number = Number(match[1]);
      if (Number.isFinite(number)) found.add(number);
    }
  }

  const compactPatterns = [
    /s\d{1,2}e0?(\d{1,3})/gi,
    /\d{1,2}x0?(\d{1,3})/gi,
  ];

  for (const pattern of compactPatterns) {
    for (const match of compact.matchAll(pattern)) {
      const number = Number(match[1]);
      if (Number.isFinite(number)) found.add(number);
    }
  }

  return Array.from(found);
}

function hasDifferentEpisodeInTitle(post: RawRedditPost, input: RedditSearchInput) {
  if ((input.mediaType || "tv") === "movie") return false;
  if (!input.episode) return false;

  const episodeNumbers = extractEpisodeNumbersFromTitle(post.title);

  return episodeNumbers.some((episode) => episode !== input.episode);
}

function isOfficialDiscussion(post: RawRedditPost) {
  const text = normalizeBasic(`${post.title} ${post.selftext}`);

  return [
    "official discussion",
    "episode discussion",
    "discussion thread",
    "post episode discussion",
    "post episode thread",
    "megathread",
    "spoilers",
  ].some((signal) => text.includes(signal));
}

function detectSpamText(text: string) {
  const normalized = normalizeBasic(text);

  return [
    "where to watch",
    "watch for free",
    "free stream",
    "stream without subscription",
    "download",
    "torrent",
    "cine su",
    "123movies",
    "fmovies",
    "soap2day",
    "putlocker",
  ].some((signal) => normalized.includes(signal));
}

function detectSpam(post: RawRedditPost) {
  return detectSpamText(`${post.title} ${post.selftext} ${post.url}`);
}

function isHardRejectedTvPost(
  post: RawRedditPost,
  input: RedditSearchInput,
  titleAliases: string[],
) {
  if ((input.mediaType || "tv") === "movie") return false;

  if (detectSpam(post)) return true;
  if (!hasStrongTitleMatch(post, titleAliases)) return true;
  if (hasDifferentEpisodeInTitle(post, input)) return true;

  return false;
}

function detectCategory(params: {
  post: RawRedditPost;
  input: RedditSearchInput;
  titleAliases: string[];
}): RedditThreadCategory {
  const { post, input, titleAliases } = params;
  const mediaType = input.mediaType || "tv";
  const text = normalizeBasic(`${post.title} ${post.selftext}`);

  if (detectSpam(post)) return "spam";

  const strongTitleMatch = hasStrongTitleMatch(post, titleAliases);
  const weakTitleMatch = getTitleMatches(post, titleAliases).length > 0;

  if (!weakTitleMatch) return "irrelevant";

  if (mediaType === "movie") {
    if (!strongTitleMatch) return "irrelevant";
    if (isOfficialDiscussion(post)) return "movie_official_discussion";
    if (text.includes("review")) return "review";
    if (text.includes("reaction")) return "reaction";
    if (text.includes("ending explained") || text.includes("explained")) return "explained";
    if (text.includes("theory") || text.includes("plot twist")) return "theory";
    if (text.includes("meme")) return "meme";
    return "movie_general";
  }

  if (isHardRejectedTvPost(post, input, titleAliases)) return "irrelevant";

  const episodeMatch = hasEpisodeMatch(post, input);
  const episodeMatchInTitle = hasEpisodeMatchInTitle(post, input);
  const official = isOfficialDiscussion(post);

  // Não usamos mais episode_near como categoria final. Ou é forte o bastante
  // para episode_exact, ou cai como irrelevante/geral.
  if ((episodeMatchInTitle || episodeMatch) && official) return "episode_exact";
  if (episodeMatchInTitle) return "episode_exact";

  if (text.includes("review")) return "review";
  if (text.includes("reaction")) return "reaction";
  if (text.includes("recap")) return "recap";
  if (text.includes("ending explained") || text.includes("explained")) return "explained";
  if (text.includes("theory") || text.includes("plot twist")) return "theory";
  if (text.includes("meme")) return "meme";

  return "series_general";
}

function getMatchReasons(params: {
  post: RawRedditPost;
  input: RedditSearchInput;
  titleAliases: string[];
  contextTerms: string[];
}) {
  const { post, input, titleAliases, contextTerms } = params;

  const reasons: string[] = [];
  const titleMatches = getTitleMatches(post, titleAliases);
  const strongTitleMatches = getStrongTitleMatches(post, titleAliases);
  const contextMatches = getContextMatches(post, contextTerms);

  if (titleMatches.length > 0) reasons.push("title_match");
  if (strongTitleMatches.length > 0) reasons.push("strong_title_match");
  if (contextMatches.length > 0) reasons.push("context_boost");
  if (hasEpisodeMatch(post, input)) reasons.push("episode_match");
  if (hasEpisodeMatchInTitle(post, input)) reasons.push("episode_title_match");
  if (hasDifferentEpisodeInTitle(post, input)) reasons.push("different_episode_rejected");
  if (isOfficialDiscussion(post)) reasons.push("official_discussion_signal");
  if (detectSpam(post)) reasons.push("spam_signal");
  if (post.comments >= 50) reasons.push("high_comment_count");
  if (post.score >= 50) reasons.push("high_score");

  const text = normalizeBasic(`${post.title} ${post.selftext}`);

  if (text.includes("review")) reasons.push("review_signal");
  if (text.includes("reaction")) reasons.push("reaction_signal");
  if (text.includes("recap")) reasons.push("recap_signal");
  if (text.includes("explained")) reasons.push("explained_signal");
  if (text.includes("theory") || text.includes("plot twist")) reasons.push("theory_signal");

  return reasons;
}

function scorePost(params: {
  post: RawRedditPost;
  input: RedditSearchInput;
  titleAliases: string[];
  contextTerms: string[];
}) {
  const { post, input, titleAliases, contextTerms } = params;
  const mediaType = input.mediaType || "tv";

  const text = normalizeBasic(`${post.title} ${post.selftext} ${post.subreddit}`);
  const subreddit = post.subreddit.toLowerCase();

  const titleMatches = getTitleMatches(post, titleAliases);
  const strongTitleMatches = getStrongTitleMatches(post, titleAliases);
  const contextMatches = getContextMatches(post, contextTerms);
  const episodeMatch = hasEpisodeMatch(post, input);
  const episodeMatchInTitle = hasEpisodeMatchInTitle(post, input);
  const official = isOfficialDiscussion(post);
  const spam = detectSpam(post);
  const category = detectCategory({ post, input, titleAliases });

  let relevance = 0;

  if (titleMatches.length === 0) return 0;
  if (mediaType === "tv" && isHardRejectedTvPost(post, input, titleAliases)) return 0;
  if (mediaType === "movie" && strongTitleMatches.length === 0) return 0;

  relevance += 90;
  relevance += Math.min(titleMatches.length * 16, 55);
  relevance += Math.min(strongTitleMatches.length * 36, 110);
  relevance += Math.min(contextMatches.length * 12, 60);

  if (episodeMatch) relevance += 65;
  if (episodeMatchInTitle) relevance += 110;
  if (official) relevance += 90;

  if (category === "episode_exact") relevance += 170;
  if (category === "movie_official_discussion") relevance += 150;
  if (category === "series_general") relevance += 5;
  if (category === "movie_general") relevance += 15;
  if (category === "review") relevance += 20;
  if (category === "reaction") relevance += 20;
  if (category === "recap") relevance += 16;
  if (category === "explained") relevance += 8;
  if (category === "theory") relevance += 12;
  if (category === "meme") relevance -= 25;

  const usefulSubreddits = [
    "television",
    "hbo",
    "hbomax",
    "max",
    "tv",
    "series",
    "movies",
    "movie",
  ];

  if (usefulSubreddits.includes(subreddit)) relevance += 14;

  // Subreddits genéricos de conteúdo adulto, pirataria ou totalmente off-topic
  // NÃO colocar aqui nomes de séries reais — isso quebraria buscas por Mad Men,
  // Invincible, Loki, Star Wars etc. A filtragem por título já cuida disso via
  // hasStrongTitleMatch / isHardRejectedTvPost.
  const offTopicSubreddits = [
    "piracy",
    "freeuse",
    "repost",
    "shitposting",
  ];

  if (offTopicSubreddits.includes(subreddit)) relevance -= 180;

  if (spam) relevance -= 280;

  relevance += Math.min(post.score / 10, 28);
  relevance += Math.min(post.comments / 4, 42);

  if (mediaType === "movie" && input.year && text.includes(String(input.year))) {
    relevance += 25;
  }

  return Math.round(Math.max(relevance, 0));
}

function categoryRank(category: RedditThreadCategory) {
  const ranks: Record<RedditThreadCategory, number> = {
    episode_exact: 1,
    movie_official_discussion: 1,
    review: 3,
    reaction: 4,
    recap: 5,
    explained: 6,
    theory: 7,
    series_general: 8,
    movie_general: 8,
    meme: 9,
    episode_near: 50,
    spam: 99,
    irrelevant: 100,
  };

  return ranks[category] ?? 50;
}

async function searchReddit(query: string): Promise<{
  posts: RawRedditPost[];
  debug: RedditRequestDebug;
}> {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("t", "all");
  url.searchParams.set("limit", "25");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "POPLOG/3.0 reddit social service",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        posts: [],
        debug: {
          query,
          status: response.status,
          ok: false,
          count: 0,
          error: `HTTP ${response.status}`,
        },
      };
    }

    const json = await response.json();
    const children = json?.data?.children ?? [];

    const posts = children.map((item: any) => {
      const data = item.data;

      return {
        id: data.id ?? "",
        title: data.title ?? "",
        subreddit: data.subreddit ?? "",
        author: data.author ?? "",
        score: data.score ?? 0,
        comments: data.num_comments ?? 0,
        createdUtc: data.created_utc ?? 0,
        url: data.url ?? "",
        permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : "",
        selftext: data.selftext ?? "",
        query,
      };
    });

    return {
      posts,
      debug: {
        query,
        status: response.status,
        ok: true,
        count: posts.length,
      },
    };
  } catch (error: any) {
    return {
      posts: [],
      debug: {
        query,
        status: null,
        ok: false,
        count: 0,
        error: error?.message || "reddit_request_failed",
      },
    };
  }
}

function cleanBody(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .trim();
}

function parseComments(children: any[], depth = 0): NestedRedditComment[] {
  if (!Array.isArray(children)) return [];

  const comments: NestedRedditComment[] = [];

  for (const child of children) {
    if (!child || child.kind !== "t1") continue;

    const data = child.data;

    const repliesChildren =
      data?.replies &&
      typeof data.replies === "object" &&
      Array.isArray(data.replies?.data?.children)
        ? data.replies.data.children
        : [];

    const replies = parseComments(repliesChildren, depth + 1);

    comments.push({
      id: data.id ?? "",
      parentId: data.parent_id ?? null,
      author: data.author ?? "[unknown]",
      body: cleanBody(data.body ?? ""),
      score: data.score ?? 0,
      createdUtc: data.created_utc ?? 0,
      permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : "",
      depth,
      replies,
    });
  }

  return comments;
}

function flattenComments(comments: NestedRedditComment[]): RedditCommentResult[] {
  const flat: RedditCommentResult[] = [];

  function walk(comment: NestedRedditComment) {
    flat.push({
      id: comment.id,
      parentId: comment.parentId,
      author: comment.author,
      body: comment.body,
      score: comment.score,
      createdUtc: comment.createdUtc,
      permalink: comment.permalink,
      depth: comment.depth,
      replyCount: comment.replies.length,
    });

    for (const reply of comment.replies) {
      walk(reply);
    }
  }

  for (const comment of comments) {
    walk(comment);
  }

  return flat;
}

function isUsefulComment(comment: RedditCommentResult) {
  if (!comment.body) return false;
  if (comment.body === "[deleted]") return false;
  if (comment.body === "[removed]") return false;
  if (comment.body.length < 25) return false;
  if (detectSpamText(comment.body)) return false;

  return true;
}

async function getThreadComments(
  thread: RedditThreadResult,
  maxComments: number,
): Promise<{
  topComments: RedditCommentResult[];
  totalFlatComments: number;
  totalUsefulComments: number;
}> {
  if (!thread.permalink) {
    return {
      topComments: [],
      totalFlatComments: 0,
      totalUsefulComments: 0,
    };
  }

  const redditJsonUrl = `${thread.permalink.replace(/\/$/, "")}.json`;

  const response = await fetch(redditJsonUrl, {
    headers: {
      "User-Agent": "POPLOG/3.0 reddit thread comments",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      topComments: [],
      totalFlatComments: 0,
      totalUsefulComments: 0,
    };
  }

  const json = await response.json();
  const commentChildren = json?.[1]?.data?.children ?? [];

  const nestedComments = parseComments(commentChildren);
  const flatComments = flattenComments(nestedComments);

  const usefulComments = flatComments
    .filter(isUsefulComment)
    .sort((a, b) => b.score - a.score);

  const translatedComments = await Promise.all(
    usefulComments.slice(0, maxComments).map(async (comment) => {
      const translation = await translateToPtBr(comment.body);

      return {
        ...comment,
        bodyOriginal: translation.originalText,
        bodyTranslated: translation.translatedText,
        translated: translation.translated,
        sourceLanguage: translation.sourceLanguage,
        translationError: translation.error,
        body: translation.translatedText,
      };
    }),
  );

  return {
    topComments: translatedComments,
    totalFlatComments: flatComments.length,
    totalUsefulComments: usefulComments.length,
  };
}

export async function getRedditSocialForTitle(
  input: RedditSearchInput,
): Promise<RedditSocialResult> {
  const normalizedInput: RedditSearchInput = {
    ...input,
    mediaType: input.mediaType || "tv",
    maxThreads: input.maxThreads || 5,
    maxCommentsPerThread: input.maxCommentsPerThread || 8,
  };

  const cacheKey = makeRedditCacheKey(normalizedInput);
  const cached = getRedditCache(cacheKey);
  if (cached) return cached;

  const titleAliases = buildTitleAliases(normalizedInput);
  const contextTerms = buildContextTerms(normalizedInput);
  const queries = buildQueries(normalizedInput);

  const allPosts: RawRedditPost[] = [];
  const redditRequests: RedditRequestDebug[] = [];

  // Queries sequenciais com 80ms entre elas — a API pública do Reddit sem auth
  // rate-limita rapidamente em paralelo, causando falhas silenciosas.
  for (const query of queries) {
    const result = await searchReddit(query);
    allPosts.push(...result.posts);
    redditRequests.push(result.debug);
    await sleep(80);
  }

  const uniqueMap = new Map<string, RawRedditPost>();

  for (const post of allPosts) {
    if (!post.id) continue;
    if (!uniqueMap.has(post.id)) {
      uniqueMap.set(post.id, post);
    }
  }

  // Filtro por data de lançamento: descartar posts anteriores ao airDate.
  // Com um buffer de 12h para cobrir fusos horários (posts publicados horas
  // antes da meia-noite UTC do dia de estreia em regiões mais avançadas).
  // Isso elimina automaticamente discussões de temporadas anteriores que
  // aparecem quando o episódio certo ainda não foi indexado pelo Reddit.
  const airDateMs = normalizedInput.airDate
    ? new Date(normalizedInput.airDate).getTime() - 12 * 60 * 60 * 1000
    : null;

  const candidateResults = airDateMs
    ? Array.from(uniqueMap.values()).filter(
        (post) => post.createdUtc * 1000 >= airDateMs,
      )
    : Array.from(uniqueMap.values());

  const classified: RedditThreadResult[] = candidateResults.map((post) => {
    const titleMatches = getTitleMatches(post, titleAliases);
    const contextMatches = getContextMatches(post, contextTerms);
    const category = detectCategory({
      post,
      input: normalizedInput,
      titleAliases,
    });

    return {
      ...post,
      category,
      titleMatches,
      contextMatches,
      isOfficialDiscussion: isOfficialDiscussion(post),
      isSpam: detectSpam(post),
      episodeMatch: hasEpisodeMatch(post, normalizedInput),
      matchReasons: getMatchReasons({
        post,
        input: normalizedInput,
        titleAliases,
        contextTerms,
      }),
      relevance: scorePost({
        post,
        input: normalizedInput,
        titleAliases,
        contextTerms,
      }),
    };
  });

  const rankedThreads = classified
    .filter((post) => post.category !== "irrelevant")
    .filter((post) => post.category !== "spam")
    .filter((post) => post.category !== "episode_near")
    .filter((post) => post.relevance >= 90)
    .sort((a, b) => {
      const categoryDiff = categoryRank(a.category) - categoryRank(b.category);
      if (categoryDiff !== 0) return categoryDiff;
      return b.relevance - a.relevance;
    })
    .slice(0, normalizedInput.maxThreads);

  const threadsWithComments = await Promise.all(
    rankedThreads.map(async (thread) => {
      const comments = await getThreadComments(
        thread,
        normalizedInput.maxCommentsPerThread || 8,
      );

      return {
        ...thread,
        ...comments,
      };
    }),
  );

  const finalResult: RedditSocialResult = {
    source: "reddit_social_service",
    input: normalizedInput,
    titleAliases,
    contextTerms,
    queries,
    totalRawResults: allPosts.length,
    totalUniqueResults: candidateResults.length,
    threads: threadsWithComments,
    debug: {
      redditRequests,
      categoryCounts: classified.reduce<Record<string, number>>((acc, post) => {
        acc[post.category] = (acc[post.category] || 0) + 1;
        return acc;
      }, {}),
    },
  };

  // Only cache when we actually found results — avoids locking in empty
  // responses caused by rate limiting (which would block real results for 6h)
  if (finalResult.threads.length > 0) {
    setRedditCache(cacheKey, finalResult);
  }

  return finalResult;
}
