"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { createClient } from "@/server/supabase/client";

type LoginDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

type Mode = "login" | "signup" | "forgot";

export default function LoginDrawer({
  open,
  onClose,
  onSuccess,
}: LoginDrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setMode("login");
    setEmail("");
    setPassword("");
    setError(null);
    setSuccess(null);
  }, [open]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (open) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  async function handleGoogleSignIn() {
    setOauthLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await signIn("google", {
        callbackUrl: window.location.href,
        redirect: true,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? translateError(err.message)
          : "Ocorreu um erro inesperado.";

      setError(message);
      setOauthLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = createClient();

    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        });

        if (error) throw error;

        setSuccess("Enviamos um link de recuperação para o seu e-mail.");
        return;
      }

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        setSuccess("Conta criada! Verifique seu e-mail para confirmar.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? translateError(err.message)
          : "Ocorreu um erro inesperado.";

      setError(message);
    } finally {
      setLoading(false);
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
          ${
            open
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          }
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

          ${
            open
              ? "opacity-100 translate-x-0"
              : "opacity-0 -translate-x-full pointer-events-none"
          }
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
                {mode === "login"
                  ? "Acesse sua conta"
                  : mode === "signup"
                    ? "Criar conta"
                    : "Recuperar acesso"}
              </span>
            </div>

            <h2 className="text-3xl font-semibold tracking-tight text-white">
              {mode === "login"
                ? "Bem-vindo de volta."
                : mode === "signup"
                  ? "Crie sua conta."
                  : "Esqueceu sua senha?"}
            </h2>

            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              {mode === "login"
                ? "Continue sua curadoria pessoal de filmes e séries."
                : mode === "signup"
                  ? "Sua biblioteca cinematográfica começa aqui."
                  : "Vamos enviar um link de recuperação para o seu e-mail."}
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={oauthLoading || loading}
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

          <div className="mb-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              fallback temporário
            </span>
            <span className="h-px flex-1 bg-white/[0.08]" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" suppressHydrationWarning>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
                E-mail
              </label>

              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="seu@email.com"
                className="
                  w-full rounded-xl
                  border border-white/[0.08]
                  bg-white/[0.04]
                  px-4 py-3
                  text-sm text-white
                  placeholder-zinc-600
                  outline-none
                  transition
                  focus:border-indigo-500/60
                  focus:bg-white/[0.06]
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
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="
                    w-full rounded-xl
                    border border-white/[0.08]
                    bg-white/[0.04]
                    px-4 py-3
                    text-sm text-white
                    placeholder-zinc-600
                    outline-none
                    transition
                    focus:border-indigo-500/60
                    focus:bg-white/[0.06]
                  "
                />
              </div>
            )}

            {mode === "login" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="
                    text-[11px] text-zinc-500
                    transition hover:text-zinc-300
                  "
                >
                  Esqueceu a senha?
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="
                mt-2 w-full rounded-xl
                bg-indigo-600 py-3
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
        </div>
      </div>
    </>
  );
}

function translateError(message: string): string {
  if (message.includes("Invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }

  if (message.includes("Email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }

  if (message.includes("User already registered")) {
    return "Este e-mail já está cadastrado.";
  }

  if (message.includes("Password should be at least")) {
    return "A senha deve ter pelo menos 6 caracteres.";
  }

  if (message.includes("rate limit")) {
    return "Muitas tentativas. Tente novamente mais tarde.";
  }

  return message;
}
