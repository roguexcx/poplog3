/**
 * Normalização de nomes de redes de TV para slugs URL-safe.
 *
 * Mantém um mapa de aliases conhecidos para garantir que variações do mesmo
 * nome (ex: "HBO Max", "Max") resultem no mesmo slug canônico.
 */

export type NormalizedNetwork = {
  name: string;
  slug: string;
  country?: string;
};

/** Aliases manuais: qualquer variante → slug canônico */
const CANONICAL_ALIASES: Record<string, string> = {
  // HBO / Max
  "hbo": "hbo",
  "hbo max": "hbo",
  "max": "hbo",
  "hbo hd": "hbo",
  // Netflix
  "netflix": "netflix",
  // Prime Video
  "amazon prime video": "prime-video",
  "amazon prime": "prime-video",
  "prime video": "prime-video",
  "amazon video": "prime-video",
  // Disney+
  "disney+": "disney-plus",
  "disney plus": "disney-plus",
  "disneyplus": "disney-plus",
  "disney+ hotstar": "disney-plus",
  // Apple TV+
  "apple tv+": "apple-tv-plus",
  "apple tv plus": "apple-tv-plus",
  "appletv+": "apple-tv-plus",
  // Hulu
  "hulu": "hulu",
  // Peacock
  "peacock": "peacock",
  // Paramount+
  "paramount+": "paramount-plus",
  "paramount plus": "paramount-plus",
  "paramount network": "paramount-network",
  // AMC
  "amc": "amc",
  "amc+": "amc-plus",
  "amc plus": "amc-plus",
  // FX / FX Networks
  "fx": "fx",
  "fxx": "fxx",
  "fx networks": "fx",
  // Showtime
  "showtime": "showtime",
  // Starz
  "starz": "starz",
  // Epix
  "epix": "epix",
  "mgm+": "mgm-plus",
  // BBC
  "bbc one": "bbc-one",
  "bbc two": "bbc-two",
  "bbc three": "bbc-three",
  "bbc four": "bbc-four",
  "bbc america": "bbc-america",
  "bbc": "bbc-one",
  // ITV
  "itv": "itv",
  "itv1": "itv",
  "itvx": "itv",
  // Channel 4 / E4
  "channel 4": "channel-4",
  "e4": "e4",
  "all 4": "channel-4",
  // Sky
  "sky atlantic": "sky-atlantic",
  "sky one": "sky-one",
  "sky": "sky",
  // NBC
  "nbc": "nbc",
  // CBS
  "cbs": "cbs",
  // ABC
  "abc": "abc",
  // FOX
  "fox": "fox",
  // The CW
  "the cw": "the-cw",
  "cw": "the-cw",
  // USA Network
  "usa network": "usa-network",
  "usa": "usa-network",
  // TNT
  "tnt": "tnt",
  // TBS
  "tbs": "tbs",
  // Adult Swim
  "adult swim": "adult-swim",
  // Cartoon Network
  "cartoon network": "cartoon-network",
  // Syfy
  "syfy": "syfy",
  "sci fi": "syfy",
  // Bravo
  "bravo": "bravo",
  // A&E
  "a&e": "a-and-e",
  "ae": "a-and-e",
  // History
  "history": "history",
  "history channel": "history",
  // National Geographic
  "national geographic": "national-geographic",
  "nat geo": "national-geographic",
  "natgeo": "national-geographic",
  // Discovery
  "discovery": "discovery",
  "discovery channel": "discovery",
  // Netflix BR / regional
  "netflix brasil": "netflix",
  // Globo
  "tv globo": "tv-globo",
  "globo": "tv-globo",
  "globoplay": "globoplay",
  // Record
  "record tv": "record-tv",
  "record": "record-tv",
  // SBT
  "sbt": "sbt",
  // Band
  "band": "band",
  "tv bandeirantes": "band",
};

/** Converte um nome de rede para slug URL-safe por algoritmo (fallback). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // remove diacríticos
    .replace(/&/g, "and")
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normaliza um nome de rede para um slug canônico.
 * Usa o mapa de aliases antes de cair no algoritmo genérico.
 */
export function normalizeNetworkSlug(name: string): string {
  const key = name.toLowerCase().trim();
  return CANONICAL_ALIASES[key] ?? slugify(name);
}

/** Constrói um NormalizedNetwork a partir de nome e país opcionais. */
export function buildNormalizedNetwork(
  name: string,
  country?: string | null,
): NormalizedNetwork {
  return {
    name,
    slug: normalizeNetworkSlug(name),
    country: country ?? undefined,
  };
}

/** Exibe o nome canônico "legível" de uma rede a partir do seu slug. */
export function networkDisplayName(slug: string): string {
  const DISPLAY_NAMES: Record<string, string> = {
    "hbo": "HBO",
    "netflix": "Netflix",
    "prime-video": "Prime Video",
    "disney-plus": "Disney+",
    "apple-tv-plus": "Apple TV+",
    "hulu": "Hulu",
    "peacock": "Peacock",
    "paramount-plus": "Paramount+",
    "paramount-network": "Paramount Network",
    "amc": "AMC",
    "amc-plus": "AMC+",
    "fx": "FX",
    "fxx": "FXX",
    "showtime": "Showtime",
    "starz": "Starz",
    "epix": "Epix",
    "mgm-plus": "MGM+",
    "bbc-one": "BBC One",
    "bbc-two": "BBC Two",
    "bbc-three": "BBC Three",
    "bbc-four": "BBC Four",
    "bbc-america": "BBC America",
    "itv": "ITV",
    "channel-4": "Channel 4",
    "e4": "E4",
    "sky-atlantic": "Sky Atlantic",
    "sky-one": "Sky One",
    "sky": "Sky",
    "nbc": "NBC",
    "cbs": "CBS",
    "abc": "ABC",
    "fox": "FOX",
    "the-cw": "The CW",
    "usa-network": "USA Network",
    "tnt": "TNT",
    "tbs": "TBS",
    "adult-swim": "Adult Swim",
    "cartoon-network": "Cartoon Network",
    "syfy": "Syfy",
    "bravo": "Bravo",
    "a-and-e": "A&E",
    "history": "History",
    "national-geographic": "National Geographic",
    "discovery": "Discovery",
    "tv-globo": "TV Globo",
    "globoplay": "Globoplay",
    "record-tv": "Record TV",
    "sbt": "SBT",
    "band": "Band",
  };

  return DISPLAY_NAMES[slug] ?? slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
