import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "poplog3",
    layer: "debug-health",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "unknown",
  });
}