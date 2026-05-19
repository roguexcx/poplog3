import { NextResponse } from "next/server";
import { parseIcsContent, type IcsEvent } from "@/lib/ics-parser";

// Revalida a cada 30 minutos — o feed do bancodeseries é atualizado diariamente
export const revalidate = 1800;

const ICS_URL = "http://bancodeseries.com.br/ical.php";

export interface IcsAgendaResponse {
  events: IcsEvent[];
  fetchedAt: string;
  source: string;
  count: number;
}

export async function GET() {
  try {
    const res = await fetch(ICS_URL, {
      headers: {
        "User-Agent": "PoplogApp/1.0 (calendar integration)",
        Accept: "text/calendar, text/plain, */*",
      },
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `ICS feed returned ${res.status}` },
        { status: 502 }
      );
    }

    const raw = await res.text();
    const events = parseIcsContent(raw);

    const response: IcsAgendaResponse = {
      events,
      fetchedAt: new Date().toISOString(),
      source: ICS_URL,
      count: events.length,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("[ICS Agenda] fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch or parse ICS feed" },
      { status: 500 }
    );
  }
}
