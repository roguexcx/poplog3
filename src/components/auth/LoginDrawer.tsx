"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

type LoginDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  oauthAvailable?: boolean;
};

export default function LoginDrawer({
  open,
  onClose,
  oauthAvailable = false,
}: LoginDrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    if (open) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  async function handleGoogleSignIn() {
    if (!oauthAvailable) {
      setError(
        "Google OAuth não está configurado. " +
        "Defina AUTH_GOOGLE_ID e AUTH_GOOGLE_SECRET no .env.local " +
        "ou use POPLOG_LOCAL_AUTH_ENABLED=true para dev local.",
      );
      return;
    }

    setOauthLoading(true);
    setError(null);

    try {
      await signIn("google", {
        callbackUrl: window.location.href,
        redirect: true,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Ocorreu um erro inesperado.";
      setError(message);
      setOauthLoading(false);
    }
  }

  return (
    <>
      <div
        ref={overlayRef}
        onClick={onClose}
        className={`
          fixed inset-0 z-40
          bg-black/70 backdrop-blur-sm
          transition-opacity duration-300
          ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
        `}
      />

      <div
        className={`
          fixed inset-0 z-50
          flex flex-col
          bg-[rgba(8,8,16,0.98)]
          transition-all duration-300

          md:left-20 md:w-[380px]
          md:border-r md:border-white/[0.06]
          md:backdrop-blur-[24px]
          md:shadow-[4px_0_40px_rgba(0,0,0,0.6)]

          ${open ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-full pointer-events-none"}
        `}
      >
        <div className="flex h-full flex-col overflow-y-auto px-8 py-10">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="
              absolute right-4 top-4
              flex h-9 w-9 items-center justify-center
              rounded-full border border-white/10
              bg-white/5 text-zinc-400
              transition hover:bg-white/10 hover:text-white
              md:hidden
            "
          >
            ✕
          </button>

          <div className="mb-10 mt-4 md:mt-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-[2px] w-6 bg-indigo-500" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-400">
                Acesse sua conta
              </span>
            </div>

            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Bem-vindo de volta.
            </h2>

            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              Continue sua curadoria pessoal de filmes e séries.
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={oauthLoading}
            className="
              mb-4 flex w-full items-center justify-center rounded-xl
              border border-white/[0.08]
              bg-white/[0.96] px-4 py-3
              text-sm font-semibold text-zinc-950
              transition hover:bg-white
              disabled:opacity-50
              active:scale-[0.98]
            "
          >
            {oauthLoading ? "Redirecionando..." : "Continuar com Google"}
          </button>

          {!oauthAvailable && (
            <p className="mb-4 text-center text-[11px] text-zinc-600">
              OAuth não configurado — use modo local dev
            </p>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
