"use client";

// src/components/auth/LoginDrawer.tsx
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type LoginDrawerProps = {
  open: boolean;
  onClose: () => void;
};

type Mode = "login" | "signup" | "forgot";

export default function LoginDrawer({ open, onClose }: LoginDrawerProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset state when drawer opens
  useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(null);
      setEmail("");
      setPassword("");
      setMode("login");
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const supabase = createClient();

    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        });
        if (error) throw error;
        setSuccess("Link de recuperação enviado para o seu e-mail.");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess("Conta criada! Verifique seu e-mail para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        onClose(); // success → close drawer, useAuth reacts automatically
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Ocorreu um erro inesperado.";
      setError(translateError(message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        onClick={onClose}
        className={`
          fixed inset-0 z-40 bg-black/60 backdrop-blur-sm
          transition-opacity duration-300
          ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
        `}
      />

      {/* Drawer panel — fullscreen no mobile, drawer lateral no desktop */}
      <div
        className={[
          "fixed z-50 flex flex-col",
          // Mobile: fullscreen
          "inset-0",
          // Desktop: drawer lateral após a sidebar colapsada (80px)
          "md:inset-auto md:top-0 md:left-20 md:h-screen md:w-[300px]",
          "bg-[rgba(10,10,18,0.99)]",
          "md:border-r md:border-white/[0.06]",
          "md:shadow-[4px_0_40px_rgba(0,0,0,0.6)]",
          "md:backdrop-blur-[24px]",
          "transition-all duration-300",
          open
            ? "opacity-100 pointer-events-auto md:translate-x-0"
            : "opacity-0 pointer-events-none md:-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-full flex-col px-8 py-10 overflow-y-auto">
          {/* Botão fechar — visível apenas no mobile */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-white md:hidden"
          >
            ✕
          </button>

          {/* Header */}
          <div className="mb-10 mt-4 md:mt-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="h-[2px] w-6 bg-indigo-500" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-400">
                {mode === "login"
                  ? "Acesse sua conta"
                  : mode === "signup"
                    ? "Crie sua conta"
                    : "Recuperar senha"}
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              {mode === "login"
                ? "Bem-vindo de volta"
                : mode === "signup"
                  ? "Comece agora"
                  : "Esqueceu a senha?"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {mode === "login"
                ? "Sua curadoria pessoal te espera."
                : mode === "signup"
                  ? "Filmes e séries do jeito que você gosta."
                  : "Vamos te ajudar a recuperar o acesso."}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
                E-mail
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="
                  w-full rounded-xl border border-white/[0.08]
                  bg-white/[0.04] px-4 py-3
                  text-sm text-white placeholder-zinc-600
                  outline-none ring-0
                  transition
                  focus:border-indigo-500/60 focus:bg-white/[0.06]
                "
              />
            </div>

            {mode !== "forgot" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
                  Senha
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="
                    w-full rounded-xl border border-white/[0.08]
                    bg-white/[0.04] px-4 py-3
                    text-sm text-white placeholder-zinc-600
                    outline-none ring-0
                    transition
                    focus:border-indigo-500/60 focus:bg-white/[0.06]
                  "
                />
              </div>
            )}

            {mode === "login" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-[11px] text-zinc-500 transition hover:text-zinc-300"
                >
                  Esqueceu a senha?
                </button>
              </div>
            )}

            {/* Feedback */}
            {error && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-400">
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="
                mt-1 w-full rounded-xl bg-indigo-600 py-3
                text-sm font-semibold text-white
                transition hover:bg-indigo-500
                disabled:opacity-50
                active:scale-[0.98]
              "
            >
              {loading
                ? "Aguarde..."
                : mode === "login"
                  ? "Entrar"
                  : mode === "signup"
                    ? "Criar conta"
                    : "Enviar link"}
            </button>
          </form>

          {/* Footer toggle */}
          <div className="mt-6 text-center text-xs text-zinc-600">
            {mode === "login" ? (
              <>
                Não tem conta?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="text-zinc-300 transition hover:text-white"
                >
                  Criar agora
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setMode("login")}
                className="text-zinc-300 transition hover:text-white"
              >
                ← Voltar ao login
              </button>
            )}
          </div>

          {/* Divider + future OAuth */}
          <div className="mt-8 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[10px] uppercase tracking-widest text-zinc-700">
              em breve
            </span>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>

          <button
            type="button"
            disabled
            className="
              mt-4 flex w-full items-center justify-center gap-3
              rounded-xl border border-white/[0.06]
              bg-white/[0.02] py-3
              text-sm text-zinc-600
              cursor-not-allowed
            "
          >
            <GoogleIcon />
            Continuar com Google
          </button>
        </div>
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
        opacity="0.4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
        opacity="0.4"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
        opacity="0.4"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
        opacity="0.4"
      />
    </svg>
  );
}

function translateError(msg: string): string {
  if (msg.includes("Invalid login credentials"))
    return "E-mail ou senha incorretos.";
  if (msg.includes("Email not confirmed"))
    return "Confirme seu e-mail antes de entrar.";
  if (msg.includes("User already registered"))
    return "Este e-mail já está cadastrado.";
  if (msg.includes("Password should be at least"))
    return "A senha deve ter pelo menos 6 caracteres.";
  if (msg.includes("rate limit")) return "Muitas tentativas. Tente mais tarde.";
  return msg;
}