import { NextResponse } from "next/server";
import {
  getLeavingSoonAvailabilityEvents,
  type LeavingAvailabilityItem,
} from "@/server/streaming/availability-events";

export type LeavingItem = LeavingAvailabilityItem;

export async function GET() {
  const items = await getLeavingSoonAvailabilityEvents();

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600" } },
  );
}
