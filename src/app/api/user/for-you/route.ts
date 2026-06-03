import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { ok: false, message: "Requires MySQL/Prisma — not yet implemented" },
    { status: 501 },
  );
}
