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
  onClose: () => void;
  onConfirm: (payload: {
    seasonNumber: number;
    episodeNumber: number;
  }) => void;
  onMarkSeason: (payload: { seasonNumber: number }) => void;
  onClearProgress: () => void;
  /** Opcional: move a serie para Abandonado preservando o progresso */
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
  onClose,
  onConfirm,
  onMarkSeason,
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
      className="fixed inset-0 z-[2147483647] isolate flex items-center justify-center bg-black/78 px-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative z-[2147483647] w-full max-w-[520px] rounded-3xl border border-white/[0.12] bg-zinc-950/95 p-5 shadow-[0_40px_120px_rgba(0,0,0,0.78),0_0_0_1px_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.08)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.14),transparent_48%)]" />

        <div className="relative">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100/55">
                Progresso da serie
              </p>

              <h2 className="mt-1 text-xl font-black tracking-[-0.04em] text-white">
                {title}
              </h2>

              <p className="mt-1.5 text-sm font-medium leading-relaxed text-white/54">
                Escolha ate qual episodio voce assistiu. O POPLOG marca tudo
                ate ali e atualiza sua continuidade.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.04] text-white/60 transition hover:bg-white/[0.08] hover:text-white"
              aria-label="Fechar"
            >
              {"×"}
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
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
                    "rounded-full border px-3.5 py-2 text-xs font-bold transition",
                    active
                      ? "border-cyan-200/45 bg-cyan-300/[0.16] text-cyan-50 shadow-[0_10px_28px_rgba(34,211,238,0.12)]"
                      : "border-white/[0.10] bg-white/[0.045] text-white/58 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white",
                  ].join(" ")}
                >
                  T{season.seasonNumber}
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-white/[0.10] bg-white/[0.035] p-3">
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
              {episodes.map((episode) => {
                const active = episode === selectedEpisode;
                const included = episode <= selectedEpisode;

                return (
                  <button
                    key={episode}
                    type="button"
                    onClick={() => setSelectedEpisode(episode)}
                    className={[
                      "h-10 rounded-xl border text-xs font-black transition",
                      active
                        ? "border-cyan-200/60 bg-cyan-200 text-zinc-950 shadow-[0_12px_28px_rgba(34,211,238,0.20)]"
                        : included
                          ? "border-cyan-200/24 bg-cyan-300/[0.12] text-cyan-50"
                          : "border-white/[0.08] bg-white/[0.035] text-white/48 hover:border-white/[0.18] hover:bg-white/[0.065] hover:text-white",
                    ].join(" ")}
                  >
                    E{episode}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-cyan-200/[0.12] bg-cyan-950/[0.14] px-4 py-3 text-sm font-semibold text-cyan-50/78">
            Marcar ate:{" "}
            <span className="text-cyan-50">
              T{currentSeason?.seasonNumber}E{selectedEpisode}
            </span>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-300/18 bg-rose-500/[0.08] px-4 py-3 text-sm font-semibold leading-relaxed text-rose-100/86">
              Falha ao sincronizar: {error}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={loading}
              onClick={onClearProgress}
              className="flex-1 rounded-2xl border border-white/[0.09] bg-white/[0.035] px-4 py-3 text-left text-sm font-bold text-white/60 transition hover:border-white/[0.16] hover:bg-white/[0.065] hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              Ainda nao assisti
            </button>

            {onAbandon && (
              <button
                type="button"
                disabled={loading}
                onClick={onAbandon}
                className="flex-1 rounded-2xl border border-amber-300/[0.14] bg-amber-500/[0.06] px-4 py-3 text-left text-sm font-bold text-amber-200/70 transition hover:border-amber-300/[0.25] hover:bg-amber-500/[0.12] hover:text-amber-100 disabled:cursor-wait disabled:opacity-60"
              >
                Abandonar serie
              </button>
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/[0.10] bg-white/[0.04] px-5 py-2.5 text-sm font-bold text-white/62 transition hover:bg-white/[0.08] hover:text-white"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={loading || !currentSeason}
              onClick={handleMarkSeason}
              className="rounded-full border border-cyan-100/[0.18] bg-cyan-300/[0.10] px-5 py-2.5 text-sm font-black text-cyan-50 shadow-[0_14px_34px_rgba(34,211,238,0.12)] transition hover:border-cyan-100/32 hover:bg-cyan-300/[0.16] disabled:cursor-wait disabled:opacity-60"
            >
              {loading
                ? "Salvando..."
                : `Marcar temporada T${currentSeason?.seasonNumber ?? ""}`}
            </button>

            <button
              type="button"
              disabled={loading || !currentSeason}
              onClick={handleConfirm}
              className="rounded-full border border-cyan-100/30 bg-cyan-200 px-5 py-2.5 text-sm font-black text-zinc-950 shadow-[0_16px_38px_rgba(34,211,238,0.22)] transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
            >
              {loading
                ? "Salvando..."
                : `Marcar ate T${currentSeason?.seasonNumber ?? ""}E${selectedEpisode}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
