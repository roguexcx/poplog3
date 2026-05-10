// src/lib/title-utils.ts

import { GENRE_LABEL_BY_ID, getContentTypeLabel as getMediaContentTypeLabel } from "@/lib/domain-labels";

export const GENRE_NAMES = GENRE_LABEL_BY_ID;

const KEYWORD_PHRASES: Record<string, string> = {
  "space travel": "Viagem espacial", "space mission": "Missão espacial",
  "time travel": "Viagem no tempo", "based on novel": "Baseado em livro",
  "based on true story": "Baseado em fatos reais",
  "artificial intelligence": "Inteligência artificial",
  "serial killer": "Assassino em série", "coming of age": "Amadurecimento",
  "found footage": "Filmagem encontrada", "super hero": "Super-herói",
  superhero: "Super-herói", "martial arts": "Artes marciais",
  "world war": "Guerra mundial", "road trip": "Viagem de estrada",
  "high school": "Ensino médio", "small town": "Cidade pequena",
  "post apocalypse": "Pós-apocalipse", "alien invasion": "Invasão alienígena",
  "space opera": "Ópera espacial",
};

const KEYWORD_WORDS: Record<string, string> = {
  alien: "alienígena", aliens: "alienígenas", astronaut: "astronauta",
  robot: "robô", survival: "sobrevivência", future: "futuro",
  dystopia: "distopia", revenge: "vingança", friendship: "amizade",
  investigation: "investigação", murder: "assassinato", romance: "romance",
  family: "família", magic: "magia", war: "guerra", space: "espacial",
  mission: "missão", travel: "viagem", journey: "jornada", time: "tempo",
  novel: "livro", crime: "crime", police: "policial", detective: "detetive",
  monster: "monstro", apocalypse: "apocalipse", school: "escola",
  teenager: "adolescente", vampire: "vampiro", zombie: "zumbi",
  hero: "herói", superhero: "super-herói", mystery: "mistério",
  conspiracy: "conspiração", rescue: "resgate", desert: "deserto",
  island: "ilha", dream: "sonho", dreams: "sonhos", love: "amor",
  death: "morte", planet: "planeta", mars: "marte", moon: "lua", earth: "terra",
};

export function getContentTypeLabel(type: string, genreIds: number[] = []): string {
  return getMediaContentTypeLabel(type, genreIds);
}

export function normalizeKeywordName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function formatKeyword(keyword: string): string {
  const normalized = `${keyword ?? ""}`.toLowerCase().trim();
  if (KEYWORD_PHRASES[normalized]) return KEYWORD_PHRASES[normalized];

  const translated = normalized
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => KEYWORD_WORDS[word] ?? word)
    .join(" ");

  return translated.charAt(0).toUpperCase() + translated.slice(1);
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
