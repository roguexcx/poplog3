import { classifyRadarEligibility, EligibilityInput } from "../eligibility";

// ---------------------------------------------------------------------------
// Shared metadata profiles
// ---------------------------------------------------------------------------

const BBC_LOCAL_FACTUAL: Partial<EligibilityInput> = {
  category: "DOCUMENTARY", tmdbType: "Talk Show", genreIds: [99],
  originalLanguage: "en", originCountry: ["GB"], popularity: 15,
  voteCount: 120, voteAverage: 6.5,
  networks: [{ id: 4, name: "BBC One", origin_country: "GB" }],
  brazilProviders: [], hasTmdb: true,
};

const KIDS_DISNEY_JR: Partial<EligibilityInput> = {
  category: "KIDS", tmdbType: "Scripted", genreIds: [16, 10751, 10762],
  originalLanguage: "en", originCountry: ["US"], popularity: 18,
  voteCount: 80, voteAverage: 6.2,
  networks: [{ id: 2103, name: "Disney Junior", origin_country: "US" }],
  brazilProviders: [], hasTmdb: true,
};

const RELIGIOUS_TBN: Partial<EligibilityInput> = {
  category: "DOCUMENTARY", tmdbType: "Documentary", genreIds: [99],
  originalLanguage: "en", originCountry: ["US"], popularity: 5,
  voteCount: 30, voteAverage: 6.0,
  networks: [{ id: 13260, name: "TBN", origin_country: "US" }],
  brazilProviders: [], hasTmdb: true,
};

const KOREAN_NICHE: Partial<EligibilityInput> = {
  category: "SERIES", tmdbType: "Scripted", genreIds: [18],
  originalLanguage: "ko", originCountry: ["KR"], popularity: 20,
  voteCount: 150, voteAverage: 7.0,
  networks: [{ id: 99999, name: "KBS2", origin_country: "KR" }],
  brazilProviders: [], hasTmdb: true,
};

const HGTV_REALITY: Partial<EligibilityInput> = {
  category: "REALITY", tmdbType: "Reality", genreIds: [10764],
  originalLanguage: "en", originCountry: ["US"], popularity: 12,
  voteCount: 90, voteAverage: 5.8,
  networks: [{ id: 1267, name: "HGTV", origin_country: "US" }],
  brazilProviders: [], hasTmdb: true,
};

const TRAVEL_LIFESTYLE: Partial<EligibilityInput> = {
  category: "REALITY", tmdbType: "Reality", genreIds: [10764],
  originalLanguage: "en", originCountry: ["US"], popularity: 8,
  voteCount: 60, voteAverage: 5.5,
  networks: [{ id: 80, name: "Travel Channel", origin_country: "US" }],
  brazilProviders: [], hasTmdb: true,
};

const TURKISH_SERIAL: Partial<EligibilityInput> = {
  category: "SERIES", tmdbType: "Scripted", genreIds: [18],
  originalLanguage: "tr", originCountry: ["TR"], popularity: 25,
  voteCount: 130, voteAverage: 6.8,
  networks: [{ id: 88888, name: "TRT1", origin_country: "TR" }],
  brazilProviders: [], hasTmdb: true,
};

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let totalFailed = 0;

function check(title: string, profile: Partial<EligibilityInput>, expectBlocked: boolean, expectedReason?: string): void {
  const input = { title, ...profile } as EligibilityInput;
  const result = classifyRadarEligibility(input);
  const actuallyBlocked = !result.eligible;
  const pass = actuallyBlocked === expectBlocked;
  if (!pass) totalFailed++;

  const statusIcon = pass ? (expectBlocked ? "BLOQ" : "PASS") : "FAIL";
  const reasonNote = actuallyBlocked
    ? ` -> ${result.reason}${expectedReason && result.reason !== expectedReason ? ` (exp:${expectedReason})` : ""} [${result.signals.slice(0,3).join(", ")}]`
    : "";
  const failNote = !pass ? (expectBlocked ? " <<< DEVERIA SER BLOQUEADO" : " <<< DEVERIA PASSAR") : "";
  console.log(`  [${statusIcon}] "${title}"${reasonNote}${failNote}`);
}

// ---------------------------------------------------------------------------
// GROUP A — Known problematic titles (must be blocked)
// ---------------------------------------------------------------------------
console.log("\n=== GROUP A: Titulos problematicos conhecidos (BLOQUEADOS) ===\n");

check("Svengoolie",                        HGTV_REALITY,      true,  "nonfiction_local");
check("Home Town: Inn This Together",      TRAVEL_LIFESTYLE,  true,  "nonfiction_local");
check("The Old Stories: Moses",            RELIGIOUS_TBN,     true,  "religious_niche");
check("Sofia the First: Royal Magic",      KIDS_DISNEY_JR,    true,  "kids_content");
check("Britain's Got Talent",              TRAVEL_LIFESTYLE,  true,  "nonfiction_local");
check("Great Continental Railway Journeys", BBC_LOCAL_FACTUAL, true, "low_brazil_relevance");
check("Maine Cabin Masters",               HGTV_REALITY,      true,  "nonfiction_local");
check("Little Big Italy",                  TRAVEL_LIFESTYLE,  true,  "nonfiction_local");
check("In the Eye of the Storm: Chasers",  TRAVEL_LIFESTYLE,  true,  "nonfiction_local");

// ---------------------------------------------------------------------------
// GROUP B — Fictional titles with same metadata profiles (must also be blocked)
// ---------------------------------------------------------------------------
console.log("\n=== GROUP B: Titulos ficticios com mesmo perfil de metadados (BLOQUEADOS) ===\n");

check("XYZ Local Niche Show 2025",         HGTV_REALITY,      true,  "nonfiction_local");
check("Casa Nova Com Fulano",              HGTV_REALITY,      true,  "nonfiction_local");
check("Random Travel Show Future 2026",    TRAVEL_LIFESTYLE,  true,  "nonfiction_local");
check("Descobrindo Regioes Perdidas",      TRAVEL_LIFESTYLE,  true,  "nonfiction_local");
check("New Testament Chronicles 2026",    RELIGIOUS_TBN,     true,  "religious_niche");
check("Vida de Fe Serie Especial",        RELIGIOUS_TBN,     true,  "religious_niche");
check("Magical Pony Adventure Jr",        KIDS_DISNEY_JR,    true,  "kids_content");
check("Super Kids Show 2026",             KIDS_DISNEY_JR,    true,  "kids_content");
check("BBC Local Heritage Walk 2026",     BBC_LOCAL_FACTUAL, true,  "low_brazil_relevance");
check("British Villages Explored",        BBC_LOCAL_FACTUAL, true,  "low_brazil_relevance");
check("Novo Drama Coreano Niche 2026",    KOREAN_NICHE,      true,  "soap_or_dorama");
check("Yeni Turk Dizisi 2026",            TURKISH_SERIAL,    true,  "soap_or_dorama");

// ---------------------------------------------------------------------------
// GROUP C — Premium content that must PASS
// ---------------------------------------------------------------------------
console.log("\n=== GROUP C: Conteudo premium (DEVE PASSAR) ===\n");

check("Breaking Bad",    { category:"SERIES", tmdbType:"Scripted", genreIds:[18,80], originalLanguage:"en", originCountry:["US"], popularity:320, voteCount:12000, voteAverage:9.5, networks:[{id:174,name:"AMC",origin_country:"US"}], brazilProviders:["Netflix"], hasTmdb:true }, false);
check("Succession",      { category:"SERIES", tmdbType:"Scripted", genreIds:[18], originalLanguage:"en", originCountry:["US"], popularity:280, voteCount:8000, voteAverage:9.0, networks:[{id:49,name:"HBO",origin_country:"US"}], brazilProviders:["Max"], hasTmdb:true }, false);
check("Fleabag",         { category:"SERIES", tmdbType:"Scripted", genreIds:[35,18], originalLanguage:"en", originCountry:["GB"], popularity:95, voteCount:3200, voteAverage:8.7, networks:[{id:4,name:"BBC Three",origin_country:"GB"}], brazilProviders:["Prime Video"], hasTmdb:true }, false);
check("Planet Earth III",{ category:"DOCUMENTARY", tmdbType:"Documentary", genreIds:[99], originalLanguage:"en", originCountry:["GB"], popularity:150, voteCount:4500, voteAverage:9.0, networks:[{id:4,name:"BBC One",origin_country:"GB"}], brazilProviders:["Netflix"], hasTmdb:true }, false);
check("Squid Game",      { category:"SERIES", tmdbType:"Scripted", genreIds:[18,28], originalLanguage:"ko", originCountry:["KR"], popularity:420, voteCount:15000, voteAverage:8.0, networks:[{id:213,name:"Netflix",origin_country:"US"}], brazilProviders:["Netflix"], hasTmdb:true }, false);
check("Sherlock",        { category:"SERIES", tmdbType:"Scripted", genreIds:[18,9648,80], originalLanguage:"en", originCountry:["GB"], popularity:230, voteCount:9000, voteAverage:9.0, networks:[{id:4,name:"BBC One",origin_country:"GB"}], brazilProviders:["Netflix"], hasTmdb:true }, false);
check("Narcos",          { category:"SERIES", tmdbType:"Scripted", genreIds:[18,80], originalLanguage:"en", originCountry:["US"], popularity:200, voteCount:7000, voteAverage:8.8, networks:[{id:213,name:"Netflix",origin_country:"US"}], brazilProviders:["Netflix"], hasTmdb:true }, false);
check("The Last of Us",  { category:"SERIES", tmdbType:"Scripted", genreIds:[18,10765], originalLanguage:"en", originCountry:["US"], popularity:310, voteCount:10000, voteAverage:8.8, networks:[{id:49,name:"HBO",origin_country:"US"}], brazilProviders:["Max"], hasTmdb:true }, false);
check("Dark",            { category:"SERIES", tmdbType:"Scripted", genreIds:[18,9648,10765], originalLanguage:"de", originCountry:["DE"], popularity:120, voteCount:5000, voteAverage:8.8, networks:[{id:213,name:"Netflix",origin_country:"US"}], brazilProviders:["Netflix"], hasTmdb:true }, false);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(totalFailed === 0
  ? "RESULTADO: TODOS OS TESTES PASSARAM"
  : `RESULTADO: ${totalFailed} teste(s) FALHARAM`);
console.log("=".repeat(50) + "\n");
process.exit(totalFailed > 0 ? 1 : 0);
