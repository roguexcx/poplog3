// -- TTL editorial dinamico ---------------------------------------------------
//
// Em vez de um TTL fixo, calcula quantos segundos faltam ate o proximo horario
// de recalculo editorial, calibrado ao dia da semana.
//
// Calendario de recalculos:
//   Dom / Seg  -> 12h, 17h, 22h30
//   Ter / Qua / Qui -> 12h
//   Sex        -> 12h, 22h
//   Sab        -> 12h, 20h
//   Ultimo dia do mes (qualquer dia) -> + 23h extra
//
// Floor minimo de 5 minutos (300s) para evitar invalidacoes em rajada.
// Ceil maximo de 23h (82_800s) como safety net.

const EDITORIAL_SCHEDULE: Record<number, number[]> = {
  0: [12, 17, 22.5],  // Domingo
  1: [12, 17, 22.5],  // Segunda
  2: [12],            // Terca
  3: [12],            // Quarta
  4: [12],            // Quinta
  5: [12, 22],        // Sexta
  6: [12, 20],        // Sabado
};

function isLastDayOfMonth(date: Date): boolean {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() === date.getDate();
}

/**
 * Retorna segundos ate o proximo horario de recalculo editorial.
 * Chamado em runtime.
 */
export function editorialCacheTTL(now = new Date()): number {
  const day = now.getDay();
  const currentH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;

  let hours = EDITORIAL_SCHEDULE[day] ?? [12];

  // Ultimo dia do mes: adiciona recalculo extra as 23h
  if (isLastDayOfMonth(now)) {
    hours = [...new Set([...hours, 23])].sort((a, b) => a - b);
  }

  // Proximo horario no dia atual que ainda nao passou
  const nextToday = hours.find((h) => h > currentH);

  let secondsUntilNext: number;
  if (nextToday !== undefined) {
    secondsUntilNext = Math.round((nextToday - currentH) * 3600);
  } else {
    // Todos os horarios do dia ja passaram -- proximo e o primeiro do dia seguinte
    const tomorrowDay = (day + 1) % 7;
    const tomorrowHours = EDITORIAL_SCHEDULE[tomorrowDay] ?? [12];
    const firstTomorrow = Math.min(...tomorrowHours);
    const hoursUntilMidnight = 24 - currentH;
    secondsUntilNext = Math.round((hoursUntilMidnight + firstTomorrow) * 3600);
  }

  // Floor: 5 min | Ceil: 23h
  return Math.min(82_800, Math.max(300, secondsUntilNext));
}

// -- Cache TTL constants ------------------------------------------------------
//
// Valores estaticos para TTLs que nao dependem de horario editorial.
// discoverCalendar e agendaPriority passaram a usar editorialCacheTTL()
// em runtime (chamado dentro dos fetches que precisam do valor).

export const CACHE_TTL = {
  tmdb: {
    trending:        60 * 60 * 6,
    discover:        60 * 60 * 24,
    // discoverCalendar: use editorialCacheTTL() nos call sites
    discoverCalendar: 60 * 60 * 6,   // fallback estatico -- preferir editorialCacheTTL()
    discoverProvider: 60 * 60,
    // agendaPriority: use editorialCacheTTL() nos call sites
    agendaPriority:  60 * 30,        // fallback estatico -- preferir editorialCacheTTL()
    details:         60 * 60 * 24 * 30,
  },

  watchmode: {
    availability: 60 * 60 * 24 * 7,
  },

  movieofthenight: {
    availability: 60 * 60 * 24 * 14,
    events:       60 * 60 * 24 * 14,
  },
} as const;
