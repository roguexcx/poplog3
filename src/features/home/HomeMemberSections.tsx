"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ContinueWatchingSection from "@/features/home/ContinueWatchingSection";
import ForYouSection from "@/features/home/ForYouSection";
import WatchlistVivaSection from "@/features/home/components/WatchlistVivaSection";

import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";

type MemberDataState = "loading" | "empty" | "has-data";

function MemberSectionsSkeleton() {
  return (
    <>
      <section id="continue-watching">
        <div className="mb-5">
          <div className="h-7 w-56 animate-pulse rounded-full bg-white/5" />
          <div className="mt-2 h-4 w-80 animate-pulse rounded-full bg-white/5" />
        </div>

        <div className="-mx-6 flex gap-4 overflow-hidden px-6 pb-4 pt-3 md:-mx-10 md:px-10">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-[230px] w-[285px] shrink-0 animate-pulse rounded-[1.6rem] bg-white/5"
            />
          ))}
        </div>
      </section>

      <section id="for-you">
        <div className="mb-5">
          <div className="h-7 w-40 animate-pulse rounded-full bg-white/5" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded-full bg-white/5" />
        </div>

        <div className="hidden gap-5 lg:grid lg:grid-cols-[2.05fr_repeat(4,0.72fr)]">
          <div className="h-[320px] animate-pulse rounded-[1.65rem] bg-white/5" />
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-[320px] animate-pulse rounded-[1.35rem] bg-white/5"
            />
          ))}
        </div>

        <div className="-mx-6 flex gap-4 overflow-hidden px-6 pb-2 lg:hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-[260px] w-[180px] shrink-0 animate-pulse rounded-[1.35rem] bg-white/5"
            />
          ))}
        </div>
      </section>
    </>
  );
}

function EmptyMemberHome() {
  return (
    <section
      id="continue-watching"
      className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.35)] md:p-8"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.26),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(56,189,248,0.18),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.07),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#020617]/10 via-[#020617]/70 to-[#020617]" />

      <div className="relative z-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          <div className="mb-4 inline-flex rounded-full border border-sky-300/20 bg-sky-300/[0.08] px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-sky-200">
            Sua curadoria começa aqui
          </div>

          <h2 className="max-w-2xl text-3xl font-black tracking-tight text-white md:text-5xl">
            Comece seu POPLOG
          </h2>

          <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-300 md:text-base">
            Salve alguns filmes, marque o que já viu e sua HOME começa a ganhar
            blocos pessoais, recomendações vivas e atalhos para continuar suas
            séries.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/buscar"
              className="rounded-full bg-white px-5 py-3 text-sm font-black text-[#020617] transition hover:scale-[1.03] hover:bg-sky-100"
            >
              Buscar um título
            </Link>

            <a
              href="#trending"
              className="rounded-full border border-white/15 bg-black/35 px-5 py-3 text-sm font-bold text-white transition hover:scale-[1.03] hover:border-sky-300/35 hover:bg-white/10"
            >
              Explorar em alta
            </a>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur-xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-300">
              01
            </p>
            <h3 className="mt-2 text-sm font-bold text-white">
              Marque o que já viu
            </h3>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Isso ajuda o sistema a entender seu gosto.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur-xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">
              02
            </p>
            <h3 className="mt-2 text-sm font-bold text-white">
              Monte sua watchlist
            </h3>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Guarde títulos para decidir depois sem perder nada.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur-xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
              03
            </p>
            <h3 className="mt-2 text-sm font-bold text-white">
              Receba recomendações
            </h3>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Sua página fica mais inteligente conforme você usa.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

async function checkMemberHasData(userId: string): Promise<MemberDataState> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("user_titles")
    .select("id")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    console.error("Erro ao verificar dados do usuário na Home:", error);
    return "empty";
  }

  return data && data.length > 0 ? "has-data" : "empty";
}

export default function HomeMemberSections() {
  const { user, loading: authLoading } = useAuth();
  const [dataState, setDataState] = useState<MemberDataState>("loading");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadMemberState(showSkeleton = true) {
      if (!user?.id) {
        setDataState("empty");
        return "empty" as MemberDataState;
      }

      if (showSkeleton) {
        setDataState("loading");
      }

      const result = await checkMemberHasData(user.id);

      if (!active) return result;

      setDataState(result);

      return result;
    }

    loadMemberState();

    async function handleUserTitlesUpdated() {
      const result = await loadMemberState(false);

      if (!active) return;

      if (result === "has-data") {
        setRefreshKey((current) => current + 1);
      }
    }

    window.addEventListener("poplog:user-titles-updated", handleUserTitlesUpdated);

    return () => {
      active = false;
      window.removeEventListener(
        "poplog:user-titles-updated",
        handleUserTitlesUpdated,
      );
    };
  }, [user?.id]);

  if (authLoading) {
    return <MemberSectionsSkeleton />;
  }

  if (!user) {
    return null;
  }

  if (dataState === "loading") {
    return <MemberSectionsSkeleton />;
  }

  if (dataState === "empty") {
    return <EmptyMemberHome />;
  }

  return (
    <>
      <div id="continue-watching">
        <ContinueWatchingSection key={`continue-${user.id}-${refreshKey}`} />
      </div>

      <div id="for-you">
        <ForYouSection key={`for-you-${user.id}-${refreshKey}`} />
      </div>

      <div id="watchlist">
        <WatchlistVivaSection key={`watchlist-${user.id}-${refreshKey}`} />
      </div>
    </>
  );
}

// ... seu código anterior ...

// src/features/home/HomeMemberSections.tsx

export default function HomeMemberSections() {
  const { user, loading: authLoading } = useAuth();
  const [dataState, setDataState] = useState<MemberDataState>("loading");

  // ... (mantenha seu useEffect)

  // 1. Prioridade: Se está carregando a auth, mostre skeleton
  if (authLoading) return <MemberSectionsSkeleton />;

  // 2. Se a auth terminou e não tem usuário, mostre o banner de incentivo
  if (!user) return <EmptyMemberHome />;

  // 3. Se tem usuário, mas ainda estamos buscando os títulos dele no banco
  if (dataState === "loading") return <MemberSectionsSkeleton />;

  // 4. Se o usuário está logado mas não salvou nada ainda (vazio)
  if (dataState === "empty") return <EmptyMemberHome />;

  // 5. Sucesso: Usuário logado e com dados salvos
  return (
    <>
      <ContinueWatchingSection key={`continue-${user.id}-${refreshKey}`} />
      <ForYouSection key={`for-you-${user.id}-${refreshKey}`} />
      <WatchlistVivaSection key={`watchlist-${user.id}-${refreshKey}`} />
    </>
  );
}