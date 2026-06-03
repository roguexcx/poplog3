import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      removed: true,
      message: "Supabase foi removido. Use /api/debug/health para verificar o banco MySQL/Prisma.",
    },
    { status: 410 },
  );
}
