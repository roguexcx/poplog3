import { NextResponse } from "next/server";

import { agendaEngine } from "@/server/agenda/agenda-engine";
import { getCurrentUser } from "@/server/auth/get-current-user";

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null);
    const response = await agendaEngine.compose(user?.id ?? null, { region: "BR" });

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": user
          ? "private, max-age=180"
          : "public, max-age=600, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[agenda/v2] route error:", err);
    return NextResponse.json(
      {
        personal: {
          today: [],
          thisWeek: [],
          upcoming: [],
          leavingSoon: [],
          delayed: [],
        },
        calendar: {
          byProvider: {},
          cinemaHighlights: [],
          soonOnStreaming: [],
        },
        timeline: [],
        meta: {
          generatedAt: new Date().toISOString(),
          userHasLibrary: false,
          cacheStrategy: "fallback",
        },
        nowPlaying: [],
        upcoming: [],
        airingToday: [],
        onTheAir: [],
        newSeries: [],
        soonToReturn: [],
        userLibraryIds: {},
        newEpisodes: [],
        upcomingEpisodes: [],
        leavingSoonItems: [],
      },
      { status: 200 },
    );
  }
}
