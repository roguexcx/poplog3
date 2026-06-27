import { NextRequest, NextResponse } from "next/server";
import { getPersonPageData } from "@/server/poplog-people/getPersonPageData";
import { toLegacyCredit, toLegacyPerson } from "@/server/poplog-people/legacy-person-adapter";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing person id" }, { status: 400 });
  }

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const data = await getPersonPageData({
    id,
    language: "pt-BR",
    region: "BR",
    forceRefresh,
  });

  if (!data.person) {
    return NextResponse.json(
      { ok: false, error: "Person not found", person: null, meta: data.meta },
      { status: 404 }
    );
  }

  // Contrato legado preservado: person snake_case, acting + crew achatado.
  // Campos novos aditivos: credits (buckets camelCase) e meta (cache/fontes).
  const crew = [
    ...data.directing,
    ...data.writing,
    ...data.producing,
    ...data.otherCrew,
  ];

  return NextResponse.json({
    ok: true,
    person: toLegacyPerson(data.person),
    acting: data.acting.map(toLegacyCredit),
    crew: crew.map(toLegacyCredit),
    credits: {
      acting: data.acting,
      directing: data.directing,
      writing: data.writing,
      producing: data.producing,
      otherCrew: data.otherCrew,
    },
    meta: data.meta,
  });
}
