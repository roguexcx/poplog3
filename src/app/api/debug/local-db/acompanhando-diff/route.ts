import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      removed: true,
      message: "Rota de diff removida. Use /api/poplog3/acompanhando diretamente.",
    },
    { status: 410 },
  );
}
