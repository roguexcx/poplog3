import assert from "node:assert/strict";

import type { TitleProvider, TitleProviderType } from "@/features/title/types";
import { deriveStatus, groupProviders, pickBestProvider } from "@/server/availability/normalize-providers";
import { mapJustWatchMonetizationForProvider } from "@/server/streaming/justwatch-graphql-unofficial-source";
import {
  dedupeTitleProviders,
  normalizeTitleProvider,
  rankTitleProviders,
} from "@/server/streaming/provider-normalization";
import { mergeChannelOffers } from "@/server/streaming/provider-channel-enrichment";

type Fixture = {
  label: string;
  rawName: string;
  type: TitleProviderType;
  expectedName?: string;
  rootKey: string;
  variantKey: string;
  accessKind: NonNullable<TitleProvider["accessKind"]>;
  familyKey: string;
  group: "subscription" | "channel" | "rent" | "buy" | "free" | "ads";
};

function provider(name: string, type: TitleProviderType = "streaming"): TitleProvider {
  return {
    name,
    originalName: name,
    logoUrl: null,
    type,
    source: "justwatch_fixture",
  };
}

function fixtureProvider(fixture: Fixture) {
  return normalizeTitleProvider(provider(fixture.rawName, fixture.type));
}

function assertProviderFixture(fixture: Fixture) {
  const normalized = fixtureProvider(fixture);
  assert.equal(normalized.rootKey, fixture.rootKey, `${fixture.label}: rootKey`);
  assert.equal(normalized.variantKey, fixture.variantKey, `${fixture.label}: variantKey`);
  assert.equal(normalized.accessKind, fixture.accessKind, `${fixture.label}: accessKind`);
  assert.equal(normalized.familyKey, fixture.familyKey, `${fixture.label}: familyKey`);
  if (fixture.expectedName) assert.equal(normalized.name, fixture.expectedName, `${fixture.label}: display name`);
}

function commercialGroup(item: TitleProvider): Fixture["group"] {
  if (item.accessKind === "partner_channel") return "channel";
  if (item.type === "rent") return "rent";
  if (item.type === "buy") return "buy";
  if (item.type === "free") return "free";
  if (item.type === "ads") return "ads";
  return "subscription";
}

function countByGroup(providers: TitleProvider[]) {
  return providers.reduce<Record<Fixture["group"], number>>((acc, item) => {
    acc[commercialGroup(item)] += 1;
    return acc;
  }, {
    subscription: 0,
    channel: 0,
    rent: 0,
    buy: 0,
    free: 0,
    ads: 0,
  });
}

const PROVIDER_FIXTURES: Fixture[] = [
  {
    label: "Netflix assinatura principal",
    rawName: "Netflix",
    type: "streaming",
    rootKey: "netflix",
    variantKey: "direct",
    accessKind: "included",
    familyKey: "netflix",
    group: "subscription",
  },
  {
    label: "Netflix com anuncios",
    rawName: "Netflix Standard with Ads",
    type: "ads",
    rootKey: "netflix",
    variantKey: "ads",
    accessKind: "ads",
    familyKey: "netflix",
    group: "ads",
  },
  {
    label: "Prime Video incluso",
    rawName: "Amazon Prime Video",
    type: "streaming",
    expectedName: "Prime Video",
    rootKey: "prime-video",
    variantKey: "direct",
    accessKind: "included",
    familyKey: "prime-video",
    group: "subscription",
  },
  {
    label: "Prime Video aluguel",
    rawName: "Amazon Video",
    type: "rent",
    expectedName: "Prime Video aluguel",
    rootKey: "prime-video",
    variantKey: "rent",
    accessKind: "rent",
    familyKey: "prime-video",
    group: "rent",
  },
  {
    label: "Prime Video compra",
    rawName: "Amazon Video",
    type: "buy",
    expectedName: "Prime Video compra",
    rootKey: "prime-video",
    variantKey: "buy",
    accessKind: "buy",
    familyKey: "prime-video",
    group: "buy",
  },
  {
    label: "HBO Max legado",
    rawName: "HBO Max",
    type: "streaming",
    expectedName: "HBO MAX",
    rootKey: "max",
    variantKey: "direct",
    accessKind: "included",
    familyKey: "max",
    group: "subscription",
  },
  {
    label: "Max atual",
    rawName: "Max",
    type: "streaming",
    expectedName: "HBO MAX",
    rootKey: "max",
    variantKey: "direct",
    accessKind: "included",
    familyKey: "max",
    group: "subscription",
  },
  {
    label: "Max via Prime Video Channel",
    rawName: "Max Amazon Channel",
    type: "streaming",
    expectedName: "HBO MAX via Prime Video",
    rootKey: "max",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
  {
    label: "Disney+ assinatura principal",
    rawName: "Disney Plus",
    type: "streaming",
    expectedName: "Disney+",
    rootKey: "disney-plus",
    variantKey: "direct",
    accessKind: "included",
    familyKey: "disney-plus",
    group: "subscription",
  },
  {
    label: "Globoplay assinatura principal",
    rawName: "Globoplay",
    type: "streaming",
    rootKey: "globoplay",
    variantKey: "direct",
    accessKind: "included",
    familyKey: "globoplay",
    group: "subscription",
  },
  {
    label: "Globoplay via Prime Video Channel",
    rawName: "Globoplay Amazon Channel",
    type: "streaming",
    expectedName: "Globoplay via Prime Video",
    rootKey: "globoplay",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
  {
    label: "Apple TV+ assinatura principal",
    rawName: "Apple TV",
    type: "streaming",
    expectedName: "Apple TV+",
    rootKey: "apple-tv-plus",
    variantKey: "direct",
    accessKind: "included",
    familyKey: "apple-tv-plus",
    group: "subscription",
  },
  {
    label: "Apple TV Store aluguel",
    rawName: "Apple TV",
    type: "rent",
    expectedName: "Apple TV aluguel",
    rootKey: "apple-tv-store",
    variantKey: "rent",
    accessKind: "rent",
    familyKey: "apple-tv-store",
    group: "rent",
  },
  {
    label: "Apple TV Store compra",
    rawName: "AppleTV",
    type: "buy",
    expectedName: "Apple TV compra",
    rootKey: "apple-tv-store",
    variantKey: "buy",
    accessKind: "buy",
    familyKey: "apple-tv-store",
    group: "buy",
  },
  {
    label: "Apple TV+ via Prime Video Channel",
    rawName: "Apple TV Amazon Channel",
    type: "streaming",
    expectedName: "Apple TV+ via Prime Video",
    rootKey: "apple-tv-plus",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
  {
    label: "Claro Video assinatura",
    rawName: "Claro video",
    type: "streaming",
    expectedName: "Claro Video",
    rootKey: "claro-video",
    variantKey: "direct",
    accessKind: "included",
    familyKey: "claro-video",
    group: "subscription",
  },
  {
    label: "Claro Video aluguel",
    rawName: "Claro video",
    type: "rent",
    expectedName: "Claro Video aluguel",
    rootKey: "claro-video",
    variantKey: "rent",
    accessKind: "rent",
    familyKey: "claro-video",
    group: "rent",
  },
  {
    label: "Pluto TV gratis",
    rawName: "Pluto TV",
    type: "free",
    expectedName: "Pluto TV grátis",
    rootKey: "pluto-tv",
    variantKey: "free",
    accessKind: "free",
    familyKey: "pluto-tv",
    group: "free",
  },
  {
    label: "Diamond Films via Prime Video Channel",
    rawName: "Diamond Films Amazon Channel",
    type: "streaming",
    expectedName: "Diamond Films via Prime Video",
    rootKey: "diamond-films",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
  {
    label: "Telecine via Prime Video Channel",
    rawName: "Telecine Amazon Channel",
    type: "streaming",
    expectedName: "Telecine via Prime Video",
    rootKey: "telecine",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
  {
    label: "MUBI via Prime Video Channel",
    rawName: "MUBI Amazon Channel",
    type: "streaming",
    expectedName: "MUBI via Prime Video",
    rootKey: "mubi",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
  {
    label: "Paramount+ via Prime Video Channel",
    rawName: "Paramount Plus Amazon Channel",
    type: "streaming",
    expectedName: "Paramount+ via Prime Video",
    rootKey: "paramount-plus",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
  {
    label: "MGM+ via Apple TV Channel",
    rawName: "MGM Plus Apple TV Channel",
    type: "streaming",
    expectedName: "MGM+ via Apple TV",
    rootKey: "mgm-plus",
    variantKey: "apple-tv-channel",
    accessKind: "partner_channel",
    familyKey: "apple-tv-plus",
    group: "channel",
  },
  {
    label: "Universal+ via Prime Video Channel",
    rawName: "Universal Plus Amazon Channel",
    type: "streaming",
    expectedName: "Universal+ via Prime Video",
    rootKey: "universal-plus",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
  {
    label: "Looke via Prime Video Channel",
    rawName: "Looke Amazon Channel",
    type: "streaming",
    expectedName: "Looke via Prime Video",
    rootKey: "looke",
    variantKey: "prime-video-channel",
    accessKind: "partner_channel",
    familyKey: "prime-video",
    group: "channel",
  },
];

for (const fixture of PROVIDER_FIXTURES) assertProviderFixture(fixture);

const normalizedFixtures = PROVIDER_FIXTURES.map(fixtureProvider);
const counts = countByGroup(normalizedFixtures);
assert.equal(counts.subscription >= 7, true, "matriz cobre assinaturas principais");
assert.equal(counts.channel >= 8, true, "matriz cobre canais adicionais");
assert.equal(counts.rent >= 3, true, "matriz cobre aluguel");
assert.equal(counts.buy >= 2, true, "matriz cobre compra");
assert.equal(counts.free >= 1, true, "matriz cobre gratis");
assert.equal(counts.ads >= 1, true, "matriz cobre anuncios");

const grouped = groupProviders(normalizedFixtures);
assert.equal(grouped.flatrate.some((item) => item.name === "Prime Video" && item.accessKind === "included"), true, "Prime Video incluso fica em assinatura principal");
assert.equal(grouped.flatrate.some((item) => item.name === "Diamond Films via Prime Video" && item.accessKind === "partner_channel"), true, "Prime Video Channels fica como canal adicional");
assert.equal(grouped.rent.some((item) => item.name === "Prime Video aluguel"), true, "Amazon Video aluguel nao vira assinatura");
assert.equal(grouped.buy.some((item) => item.name === "Prime Video compra"), true, "Amazon Video compra nao vira assinatura");
assert.equal(grouped.free.some((item) => item.name === "Pluto TV grátis"), true, "Gratis fica separado de assinatura");
assert.equal(grouped.ads.some((item) => item.name === "Netflix com anúncios"), true, "Anuncios fica separado de assinatura");

const dedupedMax = dedupeTitleProviders([
  provider("HBO Max"),
  provider("Max"),
  provider("Max Amazon Channel"),
]);
assert.equal(dedupedMax.length, 2, "HBO Max/Max colapsam, mas canal Max permanece separado");
assert.equal(dedupedMax.some((item) => item.variantKey === "direct"), true);
assert.equal(dedupedMax.some((item) => item.variantKey === "prime-video-channel"), true);

const appleTvOffers = dedupeTitleProviders([
  provider("Apple TV", "streaming"),
  provider("Apple TV", "rent"),
  provider("Apple TV", "buy"),
  provider("Apple TV Amazon Channel", "streaming"),
]);
assert.equal(appleTvOffers.length, 4, "Apple TV+, Store aluguel, Store compra e Channel sao ofertas diferentes");

const primeOnlyChannel = mergeChannelOffers(
  [provider("Amazon Prime Video")],
  [provider("Diamond Films Amazon Channel")],
);
assert.equal(primeOnlyChannel.replaced.includes("prime-video:direct:streaming"), true, "canal sem Prime incluso substitui host generico");
assert.equal(primeOnlyChannel.providers.some((item) => item.name === "Prime Video"), false, "Prime incluso removido quando era canal colapsado");
assert.equal(primeOnlyChannel.providers.some((item) => item.name === "Diamond Films via Prime Video"), true);

const primeIncludedAndChannel = mergeChannelOffers(
  [provider("Amazon Prime Video")],
  [provider("Amazon Prime Video"), provider("Diamond Films Amazon Channel")],
);
assert.equal(primeIncludedAndChannel.replaced.length, 0, "Prime incluso confirmado pelo JustWatch nao e removido");
assert.equal(primeIncludedAndChannel.providers.some((item) => item.name === "Prime Video"), true);
assert.equal(primeIncludedAndChannel.providers.some((item) => item.name === "Diamond Films via Prime Video"), true);

const primeStoreAndChannel = mergeChannelOffers(
  [provider("Amazon Video", "rent"), provider("Amazon Video", "buy")],
  [provider("Diamond Films Amazon Channel")],
);
assert.equal(primeStoreAndChannel.replaced.length, 0, "loja Prime Video nao e removida por canal");
assert.equal(primeStoreAndChannel.providers.some((item) => item.name === "Prime Video aluguel"), true);
assert.equal(primeStoreAndChannel.providers.some((item) => item.name === "Prime Video compra"), true);
assert.equal(primeStoreAndChannel.providers.some((item) => item.name === "Diamond Films via Prime Video"), true);

const preferredChannel = rankTitleProviders(
  [provider("HBO Max"), provider("Max Amazon Channel"), provider("Netflix")],
  [{ rootKey: "max", variantKey: "prime-video-channel", priorityOrder: 1 }],
);
assert.equal(preferredChannel[0].name, "HBO MAX via Prime Video", "preferencia por canal exato ganha de assinatura principal");
assert.equal(pickBestProvider(groupProviders(preferredChannel), true)?.name, "HBO MAX via Prime Video");

const preferredDirect = rankTitleProviders(
  [provider("HBO Max"), provider("Max Amazon Channel"), provider("Netflix")],
  [{ rootKey: "max", variantKey: "direct", priorityOrder: 1 }],
);
assert.equal(preferredDirect[0].name, "HBO MAX", "preferencia por assinatura principal ganha do canal");
assert.equal(pickBestProvider(groupProviders(preferredDirect), true)?.name, "HBO MAX");

assert.equal(mapJustWatchMonetizationForProvider("FLATRATE"), "streaming");
assert.equal(mapJustWatchMonetizationForProvider("FLATRATE_AND_BUY"), "streaming");
assert.equal(mapJustWatchMonetizationForProvider("RENT"), "rent");
assert.equal(mapJustWatchMonetizationForProvider("BUY"), "buy");
assert.equal(mapJustWatchMonetizationForProvider("ADS"), "ads");
assert.equal(mapJustWatchMonetizationForProvider("FREE"), "free");
assert.equal(mapJustWatchMonetizationForProvider("CINEMA"), null, "CINEMA nao vira provider comercial");
assert.equal(mapJustWatchMonetizationForProvider("UNKNOWN"), null);

const cinemaStatus = deriveStatus({ grouped: groupProviders([]), isInTheaters: true });
assert.equal(cinemaStatus.isInTheaters, true, "cinema aparece como status");
assert.equal(cinemaStatus.isUnavailable, false, "cinema nao e indisponivel");
assert.equal(cinemaStatus.isAvailableSomewhere, false, "cinema nao cria provider artificial");

const unavailableStatus = deriveStatus({ grouped: groupProviders([]) });
assert.equal(unavailableStatus.isUnavailable, true, "sem provider e sem cinema vira indisponivel");
assert.equal(pickBestProvider(groupProviders([])), null, "indisponivel nao tem bestProvider");

const futureStatus = deriveStatus({ grouped: groupProviders([]), isFutureRelease: true });
assert.equal(futureStatus.isFutureRelease, true, "lancamento futuro fica separado de indisponivel");
assert.equal(futureStatus.isUnavailable, false);

console.log("[smoke:providers:commercial-fixtures] ok", {
  fixtures: PROVIDER_FIXTURES.length,
  counts,
});
