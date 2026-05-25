"use client";

import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

// ─── AdminCard ────────────────────────────────────────────────────────────────

export function AdminCard({
  title,
  desc,
  extra,
  tone,
  children,
}: {
  title: string;
  desc?: string;
  extra?: React.ReactNode;
  tone?: "danger";
  children: React.ReactNode;
}) {
  const border = tone === "danger" ? "border-rose-400/20" : "border-white/10";
  const titleCls = tone === "danger" ? "text-rose-200" : "text-white";
  return (
    <section className={`rounded-xl border ${border} bg-white/[0.025] p-5`}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {tone === "danger" && <AlertTriangle size={15} className="text-rose-300 shrink-0" />}
          <h2 className={`text-base font-black ${titleCls}`}>{title}</h2>
        </div>
        {desc  && <p className="mt-0.5 text-xs text-zinc-500">{desc}</p>}
        {extra}
      </div>
      {children}
    </section>
  );
}

// ─── AdminRow ─────────────────────────────────────────────────────────────────

export function AdminRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-200">{children}</span>
    </div>
  );
}

// ─── AdminFeedback ────────────────────────────────────────────────────────────

export function AdminFeedback({
  kind,
  message,
  detail,
}: {
  kind: "loading" | "success" | "error";
  message: string;
  detail?: string;
}) {
  const styles = {
    loading: "border-white/10  bg-white/[0.04]    text-zinc-400",
    success: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
    error:   "border-rose-400/20   bg-rose-500/10    text-rose-300",
  };
  const Icon =
    kind === "loading" ? RefreshCw :
    kind === "success" ? CheckCircle2 : AlertTriangle;

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${styles[kind]}`}>
      <Icon size={15} className={`mt-0.5 shrink-0 ${kind === "loading" ? "animate-spin" : ""}`} />
      <div>
        <p className="font-medium">{message}</p>
        {detail && <p className="mt-0.5 text-xs opacity-70">{detail}</p>}
      </div>
    </div>
  );
}

// ─── AdminActionButton ────────────────────────────────────────────────────────

export function AdminActionButton({
  label,
  desc,
  icon,
  onClick,
  disabled,
  tone = "neutral",
}: {
  label: string;
  desc?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "neutral" | "danger";
}) {
  const styles = {
    primary: "border-indigo-400/20 bg-indigo-500/15 text-indigo-100 hover:bg-indigo-500/25",
    neutral: "border-white/10      bg-white/[0.04]  text-zinc-300   hover:bg-white/[0.07]",
    danger:  "border-rose-400/20   bg-rose-500/10   text-rose-200   hover:bg-rose-500/20",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full inline-flex items-center gap-3 rounded-xl border px-5 py-4 text-left text-sm font-semibold transition ${styles[tone]} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {icon}
      <span>
        {label}
        {desc && <span className="block text-xs font-normal opacity-60 mt-0.5">{desc}</span>}
      </span>
    </button>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "good" | "bad";
}) {
  const valueCls =
    tone === "good" ? "text-emerald-300" :
    tone === "bad"  ? "text-rose-300"    : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 text-2xl font-black ${valueCls}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-600">{sub}</p>}
    </div>
  );
}
