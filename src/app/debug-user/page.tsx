"use client";

import { useUser } from "@/hooks/useUser";

export default function DebugUserPage() {
  const { user, loading, isLoggedIn } = useUser();

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 p-10 text-white">
        Carregando usuário...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-10 text-white">
      <h1 className="text-3xl font-black">Debug usuário</h1>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
        <p>Logado: {isLoggedIn ? "Sim" : "Não"}</p>
        <p>Email: {user?.email ?? "Nenhum"}</p>
        <p>ID: {user?.id ?? "Nenhum"}</p>
      </div>
    </main>
  );
}