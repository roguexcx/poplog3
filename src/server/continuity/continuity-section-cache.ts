import { isLocalCacheEnabled } from "@/server/runtime/local-db-flags";

export type ContinuitySectionCacheStatus = "hit" | "stale" | "miss" | "error";

export type ContinuitySectionCacheEntry<T> = {
  payload: T;
  status: Exclude<ContinuitySectionCacheStatus, "miss" | "error">;
  expiresAt: string;
  updatedAt: string;
};

type CacheRow = {
  payload: unknown;
  expires_at: string;
  updated_at: string;
};

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/server/supabase/admin");
  return supabaseAdmin;
}

export async function readContinuitySectionCache<T>(
  sectionKey: string,
  options: {
    userId?: string | null;
    region?: string | null;
    language?: string | null;
  } = {},
): Promise<ContinuitySectionCacheEntry<T> | null> {
  if (isLocalCacheEnabled()) {
    try {
      const local = await import("@/server/local-services/continuity-section-cache-local.service");
      return await local.readContinuitySectionCache<T>(sectionKey, options);
    } catch (error) {
      console.warn("[continuity-section-cache] local read failed, falling back to Supabase", {
        sectionKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const supabaseAdmin = await getSupabaseAdmin();
    let query = supabaseAdmin
      .from("continuity_section_cache")
      .select("payload, expires_at, updated_at")
      .eq("section_key", sectionKey)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (options.userId) query = query.eq("user_id", options.userId);
    else query = query.is("user_id", null);

    if (options.region) query = query.eq("region", options.region);
    else query = query.is("region", null);

    if (options.language) query = query.eq("language", options.language);
    else query = query.is("language", null);

    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;

    const row = data as CacheRow;
    const expiresAtMs = new Date(row.expires_at).getTime();

    return {
      payload: row.payload as T,
      status: Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() ? "hit" : "stale",
      expiresAt: row.expires_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    console.warn("[continuity-section-cache] read failed", {
      sectionKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function writeContinuitySectionCache<T>(input: {
  sectionKey: string;
  userId?: string | null;
  region?: string | null;
  language?: string | null;
  payload: T;
  ttlMs: number;
}) {
  if (isLocalCacheEnabled()) {
    try {
      const local = await import("@/server/local-services/continuity-section-cache-local.service");
      await local.writeContinuitySectionCache(input);
      return;
    } catch (error) {
      console.warn("[continuity-section-cache] local write failed, falling back to Supabase", {
        sectionKey: input.sectionKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMs);

  try {
    const supabaseAdmin = await getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("continuity_section_cache")
      .upsert(
        {
          section_key: input.sectionKey,
          user_id: input.userId ?? null,
          region: input.region ?? null,
          language: input.language ?? null,
          payload: input.payload as Record<string, unknown>,
          expires_at: expiresAt.toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "section_key,user_id,region,language" },
      );

    if (error) {
      console.warn("[continuity-section-cache] write failed", {
        sectionKey: input.sectionKey,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn("[continuity-section-cache] write failed", {
      sectionKey: input.sectionKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function invalidateContinuitySectionCache(userId: string) {
  if (isLocalCacheEnabled()) {
    void import("@/server/local-services/continuity-section-cache-local.service")
      .then((local) => local.invalidateContinuitySectionCacheLocal({ userId }))
      .catch((error) => {
        console.warn("[continuity-section-cache] local invalidation failed, falling back to Supabase", {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        void getSupabaseAdmin().then((supabaseAdmin) => {
          void supabaseAdmin
            .from("continuity_section_cache")
            .delete()
            .eq("user_id", userId)
            .then(({ error: supabaseError }) => {
              if (supabaseError) {
                console.warn("[continuity-section-cache] invalidation failed", {
                  userId,
                  error: supabaseError.message,
                });
              }
            });
        }).catch((supabaseError) => {
          console.warn("[continuity-section-cache] invalidation failed", {
            userId,
            error: supabaseError instanceof Error ? supabaseError.message : String(supabaseError),
          });
        });
      });
    return;
  }

  void getSupabaseAdmin().then((supabaseAdmin) => {
    void supabaseAdmin
      .from("continuity_section_cache")
      .delete()
      .eq("user_id", userId)
      .then(({ error }) => {
        if (error) {
          console.warn("[continuity-section-cache] invalidation failed", {
            userId,
            error: error.message,
          });
        }
      });
  }).catch((error) => {
    console.warn("[continuity-section-cache] invalidation failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
