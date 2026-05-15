"use client";

import { useState } from "react";
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
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
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

const PROVIDERS = [
  { id: "netflix", label: "Netflix", color: "#E50914", icon: "N" },
  { id: "prime", label: "Prime Video", color: "#00A8E0", icon: "P" },
  { id: "disney", label: "Disney+", color: "#113CCF", icon: "D+" },
  { id: "max", label: "Max", color: "#002BE7", icon: "M" },
  { id: "apple", label: "Apple TV+", color: "#555", icon: "▶" },
  { id: "paramount", label: "Paramount+", color: "#0064FF", icon: "P+" },
  { id: "globoplay", label: "Globoplay", color: "#E5004C", icon: "G" },
  { id: "mubi", label: "MUBI", color: "#22A8C5", icon: "M" },
];

function StreamingProviderCard({
  provider,
  active,
  onToggle,
}: {
  provider: (typeof PROVIDERS)[0];
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`relative flex flex-col items-center justify-center gap-2 rounded-xl p-4 border transition-all duration-200 ${
        active
          ? "border-white/[0.15] bg-white/[0.06]"
          : "border-white/[0.04] bg-white/[0.015] opacity-50"
      }`}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
        style={{ backgroundColor: active ? provider.color : "#333" }}
      >
        {provider.icon}
      </div>
      <span className="text-[11px] text-white/70 font-medium leading-tight text-center">
        {provider.label}
      </span>
      {active && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400" />
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
  const [activeProviders, setActiveProviders] = useState<Set<string>>(
    new Set(["netflix", "prime"])
  );

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

  function toggleProvider(id: string) {
    setActiveProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
          <p className="text-xs text-white/40 mb-4">
            Selecione os serviços que você assina para recomendações personalizadas.
          </p>
          <div className="grid grid-cols-4 gap-3">
            {PROVIDERS.map((p) => (
              <StreamingProviderCard
                key={p.id}
                provider={p}
                active={activeProviders.has(p.id)}
                onToggle={() => toggleProvider(p.id)}
              />
            ))}
          </div>
          <p className="text-[11px] text-white/30 mt-4">
            {activeProviders.size} serviço{activeProviders.size !== 1 ? "s" : ""} ativo
            {activeProviders.size !== 1 ? "s" : ""}
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
            <svg className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm11 4.414l-4.707 4.707a1 1 0 01-1.414-1.414L11.586 7H7a1 1 0 110-2h6a1 1 0 011 1v6a1 1 0 11-2 0V8.414z" clipRule="evenodd" />
            </svg>
          </button>
          <button className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-red-500/[0.05] border border-red-500/[0.12] hover:bg-red-500/[0.1] transition-colors group">
            <span className="text-sm text-red-400/80 group-hover:text-red-400 transition-colors">
              Excluir conta permanentemente
            </span>
            <svg className="w-4 h-4 text-red-500/40 group-hover:text-red-500/70 transition-colors" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
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
