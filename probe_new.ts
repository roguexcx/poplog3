import { classifyRadarEligibility } from "./src/lib/radar/eligibility";
import type { EligibilityInput } from "./src/lib/radar/eligibility";

const cases: Array<{ label: string; input: EligibilityInput; expect: "block" | "pass" }> = [
  // --- Perfis REAIS do banco (devem BLOQUEAR) ---
  {
    label: "Tribunal Justice (Freevee AVOD — dados reais do banco)",
    expect: "block",
    input: {
      title: "Tribunal Justice",
      category: "REALITY", tmdbType: "Reality", genreIds: [10764],
      originalLanguage: "en", originCountry: ["US"],
      popularity: 2.4, voteCount: 0, voteAverage: 0,
      networks: [
        { id: 1024, name: "Prime Video", origin_country: "" },
        { id: 5865, name: "Amazon Freevee", origin_country: "US" },
      ],
      brazilProviders: [], hasTmdb: true,
    },
  },
  {
    label: "Hard Quiz AU (ABC AU, Scripted, genre=[35], pop 2.1 — dados reais do banco)",
    expect: "block",
    input: {
      title: "Hard Quiz",
      category: "SERIES", tmdbType: "Scripted", genreIds: [35],
      originalLanguage: "en", originCountry: ["AU"],
      popularity: 2.1, voteCount: 80, voteAverage: 7.2,
      networks: [{ id: 18, name: "ABC TV", origin_country: "AU" }],
      brazilProviders: [], hasTmdb: true,
    },
  },
  {
    label: "Home Town: Inn This Together (Scripted, genre=[], sem redes, pop 0.2 — dados reais)",
    expect: "block",
    input: {
      title: "Home Town: Inn This Together",
      category: "SERIES", tmdbType: "Scripted", genreIds: [],
      originalLanguage: "en", originCountry: ["US"],
      popularity: 0.2, voteCount: 0, voteAverage: 0,
      networks: [],
      brazilProviders: [], hasTmdb: true,
    },
  },
  // --- Devem CONTINUAR PASSANDO ---
  {
    label: "The Boys (Prime Video real — deve passar)",
    expect: "pass",
    input: {
      title: "The Boys",
      category: "SERIES", tmdbType: "Scripted", genreIds: [10765, 18],
      originalLanguage: "en", originCountry: ["US"],
      popularity: 320, voteCount: 9000, voteAverage: 8.7,
      networks: [{ id: 1024, name: "Prime Video", origin_country: "US" }],
      brazilProviders: ["Prime Video"], hasTmdb: true,
    },
  },
  {
    label: "Dark Winds (AMC scripted, sem BR — deve passar)",
    expect: "pass",
    input: {
      title: "Dark Winds",
      category: "SERIES", tmdbType: "Scripted", genreIds: [18, 80],
      originalLanguage: "en", originCountry: ["US"],
      popularity: 35, voteCount: 400, voteAverage: 7.2,
      networks: [{ id: 174, name: "AMC", origin_country: "US" }],
      brazilProviders: [], hasTmdb: true,
    },
  },
  {
    label: "Bluey (AU, kids popular, provider BR — deve passar)",
    expect: "pass",
    input: {
      title: "Bluey",
      category: "SERIES", tmdbType: "Scripted", genreIds: [16, 10751],
      originalLanguage: "en", originCountry: ["AU"],
      popularity: 180, voteCount: 3000, voteAverage: 8.9,
      networks: [{ id: 213, name: "Netflix", origin_country: "US" }],
      brazilProviders: ["Netflix"], hasTmdb: true,
    },
  },
  {
    label: "RuPaul Drag Race (Netflix reality — deve passar)",
    expect: "pass",
    input: {
      title: "RuPaul's Drag Race",
      category: "REALITY", tmdbType: "Reality", genreIds: [10764],
      originalLanguage: "en", originCountry: ["US"],
      popularity: 95, voteCount: 2200, voteAverage: 7.8,
      networks: [{ id: 213, name: "Netflix", origin_country: "US" }],
      brazilProviders: ["Netflix"], hasTmdb: true,
    },
  },
  {
    label: "Tribunal Justice com Prime Video real (sem Freevee — deve passar)",
    expect: "pass",
    input: {
      title: "The Grand Tour (Prime real)",
      category: "REALITY", tmdbType: "Reality", genreIds: [10764],
      originalLanguage: "en", originCountry: ["GB"],
      popularity: 85, voteCount: 1500, voteAverage: 8.2,
      networks: [{ id: 1024, name: "Prime Video", origin_country: "US" }],
      brazilProviders: ["Prime Video"], hasTmdb: true,
    },
  },
];

let failed = 0;
for (const { label, input, expect } of cases) {
  const r = classifyRadarEligibility(input);
  const actual = r.eligible ? "pass" : "block";
  const ok = actual === expect;
  const icon = ok ? "OK  " : "FAIL";
  const detail = ok
    ? r.signals.slice(-2).join(" | ")
    : `esperado:${expect} got:${actual} -> ${r.reason} | ${r.signals.slice(-2).join(" | ")}`;
  console.log(`[${icon}] ${label}`);
  console.log(`       ${detail}`);
  if (!ok) failed++;
}
console.log(`\n${failed === 0 ? "TODOS PASSARAM" : failed + " FALHAS"}`);
process.exit(failed > 0 ? 1 : 0);
