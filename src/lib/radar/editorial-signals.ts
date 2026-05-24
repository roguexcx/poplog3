export type RadarCompanySignal = {
  id?: number | null;
  name?: string | null;
};

export type RadarEditorialSignalInput = {
  title: string;
  mediaType?: "movie" | "tv";
  eventDate?: string | null;
  popularity?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  originalLanguage?: string | null;
  originCountry?: string[] | null;
  backdropPath?: string | null;
  posterPath?: string | null;
  networks?: RadarCompanySignal[] | null;
  productionCompanies?: RadarCompanySignal[] | null;
  watchProviders?: RadarCompanySignal[] | null;
  isCinemaBR?: boolean;
  isSeasonReturn?: boolean;
  isSeasonPremiere?: boolean;
  isFinale?: boolean;
};

export type RadarScoreSignal = {
  key: string;
  value: number;
};

export type RadarEditorialScoreResult = {
  score: number;
  signals: RadarScoreSignal[];
};

const DAY_MS = 86_400_000;

const PREMIUM_NAME_PATTERNS: Array<[RegExp, number, string]> = [
  [/\b(hbo|max|warner|wbd|new line)\b/i, 18, "premium:warner_hbo"],
  [/\ba24\b/i, 18, "premium:a24"],
  [/\b(apple tv|apple)\b/i, 18, "premium:apple"],
  [/\b(sony|columbia)\b/i, 14, "premium:sony"],
  [/\b(paramount|mtv|vh1|cbs)\b/i, 14, "premium:paramount"],
  [/\b(netflix)\b/i, 14, "premium:netflix"],
  [/\b(prime video|amazon mgm|amazon)\b/i, 12, "premium:amazon"],
  [/\b(disney|fx|hulu|searchlight)\b/i, 14, "premium:disney_fx"],
  [/\b(universal|focus features|nbcuniversal|bravo|peacock)\b/i, 12, "premium:nbcu"],
  [/\b(mubi|neon)\b/i, 14, "premium:arthouse"],
  [/\b(bbc|bbc studios|channel 4|itv)\b/i, 12, "premium:uk_tv"],
  [/\b(fremantle|banijay|endemol|world of wonder)\b/i, 15, "premium:format_producer"],
];

function add(signals: RadarScoreSignal[], key: string, value: number) {
  if (value <= 0) return;
  signals.push({ key, value });
}

function daysFromToday(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const event = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((event.getTime() - today.getTime()) / DAY_MS);
}

function maxPremiumSignal(items: RadarCompanySignal[] | null | undefined): RadarScoreSignal | null {
  let best: RadarScoreSignal | null = null;
  for (const item of items ?? []) {
    const name = item.name ?? "";
    for (const [pattern, value, key] of PREMIUM_NAME_PATTERNS) {
      if (!pattern.test(name)) continue;
      if (!best || value > best.value) best = { key, value };
    }
  }
  return best;
}

export function computeGlobalEditorialScore(
  input: RadarEditorialSignalInput,
): RadarEditorialScoreResult {
  const signals: RadarScoreSignal[] = [];
  const days = daysFromToday(input.eventDate);

  if (days != null) {
    add(signals, "event:dated", 20);
    if (days === 0) add(signals, "event:today", 25);
    else if (days < 0 && days >= -7) add(signals, "event:recent_7d", 15);
    else if (days > 0 && days <= 30) add(signals, "event:next_30d", 15);
  }

  if (input.isCinemaBR) add(signals, "event:cinema_br", 20);
  if (input.isSeasonReturn) add(signals, "event:season_return", 15);
  if (input.isSeasonPremiere) add(signals, "event:season_premiere", 15);
  if (input.isFinale) add(signals, "event:finale", 10);

  const popularity = input.popularity ?? 0;
  add(signals, "popularity", Math.min(15, Math.round(Math.log2(Math.max(1, popularity)) * 2)));

  const voteCount = input.voteCount ?? 0;
  if (voteCount >= 500) add(signals, "vote_count:high", 10);
  else if (voteCount >= 100) add(signals, "vote_count:medium", 7);
  else if (voteCount >= 20) add(signals, "vote_count:low", 4);

  const voteAverage = input.voteAverage ?? 0;
  if (voteAverage >= 8) add(signals, "vote_average:strong", 10);
  else if (voteAverage >= 7) add(signals, "vote_average:good", 7);
  else if (voteAverage >= 6.3) add(signals, "vote_average:ok", 4);

  if (input.backdropPath || input.posterPath) add(signals, "image", 5);

  const networkSignal = maxPremiumSignal(input.networks);
  if (networkSignal) add(signals, `network:${networkSignal.key}`, networkSignal.value);

  const companySignal = maxPremiumSignal(input.productionCompanies);
  if (companySignal) add(signals, `studio:${companySignal.key}`, Math.min(15, companySignal.value));

  const providerSignal = maxPremiumSignal(input.watchProviders);
  if (providerSignal) add(signals, `platform:${providerSignal.key}`, Math.min(15, providerSignal.value));

  const lang = input.originalLanguage ?? "";
  const countries = input.originCountry ?? [];
  if (lang === "pt" || countries.includes("BR")) add(signals, "origin:br_pt", 15);
  else if (lang === "en") add(signals, "origin:en", 10);

  return {
    score: signals.reduce((sum, signal) => sum + signal.value, 0),
    signals,
  };
}

export function formatScoreSignals(signals: RadarScoreSignal[]): string {
  return signals.map((signal) => `${signal.key}:+${signal.value}`).join(",");
}
