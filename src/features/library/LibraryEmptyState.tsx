import type { LibraryTab } from "./LibraryTabs";

type LibraryEmptyStateProps = {
  activeTab: LibraryTab;
};

export default function LibraryEmptyState({
  activeTab,
}: LibraryEmptyStateProps) {
  const content = getEmptyContent(activeTab);

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.035] px-6 py-14 text-center shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:px-8 md:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(129,140,248,0.16),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

      <div className="relative mx-auto max-w-xl">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-black/20 text-2xl shadow-inner">
          {content.icon}
        </div>

        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-indigo-200/65">
          {content.kicker}
        </p>

        <h2 className="mt-3 text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">
          {content.title}
        </h2>

        <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-white/50">
          {content.description}
        </p>
      </div>
    </div>
  );
}

function getEmptyContent(activeTab: LibraryTab) {
  switch (activeTab) {
    case "watchlist":
      return {
        icon: "＋",
        kicker: "Watchlist vazia",
        title: "Nenhum título separado ainda.",
        description:
          "Quando você encontrar algo para ver depois, ele aparece aqui como uma prateleira de desejos cinematográficos.",
      };

    case "watching":
      return {
        icon: "▶",
        kicker: "Nada em andamento",
        title: "Você ainda não começou nenhuma jornada.",
        description:
          "Séries e títulos marcados como assistindo ficam aqui para virar seu painel de continuidade.",
      };

    case "watched":
      return {
        icon: "✓",
        kicker: "Histórico vazio",
        title: "Nenhum título assistido por enquanto.",
        description:
          "Quando você marcar filmes e séries como vistos, sua memória audiovisual começa a ganhar forma.",
      };

    case "abandoned":
      return {
        icon: "×",
        kicker: "Sem abandonados",
        title: "Nada ficou pelo caminho.",
        description:
          "Títulos abandonados ficam separados aqui, longe da bagunça, mas ainda dentro da sua história.",
      };

    case "fridge":
      return {
        icon: "❄",
        kicker: "Geladeira vazia",
        title: "Nenhum título guardado para outro clima.",
        description:
          "Use a geladeira para deixar títulos em pausa sem jogar tudo para a watchlist ou para os abandonados.",
      };

    default:
      return {
        icon: "◎",
        kicker: "Biblioteca vazia",
        title: "Sua coleção ainda está esperando o primeiro título.",
        description:
          "Salve filmes e séries pela busca ou pelas páginas de título para começar a construir sua biblioteca.",
      };
  }
}