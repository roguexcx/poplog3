import { uiMessage } from "@/lib/i18n/ui-message";
import { BadgeDollarSign, Crown, Flame, Popcorn, Rocket, Scale, Snowflake, TrendingDown, } from "lucide-react";
import type { FinancialBadgeIcon, FinancialBadgeInsight, FinancialBadgeTone, } from "@/lib/editorial-finance";
type TitleFinancialBadgeProps = {
    insight: FinancialBadgeInsight | null;
};
const TONE_STYLES: Record<FinancialBadgeTone, {
    shell: string;
    glow: string;
    icon: string;
    eyebrow: string;
    stat: string;
    line: string;
}> = {
    phenomenon: {
        shell: "border-amber-200/28 bg-[linear-gradient(135deg,rgba(146,64,14,0.62),rgba(24,24,27,0.88)_46%,rgba(250,204,21,0.20))] shadow-[0_24px_90px_rgba(245,158,11,0.22)]",
        glow: "from-amber-200/34 via-yellow-400/12 to-transparent",
        icon: "border-amber-200/32 bg-amber-300/15 text-amber-100",
        eyebrow: "text-amber-100/78",
        stat: "border-amber-100/14 bg-amber-100/[0.075]",
        line: "via-amber-100/20",
    },
    hit: {
        shell: "border-orange-200/24 bg-[linear-gradient(135deg,rgba(127,29,29,0.56),rgba(24,24,27,0.90)_48%,rgba(251,146,60,0.18))] shadow-[0_24px_90px_rgba(249,115,22,0.18)]",
        glow: "from-orange-300/30 via-red-400/12 to-transparent",
        icon: "border-orange-200/28 bg-orange-400/14 text-orange-100",
        eyebrow: "text-orange-100/76",
        stat: "border-orange-100/13 bg-orange-100/[0.07]",
        line: "via-orange-100/18",
    },
    surprise: {
        shell: "border-fuchsia-200/24 bg-[linear-gradient(135deg,rgba(88,28,135,0.60),rgba(24,24,27,0.90)_48%,rgba(34,211,238,0.14))] shadow-[0_24px_90px_rgba(217,70,239,0.18)]",
        glow: "from-fuchsia-300/28 via-cyan-300/12 to-transparent",
        icon: "border-fuchsia-200/28 bg-fuchsia-400/14 text-fuchsia-100",
        eyebrow: "text-fuchsia-100/76",
        stat: "border-fuchsia-100/13 bg-fuchsia-100/[0.07]",
        line: "via-fuchsia-100/18",
    },
    return: {
        shell: "border-emerald-200/22 bg-[linear-gradient(135deg,rgba(6,78,59,0.54),rgba(24,24,27,0.90)_50%,rgba(45,212,191,0.13))] shadow-[0_24px_90px_rgba(16,185,129,0.14)]",
        glow: "from-emerald-300/24 via-teal-300/10 to-transparent",
        icon: "border-emerald-200/25 bg-emerald-400/13 text-emerald-100",
        eyebrow: "text-emerald-100/74",
        stat: "border-emerald-100/12 bg-emerald-100/[0.065]",
        line: "via-emerald-100/16",
    },
    mixed: {
        shell: "border-slate-200/18 bg-[linear-gradient(135deg,rgba(71,85,105,0.42),rgba(24,24,27,0.90)_52%,rgba(148,163,184,0.12))] shadow-[0_24px_90px_rgba(148,163,184,0.10)]",
        glow: "from-slate-200/18 via-white/8 to-transparent",
        icon: "border-slate-100/20 bg-white/[0.075] text-slate-100",
        eyebrow: "text-slate-100/68",
        stat: "border-white/10 bg-white/[0.055]",
        line: "via-white/14",
    },
    below: {
        shell: "border-rose-200/20 bg-[linear-gradient(135deg,rgba(76,29,29,0.52),rgba(24,24,27,0.90)_52%,rgba(244,63,94,0.12))] shadow-[0_24px_90px_rgba(244,63,94,0.13)]",
        glow: "from-rose-300/22 via-red-300/9 to-transparent",
        icon: "border-rose-200/24 bg-rose-400/12 text-rose-100",
        eyebrow: "text-rose-100/72",
        stat: "border-rose-100/11 bg-rose-100/[0.06]",
        line: "via-rose-100/15",
    },
    flop: {
        shell: "border-red-300/24 bg-[linear-gradient(135deg,rgba(69,10,10,0.68),rgba(24,24,27,0.92)_50%,rgba(127,29,29,0.25))] shadow-[0_24px_90px_rgba(185,28,28,0.20)]",
        glow: "from-red-400/26 via-rose-500/10 to-transparent",
        icon: "border-red-200/25 bg-red-500/14 text-red-100",
        eyebrow: "text-red-100/76",
        stat: "border-red-100/12 bg-red-100/[0.06]",
        line: "via-red-100/16",
    },
    cold: {
        shell: "border-cyan-100/18 bg-[linear-gradient(135deg,rgba(8,47,73,0.56),rgba(24,24,27,0.92)_50%,rgba(14,116,144,0.15))] shadow-[0_24px_90px_rgba(34,211,238,0.12)]",
        glow: "from-cyan-200/20 via-sky-300/8 to-transparent",
        icon: "border-cyan-100/22 bg-cyan-300/11 text-cyan-100",
        eyebrow: "text-cyan-100/72",
        stat: "border-cyan-100/10 bg-cyan-100/[0.055]",
        line: "via-cyan-100/15",
    },
};
const ICONS = {
    crown: Crown,
    rocket: Rocket,
    flame: Flame,
    popcorn: Popcorn,
    dollar: BadgeDollarSign,
    scale: Scale,
    trendDown: TrendingDown,
    snowflake: Snowflake,
} satisfies Record<FinancialBadgeIcon, typeof Crown>;
export default function TitleFinancialBadge({ insight, }: TitleFinancialBadgeProps) {
    if (!insight)
        return null;
    const tone = TONE_STYLES[insight.tone];
    const Icon = ICONS[insight.icon];
    return (<aside className={`relative w-full overflow-hidden rounded-2xl border px-4 py-4 backdrop-blur-xl sm:px-5 ${tone.shell}`} aria-label={uiMessage("ui.e97cb37f3f15")}>
      <div className={`pointer-events-none absolute -inset-x-8 -top-16 h-32 bg-gradient-to-r blur-2xl ${tone.glow}`} aria-hidden/>
      <div className="pointer-events-none absolute inset-0 opacity-[0.16] [background-image:linear-gradient(115deg,transparent_0%,rgba(255,255,255,0.20)_44%,transparent_54%)]" aria-hidden/>
      <div className={`pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent to-transparent ${tone.line}`} aria-hidden/>

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] ${tone.icon}`} aria-hidden>
          <Icon className="h-6 w-6" strokeWidth={2.2}/>
        </div>

        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-black uppercase tracking-[0.20em] ${tone.eyebrow}`}>
            {insight.kicker}
          </p>
          <h2 className="mt-1 break-words text-[clamp(1.25rem,3.5vw,2rem)] font-black uppercase leading-none tracking-[0.02em] text-white">
            {insight.label}
          </h2>
          <p className="mt-2 max-w-2xl text-[12.5px] font-semibold leading-relaxed text-white/68 sm:text-[13px]">
            {insight.context}
          </p>
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-2 sm:w-[172px] sm:grid-cols-1">
          <BadgeStat label="Bilheteria" value={insight.revenueLabel} className={tone.stat}/>
          <BadgeStat label={uiMessage("ui.4ac740f7ea43")} value={insight.budgetLabel} className={tone.stat}/>
          <BadgeStat label="Retorno" value={insight.breakevenRatioLabel} className={tone.stat}/>
        </div>
      </div>
    </aside>);
}
function BadgeStat({ label, value, className, }: {
    label: string;
    value: string;
    className: string;
}) {
    return (<div className={`min-w-0 rounded-xl border px-2.5 py-2 text-center ${className}`}>
      <p className="truncate text-[7.5px] font-black uppercase tracking-[0.08em] text-white/42">
        {label}
      </p>
      <p className="mt-1 truncate text-[10.5px] font-black tracking-[-0.01em] text-white/88 sm:text-[11px]">
        {value}
      </p>
    </div>);
}

