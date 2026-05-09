"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { type User } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageType = "success" | "error";

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsClient() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [newEmail, setNewEmail]       = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [username, setUsername]       = useState("");
  const [saving, setSaving]           = useState(false);
  const [message, setMessage]         = useState<string | null>(null);
  const [messageType, setMessageType] = useState<MessageType>("success");
  const [showDelete, setShowDelete]   = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      setUsername(user.user_metadata?.username ?? "");
      setLoading(false);
    }
    load();
  }, [router]);

  function showMsg(text: string, type: MessageType) {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(null), 4000);
  }

  async function handleUpdateUsername() {
    if (!username.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ data: { username: username.trim() } });
    setSaving(false);
    error ? showMsg(error.message, "error") : showMsg("Nome atualizado!", "success");
  }

  async function handleUpdateEmail() {
    if (!newEmail.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setSaving(false);
    error ? showMsg(error.message, "error") : showMsg("Verifique seu novo email para confirmar.", "success");
  }

  async function handleUpdatePassword() {
    if (!newPassword.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    error ? showMsg(error.message, "error") : showMsg("Senha atualizada!", "success");
    setNewPassword("");
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  }

  async function handleDeleteAccount() {
    setSaving(true);
    const res = await fetch("/api/user/delete", { method: "DELETE" });
    setSaving(false);
    if (res.ok) {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } else {
      showMsg("Erro ao excluir conta. Tente novamente.", "error");
    }
  }

  if (loading) return null;

  const inputClass =
    "w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-sky-400/60";
  const btnClass =
    "rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-sky-100 disabled:opacity-50";
  const secClass =
    "rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 sm:p-8";

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">

        <div className="mb-8 flex items-center gap-4">
          <button
            onClick={() => router.push("/profile")}
            className="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            ← Voltar
          </button>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.35em] text-sky-300">Conta</p>
            <h1 className="text-2xl font-black">Configurações</h1>
          </div>
        </div>

        {message && (
          <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm font-medium ${
            messageType === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/20 bg-red-500/10 text-red-300"
          }`}>
            {message}
          </div>
        )}

        <div className="flex flex-col gap-5">

          {/* Nome de usuário */}
          <div className={secClass}>
            <h2 className="mb-1 text-sm font-black uppercase tracking-[0.25em] text-sky-300">Nome de usuário</h2>
            <p className="mb-4 text-xs text-slate-400">Aparece no seu perfil.</p>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Seu nome de usuário"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
              />
              <button onClick={handleUpdateUsername} disabled={saving} className={btnClass}>
                Salvar
              </button>
            </div>
          </div>

          {/* Email */}
          <div className={secClass}>
            <h2 className="mb-1 text-sm font-black uppercase tracking-[0.25em] text-sky-300">Email</h2>
            <p className="mb-2 text-xs text-slate-400">
              Atual: <span className="font-bold text-white">{user?.email}</span>
            </p>
            <p className="mb-4 text-xs text-slate-400">Um link de confirmação será enviado para o novo email.</p>
            <div className="flex gap-3">
              <input
                type="email"
                placeholder="Novo email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className={inputClass}
              />
              <button onClick={handleUpdateEmail} disabled={saving} className={btnClass}>
                Alterar
              </button>
            </div>
          </div>

          {/* Senha */}
          <div className={secClass}>
            <h2 className="mb-1 text-sm font-black uppercase tracking-[0.25em] text-sky-300">Senha</h2>
            <p className="mb-4 text-xs text-slate-400">Mínimo de 6 caracteres.</p>
            <div className="flex gap-3">
              <input
                type="password"
                placeholder="Nova senha"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
              <button onClick={handleUpdatePassword} disabled={saving} className={btnClass}>
                Alterar
              </button>
            </div>
          </div>

          {/* Sair */}
          <div className={secClass}>
            <h2 className="mb-1 text-sm font-black uppercase tracking-[0.25em] text-sky-300">Sessão</h2>
            <p className="mb-4 text-xs text-slate-400">Encerra sua sessão neste dispositivo.</p>
            <button
              onClick={handleLogout}
              className="rounded-full border border-white/10 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
            >
              Sair da conta
            </button>
          </div>

          {/* Excluir conta */}
          <div className="rounded-[2rem] border border-red-500/20 bg-red-500/[0.04] p-6 sm:p-8">
            <h2 className="mb-1 text-sm font-black uppercase tracking-[0.25em] text-red-400">Excluir conta</h2>
            <p className="mb-4 text-xs text-slate-400">
              Remove permanentemente sua conta e todos os seus dados. Esta ação não pode ser desfeita.
            </p>
            {!showDelete ? (
              <button
                onClick={() => setShowDelete(true)}
                className="rounded-full border border-red-500/30 px-5 py-2.5 text-sm font-bold text-red-400 transition hover:bg-red-500/10"
              >
                Excluir minha conta
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-bold text-red-300">Tem certeza? Esta ação é irreversível.</p>
                <div className="flex gap-3">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={saving}
                    className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
                  >
                    Sim, excluir tudo
                  </button>
                  <button
                    onClick={() => setShowDelete(false)}
                    className="rounded-full border border-white/10 px-5 py-2.5 text-sm font-bold text-slate-400 transition hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </main>
  );
}
