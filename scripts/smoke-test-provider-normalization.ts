import assert from "node:assert/strict";

import type { TitleProvider } from "@/features/title/types";
import {
  dedupeTitleProviders,
  normalizeProvider,
  normalizeTitleProvider,
  rankTitleProviders,
} from "@/server/streaming/provider-normalization";
import {
  CANONICAL_PROVIDER_LOGOS,
  CANONICAL_PROVIDER_NAMES,
  getCanonicalProviderDisplayName,
} from "@/lib/streaming/provider-display";
import {
  hasChannelHostGeneric,
  mergeChannelOffers,
} from "@/server/streaming/provider-channel-enrichment";
import { groupProviders, pickBestProvider } from "@/server/availability/normalize-providers";

function provider(name: string, type: TitleProvider["type"] = "streaming"): TitleProvider {
  return { name, logoUrl: null, type, source: "balloonerismm" };
}

const legacyMax = normalizeProvider("HBO Max");
const currentMax = normalizeProvider("Max");
assert.equal(legacyMax?.rootKey, "max");
assert.equal(currentMax?.rootKey, "max");
assert.equal(legacyMax?.name, CANONICAL_PROVIDER_NAMES.max);

const maxChannel = normalizeProvider("Max Amazon Channel");
assert.equal(maxChannel?.rootKey, "max");
assert.equal(maxChannel?.familyKey, "prime-video");
assert.equal(maxChannel?.familyName, "Prime Video");
assert.equal(maxChannel?.variantKey, "prime-video-channel");
assert.equal(maxChannel?.accessKind, "partner_channel");
assert.equal(maxChannel?.name, `${CANONICAL_PROVIDER_NAMES.max} via Prime Video`);
assert.equal(normalizeProvider("HBO Max via Prime Video")?.variantKey, "prime-video-channel");

const diamondChannel = normalizeProvider("Diamond Films Amazon Channel");
assert.equal(diamondChannel?.rootKey, "diamond-films");
assert.equal(diamondChannel?.familyKey, "prime-video");
assert.equal(diamondChannel?.name, "Diamond Films via Prime Video");

const netflixAds = normalizeProvider("Netflix Standard with Ads");
assert.equal(netflixAds?.rootKey, "netflix");
assert.equal(netflixAds?.variantKey, "ads");

const unknown = normalizeProvider("Cinema da Esquina");
assert.equal(unknown?.rootKey, "cinema-da-esquina");
assert.equal(unknown?.originalName, "Cinema da Esquina");

const normalizedLegacy = normalizeTitleProvider(provider("HBO Max"));
assert.equal(normalizedLegacy.name, CANONICAL_PROVIDER_NAMES.max);
assert.equal(normalizedLegacy.originalName, "HBO Max");

const normalizedLegacyLogo = normalizeTitleProvider({
  name: "HBO Max",
  logoUrl: "https://m.media-amazon.com/images/M/legacy-hbo-max._V1_.jpg",
  type: "streaming",
});
assert.equal(normalizedLegacyLogo.name, CANONICAL_PROVIDER_NAMES.max);
assert.equal(normalizedLegacyLogo.logoUrl, CANONICAL_PROVIDER_LOGOS.max);

const normalizedMaxChannelLogo = normalizeTitleProvider({
  name: "Max Amazon Channel",
  logoUrl: "https://images.justwatch.com/icon/343788557/s100/amazonhbomax.png",
  type: "streaming",
});
assert.equal(normalizedMaxChannelLogo.name, `${CANONICAL_PROVIDER_NAMES.max} via Prime Video`);
assert.equal(normalizedMaxChannelLogo.logoUrl, CANONICAL_PROVIDER_LOGOS.maxPrimeChannel);
assert.equal(
  normalizeTitleProvider({
    name: "Netflix",
    logoUrl: "https://m.media-amazon.com/images/M/netflix-old._V1_.jpg",
    type: "streaming",
  }).logoUrl,
  CANONICAL_PROVIDER_LOGOS.netflix,
);
assert.equal(
  normalizeTitleProvider({ name: "Amazon Video", logoUrl: null, type: "rent" }).logoUrl,
  CANONICAL_PROVIDER_LOGOS.amazonVideoStore,
);
assert.equal(getCanonicalProviderDisplayName({ name: "Max" }), CANONICAL_PROVIDER_NAMES.max);

const appleTvPlus = normalizeProvider("Apple TV", null, "streaming");
assert.equal(appleTvPlus?.rootKey, "apple-tv-plus");
assert.equal(appleTvPlus?.name, "Apple TV+");
assert.equal(appleTvPlus?.accessKind, "included");

const appleTvPlusExplicit = normalizeProvider("Apple TV Plus");
assert.equal(appleTvPlusExplicit?.rootKey, "apple-tv-plus");
assert.equal(appleTvPlusExplicit?.name, "Apple TV+");
assert.equal(appleTvPlusExplicit?.logoPath, CANONICAL_PROVIDER_LOGOS.appleTvPlus);

const appleTvStoreRent = normalizeProvider("Apple TV", null, "rent");
assert.equal(appleTvStoreRent?.rootKey, "apple-tv-store");
assert.equal(appleTvStoreRent?.name, "Apple TV aluguel");
assert.equal(appleTvStoreRent?.variantKey, "rent");
assert.equal(appleTvStoreRent?.accessKind, "rent");
assert.equal(appleTvStoreRent?.logoPath, CANONICAL_PROVIDER_LOGOS.appleTvStore);

const appleTvStoreBuy = normalizeProvider("AppleTV", null, "buy");
assert.equal(appleTvStoreBuy?.rootKey, "apple-tv-store");
assert.equal(appleTvStoreBuy?.name, "Apple TV compra");
assert.equal(appleTvStoreBuy?.variantKey, "buy");

const appleTvStoreGeneric = normalizeProvider("Apple TV Store");
assert.equal(appleTvStoreGeneric?.rootKey, "apple-tv-store");
assert.equal(appleTvStoreGeneric?.name, "Apple TV aluguel/compra");

const appleTvPrimeChannel = normalizeTitleProvider({
  name: "Apple TV Amazon Channel",
  logoUrl: "https://images.justwatch.com/icon/338254390/s100/amazonappletvplus.png",
  type: "streaming",
});
assert.equal(appleTvPrimeChannel.rootKey, "apple-tv-plus");
assert.equal(appleTvPrimeChannel.variantKey, "prime-video-channel");
assert.equal(appleTvPrimeChannel.name, "Apple TV+ via Prime Video");
assert.equal(appleTvPrimeChannel.logoUrl, CANONICAL_PROVIDER_LOGOS.appleTvPrimeChannel);

const aliases = dedupeTitleProviders([provider("HBO Max"), provider("Max")]);
assert.equal(aliases.length, 1);
assert.equal(aliases[0].name, CANONICAL_PROVIDER_NAMES.max);

const appleOffers = dedupeTitleProviders([
  provider("Apple TV", "streaming"),
  provider("Apple TV", "rent"),
  provider("Apple TV", "buy"),
]);
assert.equal(appleOffers.length, 3, "Apple TV+ e Apple TV Store não podem ser unificados");
assert.equal(appleOffers.some((item) => item.rootKey === "apple-tv-plus" && item.type === "streaming"), true);
assert.equal(appleOffers.some((item) => item.rootKey === "apple-tv-store" && item.type === "rent"), true);
assert.equal(appleOffers.some((item) => item.rootKey === "apple-tv-store" && item.type === "buy"), true);

const commercialOffers = dedupeTitleProviders([
  provider("Amazon Video", "rent"),
  provider("Amazon Video", "buy"),
]);
assert.equal(commercialOffers.length, 2, "aluguel e compra não podem ser colapsados");

const ranked = rankTitleProviders(
  [provider("Netflix"), provider("Max"), provider("Max Amazon Channel")],
  [{ rootKey: "max", variantKey: "prime-video-channel", priorityOrder: 1 }],
);
assert.equal(ranked[0].name, `${CANONICAL_PROVIDER_NAMES.max} via Prime Video`);
assert.equal(ranked[0].isPreferred, true);
assert.equal(ranked[0].isExactPreference, true);
assert.equal(ranked[1].name, CANONICAL_PROVIDER_NAMES.max);
assert.equal(ranked[2].name, "Netflix");
assert.equal(pickBestProvider(groupProviders(ranked), true)?.name, `${CANONICAL_PROVIDER_NAMES.max} via Prime Video`);

const defaultOffers = rankTitleProviders([
  provider("Google Play Movies", "rent"),
  provider("MUBI", "streaming"),
]);
assert.equal(pickBestProvider(groupProviders(defaultOffers))?.name, "MUBI");

const wolfBase = [
  provider("Amazon Prime Video"),
  provider("Amazon Video", "rent"),
  provider("Amazon Video", "buy"),
];
const wolfJustWatch = [
  provider("Diamond Films Amazon Channel"),
  provider("Amazon Video", "rent"),
  provider("Amazon Video", "buy"),
];
assert.equal(hasChannelHostGeneric(wolfBase), true);
assert.equal(hasChannelHostGeneric([provider("Amazon Video", "rent"), provider("Amazon Video", "buy")]), false);
const wolfMerged = mergeChannelOffers(wolfBase, wolfJustWatch);
const wolfNames = wolfMerged.providers.map((item) => `${item.name}|${item.type}`);
assert.equal(wolfNames.includes("Prime Video|streaming"), false);
assert.equal(wolfNames.includes("Diamond Films via Prime Video|streaming"), true);
assert.equal(wolfNames.includes("Prime Video aluguel|rent"), true);
assert.equal(wolfNames.includes("Prime Video compra|buy"), true);
assert.deepEqual(wolfMerged.replaced, ["prime-video:direct:streaming"]);

const primeAndChannel = mergeChannelOffers(
  [provider("Amazon Prime Video")],
  [provider("Amazon Prime Video"), provider("MUBI Amazon Channel")],
);
const primeAndChannelNames = primeAndChannel.providers.map((item) => `${item.name}|${item.type}`);
assert.equal(primeAndChannelNames.includes("Prime Video|streaming"), true);
assert.equal(primeAndChannelNames.includes("MUBI via Prime Video|streaming"), true);
assert.equal(primeAndChannel.replaced.length, 0);

console.log("[smoke:provider-normalization] ok");
