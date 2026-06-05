import { NextResponse } from "next/server";
import { SHORTCUT_GROUPS } from "@/lib/discovery/shortcuts-config";

export async function GET() {
  return NextResponse.json({ ok: true, groups: SHORTCUT_GROUPS });
}
