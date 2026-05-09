// src/lib/title-utils.ts

export const GENRE_NAMES: Record<number, string> = {
  28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia",
  80: "Crime", 99: "Documentário", 18: "Drama", 10751: "Família",
  14: "Fantasia", 36: "História", 27: "Terror", 10402: "Música",
  9648: "Mistério", 10749: "Romance", 878: "Ficção científica",
  10770: "Cinema TV", 53: "Thriller", 10752: "Guerra", 37: "Faroeste",
  10759: "Ação & aventura", 10762: "Infantil", 10763: "Notícias",
  10764: "Reality", 10765: "Sci-fi & fantasia", 10766: "Novela",
  10767: "Talk show", 10768: "Guerra & política",
};

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
  const genres = new Set(genreIds);

  if (type === "movie") {
    if (genres.has(99)) return "Documentário";
    if (genres.has(16)) return "Animação";
    if (genres.has(10770)) return "Filme para TV";
    return "Filme";
  }

  if (type === "tv") {
    if (genres.has(10764)) return "Reality";
    if (genres.has(99)) return "Documentário";
    if (genres.has(10766)) return "Novela";
    if (genres.has(10767)) return "Talk show";
    if (genres.has(10763)) return "Notícias";
    if (genres.has(10762)) return "Infantil";
    if (genres.has(16)) return "Série animada";
    return "Série";
  }

  return "Título";
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
