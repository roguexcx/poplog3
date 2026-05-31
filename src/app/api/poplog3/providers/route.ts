/**
 * /api/poplog3/providers — disponibilidade regional (onde assistir).
 *
 * Fonte: Balloonerismm / Watchmode / local (catalog_availability).
 * Zero chamadas TMDB watch/providers.
 *
 * Quando não há dados confirmados, retorna sinal de indisponibilidade
 * controlado — a UI exibe "Disponibilidade ainda não confirmada" em vez
 * de erro ou dado vazio genérico.
 *
 * Parâmetros:
 *   ?id=<imdb_id|trakt_id>  — identificador do título
 *   ?region=BR              — região (padrão: BR)
 *   ?media_type=movie|tv    — tipo de mídia
 */

import { NextRequest, NextResponse } from "next/server";
import { AVAILABILITY_UNAVAILABLE } from "@/server/source-engine/normalizers/normalize-availability";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const region = (searchParams.get("region") ?? "BR").toUpperCase();
  const mediaType = searchParams.get("media_type");

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing required param: id" },
      { status: 400 },
    );
  }

  // TODO: integrar com Balloonerismm/Watchmode via Source Engine quando
  // os adapters de providers estiverem implementados na camada catalog_availability.
  // Por enquanto retorna o sinal controlado de indisponibilidade.

  return NextResponse.json({
    ok: true,
    id,
    region,
    media_type: mediaType ?? "unknown",
    dataSource: "source_engine",
    ...AVAILABILITY_UNAVAILABLE,
    providers: [],
    message: "Provider data not yet available for this title.",
  });
}
