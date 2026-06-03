/**
 * Test suite for classifyRadarEligibility()
 *
 * Validates TWO groups:
 *   Group A — the 9 known problematic titles (must be blocked)
 *   Group B — fictional/new titles with the same metadata profile (must also be blocked)
 *   Group C — premium titles that must PASS through
 */

import { classifyRadarEligibility } from "../eligibility";
import type { EligibilityInput } from "../eligibility";

// ---------------------------------------------------------------------------
// Shared metadata profiles
// ---------------------------------------------------------------------------

const BBC_LOCAL_FACTUAL_PROFILE: Partial<EligibilityInput> = {
  category: "DOCUMENTARY",
  tmdbType: "Talk Show",
  genreIds: [99],
  originalLanguage: "en",
  originCountry: ["GB"],
  popularity: 15,
  voteCount: 120,
  voteAverage: 6.5,
  networks: [{ id: 4, name: "BBC One", origin_country: "GB" }],
  brazilProviders: [],
  hasTmdb: true,
};

const NICHE_KIDS_ANIMATION_PROFILE: Partial<EligibilityInput> = {
  category: "KIDS",
  tmdbType: "Scripted",
  genreIds: [16, 10751, 10762],
  originalLanguage: "en",
  originCountry: ["US"],
  popularity: 18,
  voteCount: 80,
  voteAverage: 6.2,
  networks: [{ id: 2103, name: "Disney Junior", origin_country: "US" }],
  brazilProviders: [],
  hasTmdb: true,
};

const RELIGIOUS_NICHE_PROFILE: Partial<EligibilityInput> = {
  category: "DOCUMENTARY",
  tmdbType: "Documentary",
  genreIds: [99],
  originalLanguage: "en",
  originCountry: ["US"],
  popularity: 5,
  voteCount: 30,
  voteAverage: 6.0,
  networks: [{ id: 13260, name: "TBN", origin_country: "US" }],
  brazilProviders: [],
  hasTmdb: true,
};

const KOREAN_SERIAL_NICHE_PROFILE: Partial<EligibilityInput> = {
  category: "SERIES",
  tmdbType: "Scripted",
  genreIds: [18],
  originalLanguage: "ko",
  originCountry: ["KR"],
  popularity: 20,
  voteCount: 150,
  voteAverage: 7.0,
  networks: [{ id: 99999, name: "KBS2", origin_country: "KR" }],
  brazilProviders: [],
  hasTmdb: true,
};

const LOCAL_REALITY_PROFILE: Partial<EligibilityInput> = {
  category: "REALITY",
  tmdbType: "Reality",
  genreIds: [10764],
  originalLanguage: "en",
  originCountry: ["US"],
  popularity: 12,
  voteCount: 90,
  voteAverage: 5.8,
  networks: [{ id: 1267, name: "HGTV", origin_country: "US" }],
  brazilProviders: [],
  hasTmdb: true,
};

const TURKISH_SERIAL_PROFILE: Partial<EligibilityInput> = {
  category: "SERIES",
  tmdbType: "Scripted",
  genreIds: [18],
  originalLanguage: "tr",
  originCountry: ["TR"],
  popularity: 25,
  voteCount: 130,
  voteAverage: 6.8,
  networks: [{ id: 88888, name: "TRT1", origin_country: "TR" }],
  brazilProviders: [],
  hasTmdb: true,
};

const LOCAL_LIFESTYLE_FACTUAL_PROFILE: Partial<EligibilityInput> = {
  category: "REALITY",
  tmdbType: "Reality",
  genreIds: [10764],
  originalLanguage: "en",
  originCountry: ["US"],
  popularity: 8,
  voteCount: 60,
  voteAverage: 5.5,
  networks: [{ id: 80, name: "Travel Channel", origin_country: "US" }],
  brazilProviders: [],
  hasTmdb: true,
};

const US_LOCAL_NICHE_NETWORK_PROFILE: Partial<EligibilityInput> = {
  category: "SERIES",
  tmdbType: "Scripted",
  genreIds: [35, 27],
  originalLanguage: "en",
  originCountry: ["US"],
  popularity: 22,
  voteCount: 110,
  voteAverage: 7.1,
  networks: [{ id: 1985, name: "MeTV", origin_country: "US" }],
  brazilProviders: [],
  hasTmdb: true,
};

const IBERO_LATAM_NICHE_PROFILE: Partial<EligibilityInput> = {
  category: "SERIES",
  tmdbType: "Scripted",
  genreIds: [18, 80],
  originalLanguage: "es",
  originCountry: ["MX"],
  popularity: 14,
  voteCount: 45,
  voteAverage: 6.8,
  networks: [{ id: 4445, name: "Canal de las Estrellas", origin_country: "MX" }],
  brazilProviders: [],
  hasTmdb: true,
};

// Grand Hotel: série ibero com votos altos mas sem rede global e sem provider BR
const IBERO_LATAM_LEGACY_PROFILE: Partial<EligibilityInput> = {
  category: "SERIES",
  tmdbType: "Scripted",
  genreIds: [18, 9648],
  originalLanguage: "es",
  originCountry: ["ES"],
  popularity: 45,
  voteCount: 800,
  voteAverage: 8.1,
  networks: [{ id: 101, name: "Antena 3", origin_country: "ES" }],
  brazilProviders: [],
  hasTmdb: true,
};

// Britain's Got Talent / Homestead Rescue: reality com pop alta mas sem provider BR
const REALITY_HIGH_POP_NO_BR_PROFILE: Partial<EligibilityInput> = {
  category: "REALITY",
  tmdbType: "Reality",
  genreIds: [10764],
  originalLanguage: "en",
  originCountry: ["GB"],
  popularity: 85,
  voteCount: 350,
  voteAverage: 6.1,
  networks: [{ id: 68, name: "ITV", origin_country: "GB" }],
  brazilProviders: [],
  hasTmdb: true,
};

const REALITY_DISCOVERY_NO_BR_PROFILE: Partial<EligibilityInput> = {
  category: "REALITY",
  tmdbType: "Reality",
  genreIds: [10764],
  originalLanguage: "en",
  originCountry: ["US"],
  popularity: 28,
  voteCount: 180,
  voteAverage: 6.8,
  networks: [{ id: 64, name: "Discovery Channel", origin_country: "US" }],
  brazilProviders: [],
  hasTmdb: true,
};

// ---------------------------------------------------------------------------
// GROUP A — Known problematic titles
// ---------------------------------------------------------------------------

console.log("\n═══ GROUP A — Títulos problemáticos conhecidos (devem ser BLOQUEADOS) ═══\n");

const groupA: Array<{ title: string; profile: Partial<EligibilityInput> }> = [
  { title: "Svengoolie",                        profile: LOCAL_REALITY_PROFILE },
  { title: "Svengoolie",                        profile: US_LOCAL_NICHE_NETWORK_PROFILE },
  { title: "Home Town: Inn This Together",      profile: LOCAL_LIFESTYLE_FACTUAL_PROFILE },
  { title: "Homestead Rescue",                  profile: REALITY_DISCOVERY_NO_BR_PROFILE },
  { title: "The Old Stories: Moses",            profile: RELIGIOUS_NICHE_PROFILE },
  { title: "Sofia the First: Royal Magic",      profile: NICHE_KIDS_ANIMATION_PROFILE },
  { title: "Princesinha Sofia: Realeza Magica", profile: NICHE_KIDS_ANIMATION_PROFILE },
  { title: "Britain's Got Talent",              profile: REALITY_HIGH_POP_NO_BR_PROFILE },
  { title: "Grand Hotel",                       profile: IBERO_LATAM_LEGACY_PROFILE },
  { title: "Great Continental Railway Journeys", profile: BBC_LOCAL_FACTUAL_PROFILE },
  { title: "Maine Cabin Masters",               profile: LOCAL_REALITY_PROFILE },
  { title: "Little Big Italy",                  profile: LOCAL_LIFESTYLE_FACTUAL_PROFILE },
  { title: "In the Eye of the Storm: Chasers",  profile: LOCAL_LIFESTYLE_FACTUAL_PROFILE },
  { title: "Lobo, morir matando",               profile: IBERO_LATAM_NICHE_PROFILE },
];

let failedA = 0;
for (const { title, profile } of groupA) {
  const input = { title, ...profile } as EligibilityInput;
  const result = classifyRadarEligibility(input);
  const isBlocked = !result.eligible;
  const icon = isBlocked ? "BLOQ" : "FALHOU";
  const suffix = isBlocked
    ? ` -> ${result.reason} [${result.signals.join(", ")}]`
    : " passou (deveria ser bloqueado!)";
  console.log(`  [${icon}]  "${title}"${suffix}`);
  if (!isBlocked) failedA++;
}

// ---------------------------------------------------------------------------
// GROUP B -- Fictional titles with same metadata profiles
// ---------------------------------------------------------------------------

console.log("\n=== GROUP B -- Titulos ficticios com mesmo perfil (devem ser BLOQUEADOS) ===\n");

const groupB: Array<{ title: string; profile: Partial<EligibilityInput>; expectedReason: string }> = [
  { title: "XYZ Local Niche Show 2025",         profile: LOCAL_REALITY_PROFILE,              expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Casa Nova Com Fulano",              profile: LOCAL_REALITY_PROFILE,              expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Random Travel Show Future 2026",    profile: LOCAL_LIFESTYLE_FACTUAL_PROFILE,    expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Descobrindo Regioes Perdidas",      profile: LOCAL_LIFESTYLE_FACTUAL_PROFILE,    expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "New Testament Chronicles 2026",     profile: RELIGIOUS_NICHE_PROFILE,            expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Vida de Fe Serie Especial",         profile: RELIGIOUS_NICHE_PROFILE,            expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Magical Pony Adventure Jr",         profile: NICHE_KIDS_ANIMATION_PROFILE,       expectedReason: "preschool_kids_explicit" },
  { title: "Super Kids Show Future",            profile: NICHE_KIDS_ANIMATION_PROFILE,       expectedReason: "preschool_kids_explicit" },
  { title: "BBC Local Heritage Walk 2026",      profile: BBC_LOCAL_FACTUAL_PROFILE,          expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "British Villages Explored",         profile: BBC_LOCAL_FACTUAL_PROFILE,          expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Novo Drama Coreano Niche",          profile: KOREAN_SERIAL_NICHE_PROFILE,        expectedReason: "hard_blocked_asian_serial" },
  { title: "Yeni Turk Dizisi 2026",             profile: TURKISH_SERIAL_PROFILE,             expectedReason: "hard_blocked_asian_serial" },
  { title: "Serie Mexicana Local 2026",         profile: IBERO_LATAM_NICHE_PROFILE,          expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Drama Colombiano Sin Netflix",      profile: IBERO_LATAM_NICHE_PROFILE,          expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Grand Hotel Espanha Clone",         profile: IBERO_LATAM_LEGACY_PROFILE,         expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Local Horror Host Show US",         profile: US_LOCAL_NICHE_NETWORK_PROFILE,     expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Syndication Show Niche Network",    profile: US_LOCAL_NICHE_NETWORK_PROFILE,     expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Got Talent Knockoff No BR",         profile: REALITY_HIGH_POP_NO_BR_PROFILE,     expectedReason: "hard_blocked_nonfiction_niche" },
  { title: "Homestead Clone Discovery",         profile: REALITY_DISCOVERY_NO_BR_PROFILE,    expectedReason: "hard_blocked_nonfiction_niche" },
];

let failedB = 0;
for (const { title, profile, expectedReason } of groupB) {
  const input = { title, ...profile } as EligibilityInput;
  const result = classifyRadarEligibility(input);
  const isBlocked = !result.eligible;
  const icon = isBlocked ? "BLOQ" : "FALHOU";
  const reasonMatch = result.reason === expectedReason ? "" : ` (esperado: ${expectedReason}, got: ${result.reason})`;
  const suffix = isBlocked
    ? ` -> ${result.reason}${reasonMatch} [${result.signals.join(", ")}]`
    : " passou (deveria ser bloqueado!)";
  console.log(`  [${icon}]  "${title}"${suffix}`);
  if (!isBlocked) failedB++;
}

// ---------------------------------------------------------------------------
// GROUP C -- Premium content that must PASS
// ---------------------------------------------------------------------------

console.log("\n=== GROUP C -- Conteudo premium (deve PASSAR) ===\n");

const groupC: Array<EligibilityInput> = [
  {
    title: "Breaking Bad", category: "SERIES", tmdbType: "Scripted",
    genreIds: [18, 80], originalLanguage: "en", originCountry: ["US"],
    popularity: 320, voteCount: 12000, voteAverage: 9.5,
    networks: [{ id: 174, name: "AMC", origin_country: "US" }],
    brazilProviders: ["Netflix"], hasTmdb: true,
  },
  {
    title: "Succession", category: "SERIES", tmdbType: "Scripted",
    genreIds: [18], originalLanguage: "en", originCountry: ["US"],
    popularity: 280, voteCount: 8000, voteAverage: 9.0,
    networks: [{ id: 49, name: "HBO", origin_country: "US" }],
    brazilProviders: ["Max"], hasTmdb: true,
  },
  {
    title: "Fleabag", category: "SERIES", tmdbType: "Scripted",
    genreIds: [35, 18], originalLanguage: "en", originCountry: ["GB"],
    popularity: 95, voteCount: 3200, voteAverage: 8.7,
    networks: [{ id: 4, name: "BBC Three", origin_country: "GB" }],
    brazilProviders: ["Prime Video"], hasTmdb: true,
  },
  {
    title: "Planet Earth III", category: "DOCUMENTARY", tmdbType: "Documentary",
    genreIds: [99], originalLanguage: "en", originCountry: ["GB"],
    popularity: 150, voteCount: 4500, voteAverage: 9.0,
    networks: [{ id: 4, name: "BBC One", origin_country: "GB" }],
    brazilProviders: ["Netflix"], hasTmdb: true,
  },
  {
    title: "Squid Game", category: "SERIES", tmdbType: "Scripted",
    genreIds: [18, 28], originalLanguage: "ko", originCountry: ["KR"],
    popularity: 420, voteCount: 15000, voteAverage: 8.0,
    networks: [{ id: 213, name: "Netflix", origin_country: "US" }],
    brazilProviders: ["Netflix"], hasTmdb: true,
  },
  {
    title: "Sherlock", category: "SERIES", tmdbType: "Scripted",
    genreIds: [18, 9648, 80], originalLanguage: "en", originCountry: ["GB"],
    popularity: 230, voteCount: 9000, voteAverage: 9.0,
    networks: [{ id: 4, name: "BBC One", origin_country: "GB" }],
    brazilProviders: ["Netflix"], hasTmdb: true,
  },
  {
    title: "Narcos", category: "SERIES", tmdbType: "Scripted",
    genreIds: [18, 80], originalLanguage: "en", originCountry: ["US"],
    popularity: 200, voteCount: 7000, voteAverage: 8.8,
    networks: [{ id: 213, name: "Netflix", origin_country: "US" }],
    brazilProviders: ["Netflix"], hasTmdb: true,
  },
  // Ibero-latam com sinal positivo -- devem passar
  {
    title: "La Casa de Papel", category: "SERIES", tmdbType: "Scripted",
    genreIds: [18, 80], originalLanguage: "es", originCountry: ["ES"],
    popularity: 310, voteCount: 12000, voteAverage: 8.2,
    networks: [{ id: 213, name: "Netflix", origin_country: "US" }],
    brazilProviders: ["Netflix"], hasTmdb: true,
  },
  {
    title: "El Ministerio del Tiempo", category: "SERIES", tmdbType: "Scripted",
    genreIds: [18, 10765], originalLanguage: "es", originCountry: ["ES"],
    popularity: 75, voteCount: 1200, voteAverage: 7.8,
    networks: [{ id: 99, name: "TVE1", origin_country: "ES" }],
    brazilProviders: [], hasTmdb: true,
  },
  // US nicho mas com rede global -- deve passar
  {
    title: "Dark Winds", category: "SERIES", tmdbType: "Scripted",
    genreIds: [18, 80], originalLanguage: "en", originCountry: ["US"],
    popularity: 35, voteCount: 400, voteAverage: 7.2,
    networks: [{ id: 174, name: "AMC", origin_country: "US" }],
    brazilProviders: [], hasTmdb: true,
  },
  // Reality com provider BR -- deve passar
  {
    title: "RuPaul's Drag Race", category: "REALITY", tmdbType: "Reality",
    genreIds: [10764], originalLanguage: "en", originCountry: ["US"],
    popularity: 95, voteCount: 2200, voteAverage: 7.8,
    networks: [{ id: 213, name: "Netflix", origin_country: "US" }],
    brazilProviders: ["Netflix"], hasTmdb: true,
  },
  {
    title: "Big Brother Brasil", category: "REALITY", tmdbType: "Reality",
    genreIds: [10764], originalLanguage: "pt", originCountry: ["BR"],
    popularity: 180, voteCount: 1500, voteAverage: 5.5,
    networks: [{ id: 65, name: "Globo", origin_country: "BR" }],
    brazilProviders: ["Globoplay"], hasTmdb: true,
  },
];

let failedC = 0;
for (const input of groupC) {
  const result = classifyRadarEligibility(input);
  const isPassing = result.eligible;
  const icon = isPassing ? "PASS" : "FALHOU";
  const suffix = isPassing
    ? " passou"
    : ` bloqueado: ${result.reason} [${result.signals.join(", ")}]`;
  console.log(`  [${icon}]  "${input.title}"${suffix}`);
  if (!isPassing) failedC++;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const totalFailed = failedA + failedB + failedC;
console.log(`
Result: ${totalFailed === 0 ? "TODOS OS TESTES PASSARAM" : `${totalFailed} teste(s) falharam`}
  Group A (conhecidos): ${failedA} falha(s)
  Group B (ficticios):  ${failedB} falha(s)
  Group C (premium):    ${failedC} falha(s)
`);

process.exit(totalFailed > 0 ? 1 : 0);
