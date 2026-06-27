import assert from "node:assert/strict";

import { resolveCatalogLocalization } from "@/lib/i18n/catalog-localization";

const bilingual = {
  localizations: [
    { language: "pt-BR", title: "A Origem", overview: "Sinopse PT", tagline: "PT" },
    { language: "en-US", title: "Inception", overview: "EN synopsis", tagline: "EN" },
  ],
};

let resolved = resolveCatalogLocalization(bilingual, "pt-BR");
assert.equal(resolved.title, "A Origem");
assert.equal(resolved.overview, "Sinopse PT");
assert.equal(resolved.language, "pt-BR");
assert.equal(resolved.requestedLanguage, "pt-BR");
assert.equal(resolved.fallbackUsed, false);
assert.equal(resolved.fallbackLanguage, null);

resolved = resolveCatalogLocalization(bilingual, "en-US");
assert.equal(resolved.title, "Inception");
assert.equal(resolved.overview, "EN synopsis");
assert.equal(resolved.language, "en-US");
assert.equal(resolved.fallbackUsed, false);

resolved = resolveCatalogLocalization(
  {
    title: "Legacy PT",
    overview: "Legacy overview",
    localizations: [{ language: "en-US", title: "Severance", overview: "EN" }],
  },
  "pt-BR",
);
assert.equal(resolved.title, "Severance");
assert.equal(resolved.overview, "EN");
assert.equal(resolved.language, "en-US");
assert.equal(resolved.requestedLanguage, "pt-BR");
assert.equal(resolved.fallbackUsed, true);
assert.equal(resolved.fallbackLanguage, "en-US");

resolved = resolveCatalogLocalization(
  {
    title: "Only existing",
    overview: "Legacy fallback",
    localizations: [{ language: "pt-BR", title: "So PT", overview: "PT" }],
  },
  "en-US",
);
assert.equal(resolved.title, "So PT");
assert.equal(resolved.language, "pt-BR");
assert.equal(resolved.requestedLanguage, "en-US");
assert.equal(resolved.fallbackUsed, true);
assert.equal(resolved.fallbackLanguage, "pt-BR");

resolved = resolveCatalogLocalization(
  {
    title: "Legacy Title",
    overview: "Legacy Overview",
    tagline: "Legacy Tagline",
  },
  "en-US",
);
assert.equal(resolved.title, "Legacy Title");
assert.equal(resolved.overview, "Legacy Overview");
assert.equal(resolved.tagline, "Legacy Tagline");
assert.equal(resolved.language, "en-US");
assert.equal(resolved.fallbackUsed, false);

console.log("[smoke:catalog-localization] ok");
