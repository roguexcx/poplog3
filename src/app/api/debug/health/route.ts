import { NextResponse } from "next/server";
import { getTraktClientStatus } from "@/server/api-clients/trakt/client";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "poplog3",
    layer: "debug-health",
    trakt: getTraktClientStatus(),
    timestamp: new Date().toISOString(),
  });
}
