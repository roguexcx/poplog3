import { resolveForRender } from "@/lib/images/proxy";

export const CANONICAL_PROVIDER_NAMES = {
  max: "HBO MAX",
} as const;

export const CANONICAL_PROVIDER_LOGOS = {
  max: "https://images.justwatch.com/icon/332884837/s100/max.png",
  netflix: "https://images.justwatch.com/icon/207360008/s100/netflix.png",
  netflixAds: "https://images.justwatch.com/icon/330025803/s100/netflixbasicwithads.png",
  primeVideo: "https://images.justwatch.com/icon/322992749/s100/amazonprimevideo.png",
  primeVideoAds: "https://images.justwatch.com/icon/322992746/s100/amazonprimevideowithads.png",
  amazonVideoStore: "https://images.justwatch.com/icon/340823436/s100/amazon.png",
  disneyPlus: "https://images.justwatch.com/icon/313118777/s100/disneyplus.png",
  appleTvPlus: "https://images.justwatch.com/icon/338367329/s100/appletvplus.jpeg",
  appleTvPrimeChannel: "https://images.justwatch.com/icon/338254390/s100/amazonappletvplus.png",
  appleTvStore: "https://images.justwatch.com/icon/338253243/s100/itunes.png",
  globoplay: "https://images.justwatch.com/icon/270278212/s100/globoplay.png",
  paramountPlus: "https://images.justwatch.com/icon/242706661/s100/paramountplus.png",
  paramountPrimeChannel: "https://images.justwatch.com/icon/246478651/s100/amazonparamountplus.png",
  paramountAppleChannel: "https://images.justwatch.com/icon/303391391/s100/appletvparamountplus.png",
  crunchyroll: "https://images.justwatch.com/icon/324213205/s100/crunchyroll.png",
  mubi: "https://images.justwatch.com/icon/164970114/s100/mubi.png",
  mubiPrimeChannel: "https://images.justwatch.com/icon/241732473/s100/amazonmubi.png",
  plutoTv: "https://images.justwatch.com/icon/312204955/s100/plutotv.png",
  netmovies: "https://images.justwatch.com/icon/446738/s100/netmovies.png",
  claroVideo: "https://images.justwatch.com/icon/9899714/s100/clarovideo.png",
  universalPrimeChannel: "https://images.justwatch.com/icon/304872009/s100/amazonuniversalplus.png",
  telecinePrimeChannel: "https://images.justwatch.com/icon/318069566/s100/amazontelecine.png",
  maxPrimeChannel: "https://images.justwatch.com/icon/343788557/s100/amazonhbomax.png",
  mgmPrimeChannel: "https://images.justwatch.com/icon/302467404/s100/amazonmgmplus.png",
  mgmAppleChannel: "https://images.justwatch.com/icon/313376726/s100/appletvmgmplus.png",
  diamondPrimeChannel: "https://images.justwatch.com/icon/339010714/s100/amazondiamondfilms.png",
  looke: "https://images.justwatch.com/icon/755940/s100/looke.png",
  lookePrimeChannel: "https://images.justwatch.com/icon/259251955/s100/amazonlooke.png",
} as const;

const LOGO_BY_PROVIDER_IDENTITY: Record<string, string> = {
  "netflix": CANONICAL_PROVIDER_LOGOS.netflix,
  "netflix:ads": CANONICAL_PROVIDER_LOGOS.netflixAds,
  "prime-video": CANONICAL_PROVIDER_LOGOS.primeVideo,
  "prime-video:ads": CANONICAL_PROVIDER_LOGOS.primeVideoAds,
  "prime-video:rent": CANONICAL_PROVIDER_LOGOS.amazonVideoStore,
  "prime-video:buy": CANONICAL_PROVIDER_LOGOS.amazonVideoStore,
  "prime-video:rent-buy": CANONICAL_PROVIDER_LOGOS.amazonVideoStore,
  "disney-plus": CANONICAL_PROVIDER_LOGOS.disneyPlus,
  "apple-tv-plus": CANONICAL_PROVIDER_LOGOS.appleTvPlus,
  "apple-tv-plus:prime-video-channel": CANONICAL_PROVIDER_LOGOS.appleTvPrimeChannel,
  "apple-tv-store": CANONICAL_PROVIDER_LOGOS.appleTvStore,
  "apple-tv-store:rent": CANONICAL_PROVIDER_LOGOS.appleTvStore,
  "apple-tv-store:buy": CANONICAL_PROVIDER_LOGOS.appleTvStore,
  "apple-tv-store:rent-buy": CANONICAL_PROVIDER_LOGOS.appleTvStore,
  "max": CANONICAL_PROVIDER_LOGOS.max,
  "max:prime-video-channel": CANONICAL_PROVIDER_LOGOS.maxPrimeChannel,
  "globoplay": CANONICAL_PROVIDER_LOGOS.globoplay,
  "paramount-plus": CANONICAL_PROVIDER_LOGOS.paramountPlus,
  "paramount-plus:prime-video-channel": CANONICAL_PROVIDER_LOGOS.paramountPrimeChannel,
  "paramount-plus:apple-tv-channel": CANONICAL_PROVIDER_LOGOS.paramountAppleChannel,
  "crunchyroll": CANONICAL_PROVIDER_LOGOS.crunchyroll,
  "mubi": CANONICAL_PROVIDER_LOGOS.mubi,
  "mubi:prime-video-channel": CANONICAL_PROVIDER_LOGOS.mubiPrimeChannel,
  "telecine": CANONICAL_PROVIDER_LOGOS.telecinePrimeChannel,
  "telecine:prime-video-channel": CANONICAL_PROVIDER_LOGOS.telecinePrimeChannel,
  "pluto-tv": CANONICAL_PROVIDER_LOGOS.plutoTv,
  "netmovies": CANONICAL_PROVIDER_LOGOS.netmovies,
  "claro-video": CANONICAL_PROVIDER_LOGOS.claroVideo,
  "universal-plus": CANONICAL_PROVIDER_LOGOS.universalPrimeChannel,
  "universal-plus:prime-video-channel": CANONICAL_PROVIDER_LOGOS.universalPrimeChannel,
  "mgm-plus:prime-video-channel": CANONICAL_PROVIDER_LOGOS.mgmPrimeChannel,
  "mgm-plus:apple-tv-channel": CANONICAL_PROVIDER_LOGOS.mgmAppleChannel,
  "diamond-films:prime-video-channel": CANONICAL_PROVIDER_LOGOS.diamondPrimeChannel,
  "looke": CANONICAL_PROVIDER_LOGOS.looke,
  "looke:prime-video-channel": CANONICAL_PROVIDER_LOGOS.lookePrimeChannel,
};

function isJustWatchProviderLogo(url: string | null | undefined): boolean {
  return /^https:\/\/images\.justwatch\.com\/icon\//i.test(url ?? "");
}

function normalizeProviderDisplayKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function inferDisplayRootKey(name: string | null | undefined): string | null {
  const key = normalizeProviderDisplayKey(name);
  if (key === "max" || key === "hbo max" || key.startsWith("max ") || key.startsWith("hbo max ")) {
    return "max";
  }
  if (key === "netflix" || key.startsWith("netflix ")) return "netflix";
  if (key === "prime video" || key.startsWith("prime video ") || key.startsWith("amazon prime video ")) {
    return "prime-video";
  }
  if (key === "disney+" || key === "disney plus" || key.startsWith("disney+ ") || key.startsWith("disney plus ")) {
    return "disney-plus";
  }
  if (
    key === "apple tv store" ||
    key === "appletv store" ||
    key === "itunes" ||
    key.startsWith("apple tv store ") ||
    key.startsWith("appletv store ") ||
    key.startsWith("itunes ") ||
    /^apple ?tv .*(aluguel|compra|rent|buy)/.test(key)
  ) {
    return "apple-tv-store";
  }
  if (
    key === "apple tv" ||
    key === "apple tv+" ||
    key === "appletv+" ||
    key === "apple tv plus" ||
    key === "appletv" ||
    key === "appletv plus" ||
    key.startsWith("apple tv+ ") ||
    key.startsWith("apple tv plus ") ||
    key.startsWith("appletv plus ")
  ) {
    return "apple-tv-plus";
  }
  if (key === "globoplay" || key.startsWith("globoplay ")) return "globoplay";
  if (key === "paramount+" || key === "paramount plus" || key.startsWith("paramount+ ") || key.startsWith("paramount plus ")) {
    return "paramount-plus";
  }
  if (key === "crunchyroll" || key.startsWith("crunchyroll ")) return "crunchyroll";
  if (key === "mubi" || key.startsWith("mubi ")) return "mubi";
  if (key === "telecine" || key.startsWith("telecine ")) return "telecine";
  if (key === "pluto tv" || key.startsWith("pluto tv ")) return "pluto-tv";
  if (key === "netmovies" || key.startsWith("netmovies ")) return "netmovies";
  if (key === "claro video" || key === "claro tv+" || key.startsWith("claro video ") || key.startsWith("claro tv+ ")) {
    return "claro-video";
  }
  if (key === "universal+" || key === "universal plus" || key.startsWith("universal+ ") || key.startsWith("universal plus ")) {
    return "universal-plus";
  }
  if (key === "looke" || key.startsWith("looke ")) return "looke";
  return null;
}

function inferDisplayVariantKey(name: string | null | undefined): string | null {
  const key = normalizeProviderDisplayKey(name);
  if (key.includes("via prime video") || key.includes("amazon channel")) return "prime-video-channel";
  if (key.includes("via apple tv") || key.includes("apple tv channel")) return "apple-tv-channel";
  if (key.includes("com anuncios") || key.includes("with ads")) return "ads";
  if (key.includes("aluguel/compra") || key.includes("rent/buy")) return "rent-buy";
  if (key.includes("aluguel") || key.includes("rent")) return "rent";
  if (key.includes("compra") || key.includes("buy")) return "buy";
  if (key.includes("gratis") || key.includes("free")) return "free";
  return null;
}

export function getCanonicalProviderLogoUrl(input: {
  rootKey?: string | null;
  variantKey?: string | null;
  name?: string | null;
  logoUrl?: string | null;
}): string | null {
  const rootKey = input.rootKey ?? inferDisplayRootKey(input.name);
  const variantKey = input.variantKey ?? inferDisplayVariantKey(input.name);
  if (rootKey && variantKey) {
    const variantLogo = LOGO_BY_PROVIDER_IDENTITY[`${rootKey}:${variantKey}`];
    if (variantLogo) return variantLogo;
  }
  if (variantKey?.endsWith("-channel") && isJustWatchProviderLogo(input.logoUrl)) {
    return input.logoUrl ?? null;
  }
  if (rootKey) {
    const rootLogo = LOGO_BY_PROVIDER_IDENTITY[rootKey];
    if (rootLogo) return rootLogo;
  }
  return input.logoUrl ?? null;
}

export function getCanonicalProviderDisplayName(input: {
  rootKey?: string | null;
  variantKey?: string | null;
  name?: string | null;
}): string | null {
  const rootKey = input.rootKey ?? inferDisplayRootKey(input.name);
  if (rootKey !== "max") return input.name ?? null;

  const variantKey = input.variantKey ?? inferDisplayVariantKey(input.name);
  switch (variantKey) {
    case "prime-video-channel":
      return `${CANONICAL_PROVIDER_NAMES.max} via Prime Video`;
    case "apple-tv-channel":
      return `${CANONICAL_PROVIDER_NAMES.max} via Apple TV`;
    case "ads":
      return `${CANONICAL_PROVIDER_NAMES.max} com anúncios`;
    case "rent":
      return `${CANONICAL_PROVIDER_NAMES.max} aluguel`;
    case "buy":
      return `${CANONICAL_PROVIDER_NAMES.max} compra`;
    case "rent-buy":
      return `${CANONICAL_PROVIDER_NAMES.max} aluguel/compra`;
    default:
      return CANONICAL_PROVIDER_NAMES.max;
  }
}

export function resolveProviderLogoForRender(
  input: {
    rootKey?: string | null;
    variantKey?: string | null;
    name?: string | null;
    logoUrl?: string | null;
  },
  size = "original",
): string | null {
  return resolveForRender(getCanonicalProviderLogoUrl(input), size);
}
