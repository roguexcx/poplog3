"use client";

import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";

export default function DebugWatchlistPage() {
  const watchlist = useWatchlistToggle({
    tmdbId: 550,
    mediaType: "movie",
    title: "Clube da Luta",
    releaseYear: 1999,
  });

  return (
    <main className="min-h-screen bg-slate-950 p-10 text-white">
      <h1 className="text-3xl font-black">Debug watchlist</h1>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
        <p>Status: {watchlist.inWatchlist ? "Na watchlist" : "Fora da watchlist"}</p>
        <p>Login: {watchlist.isLoggedIn ? "Logado" : "Deslogado"}</p>

        <button
          type="button"
          onClick={watchlist.toggle}
          disabled={watchlist.loading || watchlist.saving || !watchlist.isLoggedIn}
          className="mt-5 rounded-xl bg-white px-5 py-3 font-bold text-black disabled:opacity-40"
        >
          {watchlist.saving
            ? "Salvando..."
            : watchlist.inWatchlist
              ? "Remover da watchlist"
              : "Adicionar à watchlist"}
        </button>
      </div>
    </main>
  );
}