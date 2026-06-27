import { formatEpisodeRuntimeLabel, formatRuntimeLabel, parseYearLabel, translateGenreName, } from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
type HeroHeadline = [
    string,
    string,
    string
];
type HeroPeriod = "madrugada" | "manha" | "tarde" | "noite";
const HEADLINES: Record<"pt-BR" | "en-US", Record<HeroPeriod, HeroHeadline[]>> = {
    "pt-BR": {
        madrugada: [
            ["Ainda acordado?", "Temos algo", "para agora."],
            ["Silencio na casa.", "Combina com um", "bom filme."],
            ["Noite funda.", "Escolha algo", "marcante."],
        ],
        manha: [
            ["Bom dia.", "O que vamos", "assistir hoje?"],
            ["Cafe pronto.", "Falta escolher", "a companhia."],
            ["Comece", "o dia com", "uma historia."],
        ],
        tarde: [
            ["Tarde livre?", "Aproveite com", "um bom filme."],
            ["Descubra algo", "para ver", "mais tarde."],
            ["Relaxa.", "A curadoria", "chegou."],
        ],
        noite: [
            ["Descubra o", "ritmo", "da sua noite."],
            ["Pipoca pronta?", "Escolha o", "filme de hoje."],
            ["Noite de", "cinema", "em casa."],
        ],
    },
    "en-US": {
        madrugada: [
            ["Still awake?", "We found", "something for now."],
            ["Quiet house.", "Good time for", "a film."],
            ["Deep night.", "Pick something", "memorable."],
        ],
        manha: [
            ["Good morning.", "What should we", "watch today?"],
            ["Coffee is ready.", "Now choose", "the company."],
            ["Start", "the day with", "a story."],
        ],
        tarde: [
            ["Free afternoon?", "Make it", "a good movie."],
            ["Find something", "to watch", "later."],
            ["Settle in.", "The curation", "is here."],
        ],
        noite: [
            ["Find the", "right mood", "for tonight."],
            ["Popcorn ready?", "Pick today's", "movie."],
            ["Movie night", "starts", "at home."],
        ],
    },
};
function getBrasiliaHour(): number {
    return (new Date().getUTCHours() - 3 + 24) % 24;
}
export function getHeroHeadline(language: string | null | undefined = "pt-BR"): HeroHeadline {
    const hour = getBrasiliaHour();
    let period: HeroPeriod;
    if (hour >= 6 && hour < 12) {
        period = "manha";
    }
    else if (hour >= 12 && hour < 18) {
        period = "tarde";
    }
    else if (hour >= 18 && hour < 24) {
        period = "noite";
    }
    else {
        period = "madrugada";
    }
    const normalized = language === "en-US" ? "en-US" : "pt-BR";
    const pool = HEADLINES[normalized][period];
    return pool[Math.floor(Math.random() * pool.length)];
}
export function translateGenres(genres: Array<string | {
    name: string;
}>, limit = 2, language: string | null | undefined = "pt-BR"): string {
    const shouldTranslate = language !== "en-US";
    return genres
        .slice(0, limit)
        .map((g) => {
        const name = typeof g === "string" ? g : (typeof g === "object" && g !== null ? g.name : String(g));
        return shouldTranslate ? translateGenreName(name) ?? name : name;
    })
        .join(" • ");
}
export function formatRuntime(mediaType: "movie" | "tv", runtime?: number | null, episodeRuntime?: number[] | null): string | null {
    const runtimeResolution = resolveRuntimeByMediaType({
        mediaType,
        runtimeMinutes: runtime,
        episodeRunTime: episodeRuntime,
    });
    if (runtimeResolution.minutes === null) {
        return null;
    }
    if (mediaType === "tv") {
        return formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
            estimated: runtimeResolution.estimated,
        });
    }
    return formatRuntimeLabel(runtimeResolution.minutes, {
        estimated: runtimeResolution.estimated,
    });
}
export function parseYear(releaseDate?: string | null, firstAirDate?: string | null): string | null {
    return parseYearLabel(releaseDate, firstAirDate);
}
