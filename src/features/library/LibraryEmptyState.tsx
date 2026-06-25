import { uiMessage } from "@/lib/i18n/ui-message";
import type { LibraryTab } from "./LibraryTabs";
type LibraryEmptyStateProps = {
    activeTab: LibraryTab;
    /** Quando há uma busca interna ativa sem resultados, sobrepõe a mensagem da aba. */
    searchQuery?: string;
};
export default function LibraryEmptyState({ activeTab, searchQuery, }: LibraryEmptyStateProps) {
    const content = searchQuery
        ? {
            icon: "🔍",
            kicker: "Sem resultados",
            title: uiMessage("ui.14f09eb49bb0", { v1: searchQuery }),
            description: uiMessage("ui.521b9c59d715"),
        }
        : getEmptyContent(activeTab);
    return (<div className="relative overflow-hidden rounded-[2.25rem] border border-white/[0.08] bg-white/[0.028] px-6 py-16 text-center shadow-[0_26px_100px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:px-8 md:py-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(129,140,248,0.18),transparent_44%),radial-gradient(circle_at_80%_90%,rgba(34,211,238,0.10),transparent_38%)]"/>
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent"/>

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
    </div>);
}
function getEmptyContent(activeTab: LibraryTab) {
    switch (activeTab) {
        case "watchlist":
            return {
                icon: "＋",
                kicker: "Watchlist vazia",
                title: uiMessage("ui.06752e6efb63"),
                description: uiMessage("ui.0c9d45b92337"),
            };
        case "watching":
            return {
                icon: "▶",
                kicker: "Nada em andamento",
                title: uiMessage("ui.edf5e7e810db"),
                description: uiMessage("ui.9bbab516ebfc"),
            };
        case "watched":
            return {
                icon: "✓",
                kicker: uiMessage("ui.b5ec228dd202"),
                title: uiMessage("ui.ce79b6787590"),
                description: uiMessage("ui.9068ed739054"),
            };
        case "abandoned":
            return {
                icon: "×",
                kicker: "Sem abandonados",
                title: uiMessage("ui.74f2a2d5425d"),
                description: uiMessage("ui.8fcdcd62c4bc"),
            };
        case "fridge":
            return {
                icon: "❄",
                kicker: "Geladeira vazia",
                title: uiMessage("ui.02b07b6f2c29"),
                description: uiMessage("ui.f3871e052ef6"),
            };
        case "coming-soon":
            return {
                icon: "◌",
                kicker: "Nada em breve",
                title: uiMessage("ui.5b0e1516d230"),
                description: uiMessage("ui.5f6eaf29220a"),
            };
        case "favorites":
            return {
                icon: "★",
                kicker: "Sem favoritos",
                title: uiMessage("ui.9e7e80142502"),
                description: uiMessage("ui.41b73fafed6f"),
            };
        default:
            return {
                icon: "◎",
                kicker: uiMessage("ui.cfa97f559e97"),
                title: uiMessage("ui.fbb8b2d69ebe"),
                description: uiMessage("ui.7be3c0585389"),
            };
    }
}

