// Supabase Edge Function: recalculate-curadoria
// Recalculates priority_score for all watching items of a given user in batch.
// Invoke via: supabase.functions.invoke('recalculate-curadoria', { body: { user_id } })

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Minimal score calculation (mirrors lib/curadoria-engine.ts)
function hoursDiff(dateStr: string | null, now: Date): number {
  if (!dateStr) return Infinity;
  return (now.getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function daysDiff(dateStr: string | null, now: Date): number {
  return hoursDiff(dateStr, now) / 24;
}

function clamp(v: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, v));
}

// deno-lint-ignore no-explicit-any
function scoreItem(item: any, prefs: any, now: Date): number {
  if (item.snoozed_until && now < new Date(item.snoozed_until)) return 0;

  const h = hoursDiff(item.last_watched_at, now);
  let f1 = 0;
  if (h < 6) f1 = 1.0;
  else if (h < 24) f1 = 0.85;
  else if (h < 72) f1 = 0.65;
  else if (h < 168) f1 = 0.40;
  else if (h < 336) f1 = 0.20;
  else if (h < 720) f1 = 0.08;
  if (item.is_marathon) f1 = clamp(f1 * 1.25);

  let f2 = 0;
  if (item.content_type === "filme") {
    const pct = (item.watch_progress_minutes ?? 0) / (item.runtime || 1);
    if (pct > 0.7) f2 = 1.0;
    else if (pct > 0.4) f2 = 0.7;
    else if (pct > 0.1) f2 = 0.4;
  } else {
    const rem = (item.total_episodes_season ?? 0) - (item.episodes_watched ?? 0);
    if (rem === 1) f2 = 1.0;
    else if (rem === 2) f2 = 0.90;
    else if (rem <= 4) f2 = 0.75;
    else if (rem <= 6) f2 = 0.50;
    else if (rem <= 10) f2 = 0.25;
    else f2 = 0.05;
  }

  let f3 = 0;
  if (item.new_episode_available) {
    const hh = hoursDiff(item.new_episode_available_since, now);
    if (hh < 6) f3 = 1.0;
    else if (hh < 24) f3 = 0.90;
    else if (hh < 72) f3 = 0.70;
    else if (hh < 168) f3 = 0.45;
    else f3 = 0.20;
  }

  const streamDate = item.streaming_available_since ?? item.vod_available_since;
  let f4 = 0;
  if (streamDate) {
    const d = daysDiff(streamDate, now);
    if (d < 7) f4 = 1.0;
    else if (d < 14) f4 = 0.80;
    else if (d < 30) f4 = 0.55;
    else if (d < 60) f4 = 0.30;
    else f4 = 0.05;
  }

  const rating = item.user_rating ?? item.tmdb_rating ?? 0;
  const f5 = clamp((rating - 5) / 5);

  const sessionMin = prefs?.preferred_session_duration_minutes ?? 60;
  const remaining =
    item.content_type === "filme"
      ? (item.runtime ?? 90) - (item.watch_progress_minutes ?? 0)
      : item.next_episode_duration ?? 45;
  const ratio = remaining / sessionMin;
  let f6 = 0.05;
  if (ratio <= 0.5) f6 = 1.0;
  else if (ratio <= 1.0) f6 = 0.75;
  else if (ratio <= 1.5) f6 = 0.45;
  else if (ratio <= 2.0) f6 = 0.25;

  const topGenres: string[] = prefs?.top_genres ?? [];
  const itemGenres: string[] = item.genres ?? [];
  const matchCount = itemGenres.filter((g: string) => topGenres.includes(g)).length;
  const f7 =
    topGenres.length === 0 || itemGenres.length === 0
      ? 0.5
      : clamp(matchCount / Math.min(itemGenres.length, 3));

  const heroH = hoursDiff(item.hero_last_shown_at, now);
  let f8Base = 1.0;
  if (item.hero_last_shown_at !== null) {
    if (heroH < 1) f8Base = 0;
    else if (heroH < 6) f8Base = 0.3;
    else if (heroH < 24) f8Base = 0.6;
  }
  const f8 = clamp(f8Base * Math.max(0, 1 - item.hero_shown_count * 0.05));

  const score =
    f1 * 22 + f2 * 20 + f3 * 18 + f4 * 12 + f5 * 10 + f6 * 8 + f7 * 7 + f8 * 8;

  const mult =
    item.status === "watching"
      ? 1.0
      : item.status === "paused"
      ? 0.85
      : item.status === "watchlist"
      ? 0.60
      : item.status === "abandoned"
      ? 0.15
      : 1.0;

  return score * mult;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [watchingRes, prefsRes] = await Promise.all([
      supabase.from("user_watching").select("*").eq("user_id", user_id),
      supabase
        .from("user_curadoria_preferences")
        .select("*")
        .eq("user_id", user_id)
        .maybeSingle(),
    ]);

    if (watchingRes.error) throw watchingRes.error;

    const items = watchingRes.data ?? [];
    const prefs = prefsRes.data;
    const now = new Date();
    const calcAt = now.toISOString();

    const updates = items.map((item) => ({
      id: item.id,
      priority_score: scoreItem(item, prefs, now),
      priority_last_calculated_at: calcAt,
    }));

    // Batch upsert in chunks of 50
    const CHUNK = 50;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("user_watching")
        .upsert(chunk, { onConflict: "id" });
      if (error) throw error;
    }

    return new Response(
      JSON.stringify({ updated: updates.length, calculated_at: calcAt }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
