import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/server/supabase/server";

type PreferencePayload = {
  providerIds?: string[];
  country?: string;
};

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: providers, error: providersError } = await supabase
    .from("streaming_providers")
    .select("id, provider_name, provider_slug, logo_url, tmdb_provider_id, country, is_active")
    .eq("is_active", true)
    .eq("country", "BR")
    .not("tmdb_provider_id", "is", null)
    .order("provider_name", { ascending: true });

  if (providersError) {
    return NextResponse.json(
      { ok: false, error: providersError.message },
      { status: 500 }
    );
  }

  const { data: preferences, error: preferencesError } = await supabase
    .from("user_streaming_preferences")
    .select("provider_id, country, is_enabled, priority_order")
    .eq("user_id", user.id)
    .eq("country", "BR")
    .order("priority_order", { ascending: true });

  if (preferencesError) {
    return NextResponse.json(
      { ok: false, error: preferencesError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    providers: providers ?? [],
    preferences: preferences ?? [],
  });
}

export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PreferencePayload;
  const country = body.country ?? "BR";
  const providerIds = body.providerIds ?? [];

  const { error: disableError } = await supabase
    .from("user_streaming_preferences")
    .update({
      is_enabled: false,
      priority_order: 999,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("country", country);

  if (disableError) {
    return NextResponse.json(
      { ok: false, error: disableError.message },
      { status: 500 }
    );
  }

  if (providerIds.length > 0) {
    const rows = providerIds.map((providerId, index) => ({
      user_id: user.id,
      provider_id: providerId,
      country,
      is_enabled: true,
      priority_order: index + 1,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("user_streaming_preferences")
      .upsert(rows, {
        onConflict: "user_id,provider_id,country",
      });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}