import type { LibraryTab } from "./LibraryTabs";

type LibraryEmptyStateProps = {
  activeTab: LibraryTab;
};

export default function LibraryEmptyState({
  activeTab,
}: LibraryEmptyStateProps) {
  const content = getEmptyContent(activeTab);

  return (
    <div className="relative overflow-hidden rounded-[2.25rem] border border-white/[0.08] bg-white/[0.028] px-6 py-16 text-center shadow-[0_26px_100px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:px-8 md:py-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(129,140,248,0.18),transparent_44%),radial-gradient(circle_at_80%_90%,rgba(34,211,238,0.10),transparent_38%)]" />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />

      <div className="relative mx-auto max-w-xl">
        <div className="mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-white/[0.1] bg-white/[0.05] text-3xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
          {content.icon}
        </div>

        <p className="text-[10px] font-black uppercase tracking-[0.26em] text-cyan-100/64">
          {content.kicker}
        </p>

        <h2 className="mt-3 text-3xl font-black tracking-[-0.05em] text-white sm:text-4xl">
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
          "Quando você salvar algo para ver depois, ele aparece aqui como uma prateleira visual da sua coleção.",
      };

    case "watching":
      return {
        icon: "▶",
        kicker: "Nada em andamento",
        title: "Você ainda não começou nenhuma jornada.",
        description:
          "Séries e títulos marcados como assistindo ficam aqui e também alimentam a lógica do Acompanhando.",
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
          "Títulos abandonados ficam separados aqui, fora da continuidade principal, mas ainda dentro da sua história.",
      };

    case "fridge":
      return {
        icon: "❄",
        kicker: "Geladeira vazia",
        title: "Nenhum título guardado para outro clima.",
        description:
          "Use a geladeira para pausar títulos sem misturar tudo com watchlist, assistindo ou abandonados.",
      };

    case "coming-soon":
      return {
        icon: "◌",
        kicker: "Nada em breve",
        title: "Nenhum lançamento futuro nesta seleção.",
        description:
          "Títulos ainda não lançados aparecem aqui quando estiverem salvos na sua biblioteca.",
      };

    case "favorites":
      return {
        icon: "★",
        kicker: "Sem favoritos",
        title: "Nenhum título marcado como favorito.",
        description:
          "Marque filmes e séries como favoritos nas páginas de título para eles aparecerem aqui.",
      };

    default:
      return {
        icon: "◎",
        kicker: "Biblioteca vazia",
        title: "Sua coleção ainda está esperando o primeiro título.",
        description:
          "Salve filmes e séries pela busca ou pelas páginas de título para começar a construir sua biblioteca POPLOG.",
      };
  }
}
