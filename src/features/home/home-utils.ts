import { uiMessage } from "@/lib/i18n/ui-message";
import { formatEpisodeRuntimeLabel, formatRuntimeLabel, parseYearLabel, translateGenreName, } from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
const HEADLINES: Record<string, [
    string,
    string,
    string
][]> = {
    madrugada: [
        ["Ainda acordado?", "Temos algo", uiMessage("ui.90390f1eae3a")],
        [uiMessage("ui.a8b1ccadf64b"), "com um bom", "filme."],
        ["Noite funda.", "Escolha algo", "marcante."],
    ],
    manha: [
        ["Bom dia.", "O que vamos", "assistir hoje?"],
        [uiMessage("ui.fe152e7f2fa9"), "Falta escolher", uiMessage("ui.a150260d1b89")],
        [uiMessage("ui.81182f76c1f4"), "o dia com", uiMessage("ui.144b0ea52865")],
    ],
    tarde: [
        ["Tarde livre?", "Aproveite com", "um bom filme."],
        ["Descubra algo", uiMessage("ui.2a5f848c4d2b"), "mais tarde."],
        ["Relaxa.", "A curadoria", "chegou."],
    ],
    noite: [
        ["Descubra o", uiMessage("ui.55ccb577cc05"), "da sua noite."],
        ["Pipoca pronta?", "Escolha o", "filme de hoje."],
        ["Noite de", "cinema", uiMessage("ui.903c2c59dd61")],
    ],
};
function getBrasiliaHour(): number {
    return (new Date().getUTCHours() - 3 + 24) % 24;
}
export function getHeroHeadline(): [
    string,
    string,
    string
] {
    const hour = getBrasiliaHour();
    let pool: [
        string,
        string,
        string
    ][];
    if (hour >= 6 && hour < 12) {
        pool = HEADLINES.manha;
    }
    else if (hour >= 12 && hour < 18) {
        pool = HEADLINES.tarde;
    }
    else if (hour >= 18 && hour < 24) {
        pool = HEADLINES.noite;
    }
    else {
        pool = HEADLINES.madrugada;
    }
    return pool[Math.floor(Math.random() * pool.length)];
}
export function translateGenres(genres: Array<string | {
    name: string;
}>, limit = 2): string {
    return genres
        .slice(0, limit)
        .map((g) => {
        const name = typeof g === "string" ? g : (typeof g === "object" && g !== null ? g.name : String(g));
        return translateGenreName(name) ?? name;
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

