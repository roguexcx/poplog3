"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "@/components/layout/PageShell";
import type { IcsEvent } from "@/lib/ics-parser";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type ViewMode = "month" | "week" | "day";

// ── Helpers de data ────────────────────────────────────────────────────────────

function toLocalDateStr(date: Date): string {
  // Usa a data local do usuário (não UTC) para exibição
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayStr(): string {
  return toLocalDateStr(new Date());
}

function formatMonthYear(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function formatWeekRange(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return `${start.toLocaleDateString("pt-BR", opts)} – ${end.toLocaleDateString("pt-BR", opts)}`;
}

function formatDayFull(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function startOfWeek(date: Date): Date {
  // Segunda-feira como início de semana
  const d = new Date(date);
  const day = d.getDay(); // 0=Dom
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  // 0=Dom ... 6=Sáb → queremos ajustar para Seg=0 ... Dom=6
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

/** Converte Data UTC do ICS para string de data local */
function icsEventDateStr(ev: IcsEvent): string {
  // O feed do bancodeseries usa horários UTC; convertemos para local
  return toLocalDateStr(ev.startAt);
}

function icsEventHour(ev: IcsEvent): string {
  const h = String(ev.startAt.getUTCHours()).padStart(2, "0");
  const m = String(ev.startAt.getUTCMinutes()).padStart(2, "0");
  return `${h}h${m !== "00" ? m : ""}`;
}

// ── Agrupamento local ──────────────────────────────────────────────────────────

function groupEventsByDay(events: IcsEvent[]): Map<string, IcsEvent[]> {
  const map = new Map<string, IcsEvent[]>();
  for (const ev of events) {
    const key = icsEventDateStr(ev);
    const arr = map.get(key) ?? [];
    arr.push(ev);
    map.set(key, arr);
  }
  return map;
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const EyebrowColor = {
  indigo: { line: "bg-indigo-400/60", text: "text-indigo-400/80" },
  rose:   { line: "bg-rose-400/60",   text: "text-rose-400/80"   },
  cyan:   { line: "bg-cyan-400/60",   text: "text-cyan-400/80"   },
} as const;

// ── Primitivos visuais ────────────────────────────────────────────────────────

function SectionEyebrow({ children, color = "indigo" }: {
  children: React.ReactNode;
  color?: keyof typeof EyebrowColor;
}) {
  const { line, text } = EyebrowColor[color];
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${line}`} />
      <p className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${text}`}>{children}</p>
    </div>
  );
}

// ── View toggle ────────────────────────────────────────────────────────────────

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const options: { key: ViewMode; label: string }[] = [
    { key: "month", label: "Mês" },
    { key: "week",  label: "Semana" },
    { key: "day",   label: "Dia" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1">
      {options.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`text-[11px] font-bold px-3.5 py-1.5 rounded-xl transition-all duration-200 ${
            mode === key
              ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/20"
              : "text-white/30 hover:text-white/55"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────────

function AgendaHero({
  mode, onChangeMode, eventCount, isLoading,
}: {
  mode: ViewMode;
  onChangeMode: (m: ViewMode) => void;
  eventCount: number;
  isLoading: boolean;
}) {
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  return (
    <div className="relative isolate rounded-[24px] overflow-hidden mb-8 min-h-[220px] sm:min-h-[260px] flex flex-col justify-between p-6 sm:p-8 border border-white/[0.06]">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-950/80 via-black to-black" />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 20% 0%, rgba(99,102,241,0.15) 0%, transparent 60%)" }} />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 90% 100%, rgba(6,182,212,0.08) 0%, transparent 50%)" }} />
      <div
        className="absolute inset-0 -z-10 opacity-[0.025]"
        style={{ backgroundImage: "linear-gradient(0deg,white 1px,transparent 1px),linear-gradient(90deg,white 1px,transparent 1px)", backgroundSize: "64px 64px" }}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionEyebrow color="indigo">Calendário de séries · bancodeseries.com.br</SectionEyebrow>
          <p className="text-[12px] text-white/30 capitalize">{today}</p>
        </div>
        <ViewToggle mode={mode} onChange={onChangeMode} />
      </div>

      <div className="mt-4">
        <h1 className="text-5xl sm:text-6xl font-black tracking-[-0.05em] text-white/90 leading-none mb-2">Agenda</h1>
        <p className="text-[13px] text-white/35 leading-relaxed">
          {isLoading
            ? "Carregando episódios..."
            : `${eventCount} episódio${eventCount !== 1 ? "s" : ""} no calendário`}
        </p>
      </div>

      {/* Indicador de fonte */}
      <div className="flex items-center gap-2 mt-4">
        <span className={`w-1.5 h-1.5 rounded-full ${isLoading ? "bg-amber-400/60" : "bg-emerald-400/80"}`} />
        <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/20">
          {isLoading ? "Conectando ao feed ICS..." : "Feed ICS ativo"}
        </span>
      </div>
    </div>
  );
}

// ── Nav de período ─────────────────────────────────────────────────────────────

function PeriodNav({
  label, onPrev, onNext, onToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-[17px] font-black tracking-[-0.03em] text-white/80 capitalize">{label}</h2>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToday}
          className="text-[10px] font-bold text-white/35 hover:text-white/60 border border-white/[0.08] rounded-xl px-3 py-1.5 transition-colors"
        >
          Hoje
        </button>
        <button
          type="button"
          onClick={onPrev}
          className="w-8 h-8 rounded-xl border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all"
          aria-label="Anterior"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onNext}
          className="w-8 h-8 rounded-xl border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all"
          aria-label="Próximo"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Episode Pill (no calendário mensal) ────────────────────────────────────────

function EpisodePill({ ev, compact = false }: { ev: IcsEvent; compact?: boolean }) {
  if (compact) {
    return (
      <div className="text-[8px] font-bold truncate rounded-[4px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-200/80 border border-indigo-500/20 leading-tight">
        {ev.seriesTitle}
      </div>
    );
  }
  return (
    <div className="text-[9px] font-bold truncate rounded-[5px] px-2 py-1 bg-indigo-500/20 text-indigo-200/85 border border-indigo-500/20 leading-tight flex items-center gap-1.5">
      <span className="opacity-60 shrink-0 font-black">{ev.seasonEp}</span>
      <span className="truncate">{ev.seriesTitle}</span>
    </div>
  );
}

// ── Vista Mensal ───────────────────────────────────────────────────────────────

const WEEK_HEADERS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MAX_PILLS_PER_DAY = 2;

function MonthView({
  year, month, byDay, selectedDay, onSelectDay,
}: {
  year: number;
  month: number;
  byDay: Map<string, IcsEvent[]>;
  selectedDay: string;
  onSelectDay: (d: string) => void;
}) {
  const today = todayStr();
  const totalDays = getDaysInMonth(year, month);
  const firstOffset = getFirstDayOfMonth(year, month); // 0=Seg ... 6=Dom
  const prevMonthDays = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1);

  // Células da grade: dias do mês anterior (offset) + dias do mês + dias do próximo
  const cells: Array<{ dateStr: string; isCurrentMonth: boolean }> = [];

  // Dias do mês anterior
  for (let i = firstOffset - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const mo = month - 1 < 0 ? 11 : month - 1;
    const y  = month - 1 < 0 ? year - 1 : year;
    cells.push({
      dateStr: `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      isCurrentMonth: false,
    });
  }

  // Dias do mês atual
  for (let d = 1; d <= totalDays; d++) {
    cells.push({
      dateStr: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      isCurrentMonth: true,
    });
  }

  // Completar a última semana
  const remainder = cells.length % 7;
  if (remainder > 0) {
    const nextMo = month + 1 > 11 ? 0 : month + 1;
    const nextY  = month + 1 > 11 ? year + 1 : year;
    for (let d = 1; d <= 7 - remainder; d++) {
      cells.push({
        dateStr: `${nextY}-${String(nextMo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        isCurrentMonth: false,
      });
    }
  }

  return (
    <div>
      {/* Cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 mb-2">
        {WEEK_HEADERS.map((h) => (
          <div key={h} className="text-center text-[9px] font-bold uppercase tracking-[0.18em] text-white/20 py-2">
            {h}
          </div>
        ))}
      </div>

      {/* Células */}
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map(({ dateStr, isCurrentMonth }) => {
          const events = byDay.get(dateStr) ?? [];
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDay;
          const dayNum = parseInt(dateStr.split("-")[2], 10);
          const visible = events.slice(0, MAX_PILLS_PER_DAY);
          const extra = events.length - visible.length;

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelectDay(dateStr)}
              className={[
                "relative min-h-[72px] sm:min-h-[80px] rounded-xl p-1.5 text-left transition-all duration-200 border",
                !isCurrentMonth ? "opacity-30 border-white/[0.04] bg-transparent" : "",
                isCurrentMonth && !isToday && !isSelected && events.length === 0
                  ? "border-white/[0.04] bg-transparent hover:bg-white/[0.03] hover:border-white/[0.07]"
                  : "",
                isCurrentMonth && !isToday && !isSelected && events.length > 0
                  ? "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.10]"
                  : "",
                isToday && !isSelected
                  ? "border-indigo-500/40 bg-indigo-500/[0.07] hover:bg-indigo-500/[0.10]"
                  : "",
                isSelected
                  ? "border-indigo-400/60 bg-indigo-500/[0.14] ring-1 ring-indigo-500/30"
                  : "",
              ].join(" ")}
            >
              {/* Número do dia */}
              <span className={[
                "text-[10px] font-black block mb-1.5 leading-none",
                isToday ? "text-indigo-300/90" : isCurrentMonth ? "text-white/45" : "text-white/20",
              ].join(" ")}>
                {dayNum}
              </span>

              {/* Episódios */}
              <div className="flex flex-col gap-[2px]">
                {visible.map((ev) => (
                  <EpisodePill key={ev.uid} ev={ev} compact />
                ))}
                {extra > 0 && (
                  <div className="text-[7.5px] font-bold text-white/25 pl-0.5">
                    +{extra} mais
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Vista Semanal ──────────────────────────────────────────────────────────────

function WeekView({
  weekStart, byDay, selectedDay, onSelectDay,
}: {
  weekStart: Date;
  byDay: Map<string, IcsEvent[]>;
  selectedDay: string;
  onSelectDay: (d: string) => void;
}) {
  const today = todayStr();
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(toLocalDateStr(d));
  }

  const DAY_LABELS_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  return (
    <div className="space-y-2">
      {days.map((dateStr, i) => {
        const events = byDay.get(dateStr) ?? [];
        const isToday = dateStr === today;
        const isSelected = dateStr === selectedDay;
        const dayNum = parseInt(dateStr.split("-")[2], 10);
        const label = DAY_LABELS_SHORT[i];

        return (
          <div key={dateStr}>
            {/* Cabeçalho do dia */}
            <button
              type="button"
              onClick={() => onSelectDay(dateStr)}
              className={[
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 text-left",
                isSelected
                  ? "border-indigo-400/40 bg-indigo-500/10"
                  : isToday
                  ? "border-indigo-500/25 bg-indigo-500/[0.05] hover:bg-indigo-500/[0.08]"
                  : events.length > 0
                  ? "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"
                  : "border-white/[0.04] bg-transparent hover:bg-white/[0.02]",
              ].join(" ")}
            >
              {/* Dia da semana + número */}
              <div className="flex items-center gap-2 w-[64px] shrink-0">
                <span className={`text-[9px] font-bold uppercase tracking-[0.18em] ${isToday ? "text-indigo-300/80" : "text-white/25"}`}>
                  {label}
                </span>
                <span className={`text-[14px] font-black tabular-nums leading-none ${isToday ? "text-indigo-200" : "text-white/50"}`}>
                  {dayNum}
                </span>
              </div>

              {/* Episódios ou vazio */}
              {events.length === 0 ? (
                <span className="text-[10px] text-white/15">Nenhum episódio</span>
              ) : (
                <div className="flex-1 flex flex-wrap gap-1.5">
                  {events.slice(0, 4).map((ev) => (
                    <EpisodePill key={ev.uid} ev={ev} compact />
                  ))}
                  {events.length > 4 && (
                    <span className="text-[9px] text-white/30 font-bold self-center">+{events.length - 4} mais</span>
                  )}
                </div>
              )}

              {/* Contagem total */}
              {events.length > 0 && (
                <span className="shrink-0 text-[10px] font-black text-white/20 tabular-nums">
                  {events.length}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Vista Diária ───────────────────────────────────────────────────────────────

function DayView({ dateStr, events }: { dateStr: string; events: IcsEvent[] }) {
  const label = formatDayFull(dateStr);

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-indigo-400/70 mb-1">Episódios do dia</p>
          <h3 className="text-[16px] font-black tracking-[-0.03em] text-white/80 capitalize leading-tight">{label}</h3>
        </div>
        <span className="ml-auto text-[11px] font-black text-white/20 border border-white/[0.08] rounded-full px-2.5 py-0.5">
          {events.length} ep{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] px-6 py-10 text-center">
          <div className="w-10 h-10 rounded-xl border border-white/[0.07] bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-white/20">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="16" y1="2" x2="16" y2="6" />
            </svg>
          </div>
          <p className="text-[13px] font-bold text-white/30">Nenhum episódio neste dia</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((ev, idx) => (
            <div
              key={ev.uid}
              className="group flex items-center gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.09] transition-all duration-200 p-3.5"
            >
              {/* Índice / horário */}
              <div className="w-[40px] shrink-0 text-right">
                <span className="text-[9px] font-black text-white/20 tabular-nums">{icsEventHour(ev)}</span>
              </div>

              {/* Linha vertical */}
              <div className="w-px self-stretch bg-indigo-500/20 shrink-0" />

              {/* Conteúdo */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[8.5px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300/80 border border-indigo-500/20">
                    {ev.seasonEp}
                  </span>
                </div>
                <p className="text-[13.5px] font-black tracking-[-0.02em] text-white/85 leading-tight truncate">
                  {ev.seriesTitle}
                </p>
                {ev.episodeName && ev.episodeName.toLowerCase() !== "tba" && (
                  <p className="text-[10.5px] text-white/35 mt-0.5 truncate">
                    &ldquo;{ev.episodeName}&rdquo;
                  </p>
                )}
              </div>

              {/* Número do episódio */}
              <div className="shrink-0 text-right">
                <p className="text-[18px] font-black tabular-nums text-white/10 leading-none">
                  {String(idx + 1).padStart(2, "0")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <PageShell variant="wide">
      <div className="space-y-6">
        <div className="h-[220px] rounded-[24px] bg-white/[0.03] animate-pulse" />
        <div className="h-8 w-[200px] rounded-xl bg-white/[0.03] animate-pulse" />
        <div className="grid grid-cols-7 gap-[3px]">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="h-[72px] rounded-xl bg-white/[0.025] animate-pulse" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

// ── Painel lateral de detalhes do dia ──────────────────────────────────────────

function DayPanel({
  dateStr, events, onClose,
}: {
  dateStr: string;
  events: IcsEvent[];
  onClose: () => void;
}) {
  return (
    <div className="mt-8 rounded-[20px] border border-indigo-500/20 bg-indigo-950/10 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <SectionEyebrow color="indigo">Detalhe do dia</SectionEyebrow>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] font-bold text-white/25 hover:text-white/50 border border-white/[0.07] rounded-lg px-2.5 py-1 transition-colors"
        >
          Fechar
        </button>
      </div>
      <DayView dateStr={dateStr} events={events} />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgendaPage() {
  const [events, setEvents]       = useState<IcsEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [mode, setMode]           = useState<ViewMode>("month");

  // Estado de navegação
  const now = new Date();
  const [navYear, setNavYear]   = useState(now.getFullYear());
  const [navMonth, setNavMonth] = useState(now.getMonth());
  const [navWeekStart, setNavWeekStart] = useState(() => startOfWeek(now));
  const [selectedDay, setSelectedDay]   = useState(todayStr());

  // Fetch dos eventos ICS
  useEffect(() => {
    setIsLoading(true);
    fetch("/api/ics/agenda")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        // Os eventos chegam como objetos com strings de data — precisamos reidratar os Date
        const hydrated: IcsEvent[] = (data.events ?? []).map((ev: IcsEvent & { startAt: string; endAt: string }) => ({
          ...ev,
          startAt: new Date(ev.startAt),
          endAt: new Date(ev.endAt),
        }));
        setEvents(hydrated);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erro desconhecido"))
      .finally(() => setIsLoading(false));
  }, []);

  // Agrupa por dia (roda só quando events muda)
  const byDay = useMemo(() => groupEventsByDay(events), [events]);

  // ── Handlers de navegação ──────────────────────────────────────────────────

  const handlePrev = useCallback(() => {
    if (mode === "month") {
      setNavYear((y) => navMonth === 0 ? y - 1 : y);
      setNavMonth((m) => m === 0 ? 11 : m - 1);
    } else if (mode === "week") {
      setNavWeekStart((d) => {
        const next = new Date(d);
        next.setDate(next.getDate() - 7);
        return next;
      });
    } else {
      setSelectedDay((s) => {
        const d = new Date(s + "T12:00:00");
        d.setDate(d.getDate() - 1);
        return toLocalDateStr(d);
      });
    }
  }, [mode, navMonth]);

  const handleNext = useCallback(() => {
    if (mode === "month") {
      setNavYear((y) => navMonth === 11 ? y + 1 : y);
      setNavMonth((m) => m === 11 ? 0 : m + 1);
    } else if (mode === "week") {
      setNavWeekStart((d) => {
        const next = new Date(d);
        next.setDate(next.getDate() + 7);
        return next;
      });
    } else {
      setSelectedDay((s) => {
        const d = new Date(s + "T12:00:00");
        d.setDate(d.getDate() + 1);
        return toLocalDateStr(d);
      });
    }
  }, [mode, navMonth]);

  const handleToday = useCallback(() => {
    const t = new Date();
    setNavYear(t.getFullYear());
    setNavMonth(t.getMonth());
    setNavWeekStart(startOfWeek(t));
    setSelectedDay(todayStr());
  }, []);

  // ── Label do período ───────────────────────────────────────────────────────

  const periodLabel = useMemo(() => {
    if (mode === "month") return formatMonthYear(navYear, navMonth);
    if (mode === "week")  return `Semana de ${formatWeekRange(navWeekStart)}`;
    return formatDayFull(selectedDay);
  }, [mode, navYear, navMonth, navWeekStart, selectedDay]);

  // ── Eventos do dia selecionado ─────────────────────────────────────────────
  const selectedDayEvents = byDay.get(selectedDay) ?? [];
  const showDayPanel = mode !== "day" && selectedDay !== "";

  if (isLoading) return <LoadingSkeleton />;

  return (
    <PageShell variant="wide">

      <AgendaHero
        mode={mode}
        onChangeMode={(m) => {
          setMode(m);
          if (m === "day") {
            // ao entrar na view dia, mostra o dia selecionado
          }
        }}
        eventCount={events.length}
        isLoading={isLoading}
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-950/20 px-5 py-4 text-[12px] text-red-300/80">
          Erro ao carregar feed ICS: {error}
        </div>
      )}

      <PeriodNav
        label={periodLabel}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />

      {/* ── Vista principal ────────────────────────────────────────────── */}
      {mode === "month" && (
        <MonthView
          year={navYear}
          month={navMonth}
          byDay={byDay}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
        />
      )}

      {mode === "week" && (
        <WeekView
          weekStart={navWeekStart}
          byDay={byDay}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
        />
      )}

      {mode === "day" && (
        <DayView dateStr={selectedDay} events={selectedDayEvents} />
      )}

      {/* ── Painel de detalhe do dia selecionado (em mês/semana) ──────── */}
      {showDayPanel && selectedDayEvents.length > 0 && (
        <DayPanel
          dateStr={selectedDay}
          events={selectedDayEvents}
          onClose={() => setSelectedDay("")}
        />
      )}

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="mt-12 pt-6 border-t border-white/[0.05] flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/15">
          Fonte: bancodeseries.com.br/ical.php · Atualizado a cada 30 min
        </span>
      </div>

    </PageShell>
  );
}
