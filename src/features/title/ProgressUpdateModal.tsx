"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ProgressUpdateModalProps = {
  open: boolean;
  title?: string;
  seasons?: Array<{
    seasonNumber: number;
    name?: string | null;
    episodeCount: number;
  }>;
  loading?: boolean;
  error?: string | null;
  /** Indica se o usuario ja tem episodios marcados — controla visibilidade das acoes destrutivas */
  hasProgress?: boolean;
  /** Serie encerrada (Ended/Canceled) — adapta label do botão de temporada na última temporada */
  isEnded?: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    seasonNumber: number;
    episodeNumber: number;
  }) => void;
  onMarkSeason: (payload: { seasonNumber: number }) => void;
  onMarkAllAired?: () => void;
  onClearProgress: () => void;
  /** Move a serie para Abandonado preservando o progresso */
  onAbandon?: () => void;
};

const DEFAULT_SEASONS = [
  {
    seasonNumber: 1,
    name: "Temporada 1",
    episodeCount: 10,
  },
];

export default function ProgressUpdateModal({
  open,
  title = "Atualizar progresso",
  seasons = DEFAULT_SEASONS,
  loading = false,
  error = null,
  hasProgress = false,
  isEnded = false,
  onClose,
  onConfirm,
  onMarkSeason,
  onMarkAllAired,
  onClearProgress,
  onAbandon,
}: ProgressUpdateModalProps) {
  const [mounted, setMounted] = useState(false);

  const validSeasons = useMemo(
    () => seasons.filter((season) => season.episodeCount > 0),
    [seasons]
  );

  const [selectedSeason, setSelectedSeason] = useState(
    validSeasons[0]?.seasonNumber ?? 1
  );

  const currentSeason =
    validSeasons.find(
      (season) => season.seasonNumber === selectedSeason
    ) ?? validSeasons[0];

  const [selectedEpisode, setSelectedEpisode] = useState(1);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!mounted || !open) return null;

  const lastSeasonNumber = validSeasons[validSeasons.length - 1]?.seasonNumber;
  const isLastSeason = selectedSeason === lastSeasonNumber;
  const markSeasonLabel = isEnded && isLastSeason ? "Assisti tudo" : `Toda T${currentSeason?.seasonNumber ?? ""}`;

  const episodes = Array.from(
    { length: currentSeason?.episodeCount ?? 0 },
    (_, index) => index + 1
  );

  function handleConfirm() {
    if (!currentSeason || !selectedEpisode) return;

    onConfirm({
      seasonNumber: currentSeason.seasonNumber,
      episodeNumber: selectedEpisode,
    });
  }

  function handleMarkSeason() {
    if (!currentSeason) return;

    onMarkSeason({
      seasonNumber: currentSeason.seasonNumber,
    });
  }

  const modal = (
    <div
      className="fixed inset-0 z-[2147483647] isolate flex items-center justify-center bg-black/68 px-4"
      onClick={onClose}
    >
      <div
        className="relative z-[2147483647] w-full max-w-[480px] rounded-3xl border border-white/[0.12] bg-zinc-950 p-5 shadow-[0_24px_72px_rgba(0,0,0,0.64),0_0_0_1px_rgba(255,255,255,0.04)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.10),transparent_52%)]" />

        <div className="relative">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100/50">
                Progresso da serie
              </p>
              <h2 className="mt-0.5 text-lg font-black tracking-[-0.04em] text-white">
                {title}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white"
              aria-label="Fechar"
            >
              {"×"}
            </button>
          </div>

          {/* Season tabs */}
          {validSeasons.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {validSeasons.map((season) => {
                const active = season.seasonNumber === selectedSeason;

                return (
                  <button
                    key={season.seasonNumber}
                    type="button"
                    onClick={() => {
                      setSelectedSeason(season.seasonNumber);
                      setSelectedEpisode(1);
                    }}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs font-bold transition",
                      active
                        ? "border-cyan-200/45 bg-cyan-300/[0.16] text-cyan-50 shadow-[0_8px_20px_rgba(34,211,238,0.10)]"
                        : "border-white/[0.10] bg-white/[0.045] text-white/55 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white",
                    ].join(" ")}
                  >
                    T{season.seasonNumber}
                  </button>
                );
              })}
            </div>
          )}

          {/* Episode grid */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
              {episodes.map((episode) => {
                const active = episode === selectedEpisode;
                const included = episode <= selectedEpisode;

                return (
                  <button
                    key={episode}
                    type="button"
                    onClick={() => setSelectedEpisode(episode)}
                    className={[
                      "h-9 rounded-xl border text-xs font-black transition",
                      active
                        ? "border-cyan-200/60 bg-cyan-200 text-zinc-950 shadow-[0_8px_20px_rgba(34,211,238,0.18)]"
                        : included
                          ? "border-cyan-200/20 bg-cyan-300/[0.10] text-cyan-50/80"
                          : "border-white/[0.07] bg-white/[0.03] text-white/40 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white",
                    ].join(" ")}
                  >
                    E{episode}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-2xl border border-rose-300/18 bg-rose-500/[0.08] px-4 py-3 text-sm font-semibold leading-relaxed text-rose-100/86">
              Falha ao sincronizar: {error}
            </div>
          )}

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between gap-3">
            {/* Acoes destrutivas — so aparecem quando ha progresso */}
            <div className="flex items-center gap-3">
              {hasProgress && (
                <>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={onClearProgress}
                    className="text-xs font-semibold text-white/40 transition hover:text-white/70 disabled:cursor-wait disabled:opacity-50"
                  >
                    Resetar
                  </button>

                  {onAbandon && (
                    <>
                      <span className="text-white/20" aria-hidden>·</span>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={onAbandon}
                        className="text-xs font-semibold text-amber-300/50 transition hover:text-amber-200/80 disabled:cursor-wait disabled:opacity-50"
                      >
                        Abandonar
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Acoes principais */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/[0.10] bg-white/[0.04] px-4 py-2 text-xs font-bold text-white/55 transition hover:bg-white/[0.08] hover:text-white"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={loading || !currentSeason || !onMarkAllAired}
                onClick={onMarkAllAired}
                className="rounded-full border border-emerald-100/[0.18] bg-emerald-300/[0.10] px-4 py-2 text-xs font-black text-emerald-50 transition hover:border-emerald-100/30 hover:bg-emerald-300/[0.16] disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? "..." : "Vi tudo"}
              </button>

              <button
                type="button"
                disabled={loading || !currentSeason}
                onClick={handleMarkSeason}
                className="rounded-full border border-cyan-100/[0.18] bg-cyan-300/[0.10] px-4 py-2 text-xs font-black text-cyan-50 transition hover:border-cyan-100/30 hover:bg-cyan-300/[0.16] disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? "..." : markSeasonLabel}
              </button>

              <button
                type="button"
                disabled={loading || !currentSeason}
                onClick={handleConfirm}
                className="rounded-full border border-cyan-100/30 bg-cyan-200 px-4 py-2 text-xs font-black text-zinc-950 shadow-[0_12px_28px_rgba(34,211,238,0.20)] transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
              >
                {loading
                  ? "Salvando..."
                  : `Marcar T${currentSeason?.seasonNumber ?? ""}E${selectedEpisode}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
