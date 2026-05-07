"use client";

import { useUserTitles } from "@/hooks/useUserTitles";

export default function DebugLibraryPage() {
  const { titles, loading } = useUserTitles();

  return (
    <main className="min-h-screen bg-slate-950 p-10 text-white">
      <h1 className="text-3xl font-black">
        Biblioteca do usuário
      </h1>

      {loading ? (
        <p className="mt-6 text-zinc-400">
          Carregando títulos...
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {titles.map((title) => (
            <div
              key={title.id}
              className="rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <p className="font-bold">
                {title.title}
              </p>

              <p className="text-sm text-zinc-400">
                {title.media_type} • {title.status}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}