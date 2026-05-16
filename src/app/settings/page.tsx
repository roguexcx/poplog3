"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

// ── Primitives ────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        checked ? "bg-indigo-500" : "bg-white/[0.12]"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-1.5 pr-8 text-sm text-white/80 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#0f0f13] text-white">
            {o.label}
          </option>
        ))}
      </select>

      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
        <svg className="w-3.5 h-3.5 text-white/40" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  );
}

function SettingsCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/[0.025] border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-white/[0.05]">
        <p className="text-[9.5px] tracking-[0.22em] uppercase text-indigo-400/80 font-medium mb-1">
          {eyebrow}
        </p>
        <h2 className="text-base font-bold text-white tracking-tight">{title}</h2>
      </div>

      <div className="divide-y divide-white/[0.04]">{children}</div>
    </div>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4">
      <div className="min-w-0">
        <p className="text-sm text-white/90 font-medium">{label}</p>
        {description && (
          <p className="text-xs text-white/40 mt-0.5 leading-snug">{description}</p>
        )}
      </div>

      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Streaming providers ───────────────────────────────────────────────────────

type StreamingProvider = {
  id: string;
  provider_name: string;
  provider_slug: string;
  logo_url: string | null;
  tmdb_provider_id: number | null;
  country: string;
  is_active: boolean;
};

type StreamingPreference = {
  provider_id: string;
  country: string;
  is_enabled: boolean;
  priority_order: number;
};

type StreamingPreferencesResponse = {
  ok: boolean;
  providers?: StreamingProvider[];
  preferences?: StreamingPreference[];
  error?: string;
};

function getProviderLogoUrl(logoUrl: string | null) {
  if (!logoUrl) return null;
  if (logoUrl.startsWith("http")) return logoUrl;
  return `https://image.tmdb.org/t/p/w200${logoUrl}`;
}

function StreamingProviderCard({
  provider,
  active,
  priority,
  disabled,
  onToggle,
}: {
  provider: StreamingProvider;
  active: boolean;
  priority: number | null;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const logoUrl = getProviderLogoUrl(provider.logo_url);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`relative flex min-h-[106px] flex-col items-center justify-center gap-2 rounded-xl border p-4 transition-all duration-200 ${
        active
          ? "border-indigo-300/25 bg-indigo-400/[0.08] shadow-[0_0_22px_rgba(99,102,241,0.10)]"
          : "border-white/[0.04] bg-white/[0.015] opacity-55 hover:opacity-80"
      } ${disabled ? "cursor-wait" : "cursor-pointer"}`}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={provider.provider_name}
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-xs font-black text-white/50">
          {provider.provider_name.slice(0, 2).toUpperCase()}
        </div>
      )}

      <span className="line-clamp-2 text-center text-[11px] font-medium leading-tight text-white/70">
        {provider.provider_name}
      </span>

      {active && (
        <>
          <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-400" />

          {priority !== null && (
            <div className="absolute left-2 top-2 rounded-full border border-white/[0.08] bg-black/35 px-1.5 py-0.5 text-[9px] font-bold text-white/60">
              #{priority}
            </div>
          )}
        </>
      )}
    </button>
  );
}

// ── Score mode selector ───────────────────────────────────────────────────────

const SCORE_MODES = ["POPLOG", "TMDB", "IMDb", "Metacritic"] as const;
type ScoreMode = (typeof SCORE_MODES)[number];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();

  // Streamings
  const [providers, setProviders] = useState<StreamingProvider[]>([]);
  const [activeProviders, setActiveProviders] = useState<string[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [savingProviders, setSavingProviders] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // Idioma & Região
  const [language, setLanguage] = useState("pt-BR");
  const [region, setRegion] = useState("BR");
  const [showOriginalTitles, setShowOriginalTitles] = useState(false);

  // Notificações
  const [notifNewEpisode, setNotifNewEpisode] = useState(true);
  const [notifStreaming, setNotifStreaming] = useState(true);
  const [notifFullSeason, setNotifFullSeason] = useState(false);
  const [notifVod, setNotifVod] = useState(false);
  const [notifSeriesBack, setNotifSeriesBack] = useState(true);
  const [notifReminders, setNotifReminders] = useState(false);

  // Preferências
  const [autoMarkWatched, setAutoMarkWatched] = useState(false);
  const [showSpoilers, setShowSpoilers] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [animationsReduced, setAnimationsReduced] = useState(false);
  const [adultContent, setAdultContent] = useState(false);
  const [scoreMode, setScoreMode] = useState<ScoreMode>("POPLOG");

  const orderedProviders = useMemo(() => {
    const activeIndex = new Map(activeProviders.map((id, index) => [id, index]));

    return [...providers].sort((a, b) => {
      const aIndex = activeIndex.get(a.id);
      const bIndex = activeIndex.get(b.id);

      const aActive = typeof aIndex === "number";
      const bActive = typeof bIndex === "number";

      if (aActive && bActive) return aIndex! - bIndex!;
      if (aActive) return -1;
      if (bActive) return 1;

      return a.provider_name.localeCompare(b.provider_name);
    });
  }, [providers, activeProviders]);

  useEffect(() => {
    async function loadStreamingPreferences() {
      try {
        setLoadingProviders(true);
        setProvidersError(null);

        const res = await fetch("/api/user/streaming-preferences", {
          cache: "no-store",
        });

        const data = (await res.json()) as StreamingPreferencesResponse;

        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? "Falha ao carregar streamings.");
        }

        const nextProviders = data.providers ?? [];
        const nextPreferences = data.preferences ?? [];

        const enabledPreferences = nextPreferences
          .filter((preference) => preference.is_enabled)
          .sort((a, b) => a.priority_order - b.priority_order)
          .map((preference) => preference.provider_id);

        setProviders(nextProviders);
        setActiveProviders(enabledPreferences);
      } catch (error) {
        console.error("[settings/providers]", error);
        setProvidersError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os streamings."
        );
      } finally {
        setLoadingProviders(false);
      }
    }

    loadStreamingPreferences();
  }, []);

  async function saveProviderPreferences(providerIds: string[]) {
    setSavingProviders(true);
    setProvidersError(null);

    try {
      const res = await fetch("/api/user/streaming-preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerIds,
          country: region,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Falha ao salvar streamings.");
      }
    } catch (error) {
      console.error("[settings/providers/save]", error);
      setProvidersError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar suas preferências."
      );
    } finally {
      setSavingProviders(false);
    }
  }

  function toggleProvider(id: string) {
    setActiveProviders((prev) => {
      const next = prev.includes(id)
        ? prev.filter((providerId) => providerId !== id)
        : [...prev, id];

      void saveProviderPreferences(next);

      return next;
    });
  }

  async function handleSignOut() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    await supabase.auth.signOut();

    router.push("/");
    router.refresh();
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* Page header */}
      <div className="mb-8">
        <p className="text-[9.5px] tracking-[0.22em] uppercase text-indigo-400/80 font-medium mb-2">
          Conta
        </p>

        <h1 className="text-3xl font-black tracking-[-0.03em] text-white">
          Configurações
        </h1>

        <p className="text-sm text-white/40 mt-1">
          Personalize sua experiência no POPLOG
        </p>
      </div>

      {/* ── Streamings ── */}
      <SettingsCard eyebrow="Provedores" title="Streamings conectados">
        <div className="px-6 py-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-white/40">
                Selecione os serviços que você assina para recomendações personalizadas.
              </p>

              <p className="mt-1 text-[11px] text-white/25">
                A ordem dos ativos define prioridade na Página de Título, Home e Agenda.
              </p>
            </div>

            <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-white/45">
              {savingProviders ? "Salvando..." : "Auto-save"}
            </span>
          </div>

          {loadingProviders ? (
            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="h-[106px] animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.025]"
                />
              ))}
            </div>
          ) : providersError ? (
            <div className="rounded-xl border border-red-500/15 bg-red-500/[0.06] px-4 py-3">
              <p className="text-xs text-red-200/80">{providersError}</p>
            </div>
          ) : orderedProviders.length > 0 ? (
            <div className="grid grid-cols-4 gap-3">
              {orderedProviders.map((provider) => {
                const activeIndex = activeProviders.indexOf(provider.id);
                const active = activeIndex >= 0;

                return (
                  <StreamingProviderCard
                    key={provider.id}
                    provider={provider}
                    active={active}
                    priority={active ? activeIndex + 1 : null}
                    disabled={savingProviders}
                    onToggle={() => toggleProvider(provider.id)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
              <p className="text-xs text-white/40">
                Nenhum provider ativo encontrado para a região selecionada.
              </p>
            </div>
          )}

          <p className="text-[11px] text-white/30 mt-4">
            {activeProviders.length} serviço{activeProviders.length !== 1 ? "s" : ""} ativo
            {activeProviders.length !== 1 ? "s" : ""}
          </p>
        </div>
      </SettingsCard>

      {/* ── Idioma & Região ── */}
      <SettingsCard eyebrow="Localização" title="Idioma & Região">
        <SettingsRow
          label="Idioma da interface"
          description="Idioma exibido nos menus e textos do app"
        >
          <Select
            value={language}
            onChange={setLanguage}
            options={[
              { label: "Português (BR)", value: "pt-BR" },
              { label: "English (US)", value: "en-US" },
              { label: "Español", value: "es" },
              { label: "Français", value: "fr" },
            ]}
          />
        </SettingsRow>

        <SettingsRow
          label="Região"
          description="Usada para filmes em cartaz e calendário de estreias"
        >
          <Select
            value={region}
            onChange={setRegion}
            options={[
              { label: "Brasil", value: "BR" },
              { label: "Estados Unidos", value: "US" },
              { label: "Reino Unido", value: "GB" },
              { label: "Portugal", value: "PT" },
              { label: "Argentina", value: "AR" },
            ]}
          />
        </SettingsRow>

        <SettingsRow
          label="Títulos originais"
          description="Exibir o título original em vez da tradução"
        >
          <Toggle
            checked={showOriginalTitles}
            onChange={setShowOriginalTitles}
            label="Títulos originais"
          />
        </SettingsRow>
      </SettingsCard>

      {/* ── Notificações ── */}
      <SettingsCard eyebrow="Alertas" title="Notificações">
        <SettingsRow
          label="Novo episódio disponível"
          description="Quando um episódio de série que você acompanha estrear"
        >
          <Toggle checked={notifNewEpisode} onChange={setNotifNewEpisode} />
        </SettingsRow>

        <SettingsRow
          label="Chegou no streaming"
          description="Quando um título da sua lista chegar em algum serviço que você assina"
        >
          <Toggle checked={notifStreaming} onChange={setNotifStreaming} />
        </SettingsRow>

        <SettingsRow
          label="Temporada completa"
          description="Quando a temporada inteira de uma série for lançada de uma vez"
        >
          <Toggle checked={notifFullSeason} onChange={setNotifFullSeason} />
        </SettingsRow>

        <SettingsRow
          label="Disponível no VOD"
          description="Quando um filme estrear para aluguel ou compra digital"
        >
          <Toggle checked={notifVod} onChange={setNotifVod} />
        </SettingsRow>

        <SettingsRow
          label="Série voltou"
          description="Quando uma série pausada retomar com nova temporada"
        >
          <Toggle checked={notifSeriesBack} onChange={setNotifSeriesBack} />
        </SettingsRow>

        <SettingsRow
          label="Lembretes de estreia"
          description="Aviso 1 dia antes de uma estreia na sua lista"
        >
          <Toggle checked={notifReminders} onChange={setNotifReminders} />
        </SettingsRow>
      </SettingsCard>

      {/* ── Preferências ── */}
      <SettingsCard eyebrow="Display" title="Preferências de exibição">
        <SettingsRow
          label="Marcar como visto automaticamente"
          description="Marcar episódios como assistidos ao pausar no final"
        >
          <Toggle checked={autoMarkWatched} onChange={setAutoMarkWatched} />
        </SettingsRow>

        <SettingsRow
          label="Mostrar spoilers"
          description="Exibir sinopses detalhadas e descrições de episódios"
        >
          <Toggle checked={showSpoilers} onChange={setShowSpoilers} />
        </SettingsRow>

        <SettingsRow
          label="Modo compacto"
          description="Reduzir espaçamento e mostrar mais itens por tela"
        >
          <Toggle checked={compactMode} onChange={setCompactMode} />
        </SettingsRow>

        <SettingsRow
          label="Reduzir animações"
          description="Desativar transições e efeitos visuais intensos"
        >
          <Toggle checked={animationsReduced} onChange={setAnimationsReduced} />
        </SettingsRow>

        <SettingsRow
          label="Conteúdo adulto"
          description="Incluir títulos com classificação adulta nas buscas"
        >
          <Toggle checked={adultContent} onChange={setAdultContent} />
        </SettingsRow>

        <SettingsRow
          label="Nota de referência"
          description="Qual pontuação exibir nos cards e na página de título"
        >
          <div className="flex gap-1">
            {SCORE_MODES.map((m) => (
              <button
                key={m}
                onClick={() => setScoreMode(m)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  scoreMode === m
                    ? "bg-indigo-500 text-white"
                    : "bg-white/[0.06] text-white/50 hover:bg-white/[0.1]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsCard>

      {/* ── Conta ── */}
      <SettingsCard eyebrow="Perfil" title="Gerenciamento de conta">
        <SettingsRow label="E-mail" description="Alterar endereço de e-mail associado">
          <button className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
            Alterar →
          </button>
        </SettingsRow>

        <SettingsRow label="Senha" description="Atualizar senha de acesso">
          <button className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
            Alterar →
          </button>
        </SettingsRow>

        <SettingsRow
          label="Exportar dados"
          description="Baixar sua biblioteca completa em formato JSON"
        >
          <button className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
            Exportar →
          </button>
        </SettingsRow>

        <SettingsRow
          label="Sessões ativas"
          description="Ver e encerrar sessões em outros dispositivos"
        >
          <button className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
            Gerenciar →
          </button>
        </SettingsRow>

        {/* Danger zone */}
        <div className="px-6 py-5 space-y-3 bg-red-500/[0.03] border-t border-red-500/[0.08]">
          <p className="text-[9.5px] tracking-[0.22em] uppercase text-red-400/60 font-medium mb-3">
            Zona de perigo
          </p>

          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-colors group"
          >
            <span className="text-sm text-white/70 group-hover:text-white/90 transition-colors">
              Sair da conta
            </span>

            <svg
              className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm11 4.414l-4.707 4.707a1 1 0 01-1.414-1.414L11.586 7H7a1 1 0 110-2h6a1 1 0 011 1v6a1 1 0 11-2 0V8.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          <button className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-red-500/[0.05] border border-red-500/[0.12] hover:bg-red-500/[0.1] transition-colors group">
            <span className="text-sm text-red-400/80 group-hover:text-red-400 transition-colors">
              Excluir conta permanentemente
            </span>

            <svg
              className="w-4 h-4 text-red-500/40 group-hover:text-red-500/70 transition-colors"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </SettingsCard>

      {/* Footer */}
      <p className="text-center text-[11px] text-white/20 pb-4">
        POPLOG v3.0 · build 2025
      </p>
    </div>
  );
}