import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/server/supabase/admin";

export async function GET() {
  const ids = [257994, 94954, 245318, 126027, 67482];

  const { data, error } = await supabaseAdmin
    .from("poplog3_titles")
    .select("*")
    .limit(10);

  if (error) {
    return NextResponse.json({
      ok: false,
      error,
    });
  }

  return NextResponse.json({
    ok: true,
    searchedIds: ids,
    rows: data,
    columns: data?.[0] ? Object.keys(data[0]) : [],
  });
}