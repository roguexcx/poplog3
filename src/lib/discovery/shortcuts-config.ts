export type ShortcutAccent =
  | "rose" | "blue" | "violet" | "amber" | "green" | "indigo" | "teal" | "orange";

export type Shortcut = {
  slug: string;
  label: string;
  description: string;
  editorialTitle: string;
  icon: string;
  accent: ShortcutAccent;
};

export type ShortcutGroup = {
  id: string;
  label: string;
  shortcuts: Shortcut[];
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "em-alta",
    label: "Em alta",
    shortcuts: [
      {
        slug: "bombando-agora",
        label: "Bombando agora",
        description: "Os títulos mais populares no momento, filmes e séries.",
        editorialTitle: "Bombando agora",
        icon: "🔥",
        accent: "rose",
      },
      {
        slug: "filmes-em-alta",
        label: "Filmes em alta",
        description: "Os filmes mais assistidos e comentados desta semana.",
        editorialTitle: "Filmes em alta",
        icon: "🎬",
        accent: "blue",
      },
      {
        slug: "series-em-alta",
        label: "Séries em alta",
        description: "As séries com mais maratonas e buzz agora.",
        editorialTitle: "Séries em alta",
        icon: "📺",
        accent: "violet",
      },
    ],
  },
  {
    id: "generos",
    label: "Gêneros",
    shortcuts: [
      { slug: "acao-aventura",    label: "Ação e aventura",    description: "Adrenalina, combates e missões impossíveis.",                  editorialTitle: "Ação e aventura",       icon: "💥", accent: "rose" },
      { slug: "comedia",          label: "Comédia",            description: "Para dar boas gargalhadas e aliviar o dia.",                   editorialTitle: "Comédias populares",    icon: "😂", accent: "amber" },
      { slug: "drama",            label: "Drama",              description: "Histórias que tocam fundo e ficam na memória.",                editorialTitle: "Dramas populares",      icon: "🎭", accent: "indigo" },
      { slug: "terror",           label: "Terror",             description: "Sustos, tensão e aquele frio na espinha.",                    editorialTitle: "Terror em alta",        icon: "👻", accent: "violet" },
      { slug: "romance",          label: "Romance",            description: "Histórias de amor, paixão e sentimento.",                     editorialTitle: "Romances populares",    icon: "❤️",  accent: "rose" },
      { slug: "ficcao-cientifica", label: "Ficção científica", description: "Futuros possíveis, espaço e tecnologia além do tempo.",       editorialTitle: "Ficção científica",     icon: "🚀", accent: "blue" },
      { slug: "fantasia",         label: "Fantasia",           description: "Mundos mágicos, criaturas e lendas épicas.",                  editorialTitle: "Fantasia",              icon: "🧙", accent: "violet" },
      { slug: "documentario",     label: "Documentário",       description: "Histórias reais que surpreendem mais que ficção.",            editorialTitle: "Documentários",         icon: "🎥", accent: "teal" },
      { slug: "animacao",         label: "Animação",           description: "Animações para todas as idades e gostos.",                   editorialTitle: "Animações populares",   icon: "🎨", accent: "orange" },
    ],
  },
];

export function findShortcut(slug: string): (Shortcut & { group: ShortcutGroup }) | undefined {
  for (const group of SHORTCUT_GROUPS) {
    const s = group.shortcuts.find((x) => x.slug === slug);
    if (s) return { ...s, group };
  }
  return undefined;
}
