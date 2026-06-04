"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const chipBase =
  "rounded-full border border-white/10 bg-black/25 px-4 py-2 text-xs font-semibold text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md transition hover:bg-white/10 cursor-pointer";

export default function FilterChips() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRandom() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/trending");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const results: { id: number; media_type?: string; linkIdUsed?: string | number; poplogId?: string | number | null }[] = data.results ?? [];
      const eligible = results.filter((r) => r.media_type === "movie" || r.media_type === "tv");
      if (eligible.length === 0) throw new Error("empty");
      const pick = eligible[Math.floor(Math.random() * eligible.length)];
      router.push(`/title/${pick.media_type}/${pick.linkIdUsed ?? pick.poplogId ?? pick.id}`);
    } catch {
      // falha silenciosa
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      <Link href="/filmes" className={chipBase}>
        Filmes
      </Link>
      <Link href="/series" className={chipBase}>
        Séries
      </Link>
      <button
        type="button"
        onClick={handleRandom}
        disabled={loading}
        className={`${chipBase} disabled:opacity-60`}
      >
        {loading ? "Sorteando..." : "Aleatório"}
      </button>
    </div>
  );
}
