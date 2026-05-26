import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import type {
  SorteioFilters,
  SorteioMode,
  SorteioTypeFilter,
  SorteioVibeFilter,
} from "@/server/sorteio/sorteio-engine";

const MODES = new Set<SorteioMode>(["discovery", "watchlist"]);
const TYPES = new Set<SorteioTypeFilter>(["all", "movie", "tv"]);
const VIBES = new Set<SorteioVibeFilter>(["all", "intense", "light", "surprise"]);

export async function requireSorteioUser() {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user, response: null };
}

export function parseSorteioFilters(input: URLSearchParams | Record<string, unknown>): SorteioFilters {
  const getValue = (key: string) =>
    input instanceof URLSearchParams ? input.get(key) : input[key];

  const mode = getValue("mode");
  const type = getValue("type");
  const vibe = getValue("vibe");

  return {
    mode: MODES.has(mode as SorteioMode) ? mode as SorteioMode : "discovery",
    type: TYPES.has(type as SorteioTypeFilter) ? type as SorteioTypeFilter : "all",
    vibe: VIBES.has(vibe as SorteioVibeFilter) ? vibe as SorteioVibeFilter : "all",
  };
}
