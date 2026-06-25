"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { TRENDING_SHORTCUTS, CURATED_GROUPS, STANDALONE_GENRES, MOODS, type ShortcutAccent, } from "@/lib/discovery/shortcuts-config";
// ─── Accent classes ───────────────────────────────────────────────────────────
const ACCENT_ACTIVE: Record<ShortcutAccent, string> = {
    rose: "border-rose-400/45   bg-rose-500/[0.14]   text-rose-200",
    blue: "border-blue-400/45   bg-blue-500/[0.14]   text-blue-200",
    violet: "border-violet-400/45 bg-violet-500/[0.14] text-violet-200",
    amber: "border-amber-400/45  bg-amber-500/[0.14]  text-amber-200",
    green: "border-green-400/45  bg-green-500/[0.14]  text-green-200",
    indigo: "border-indigo-400/45 bg-indigo-500/[0.14] text-indigo-200",
    teal: "border-teal-400/45   bg-teal-500/[0.14]   text-teal-200",
    orange: "border-orange-400/45 bg-orange-500/[0.14] text-orange-200",
};
const CHIP_BASE = "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition sm:shrink sm:px-3.5 sm:py-2 sm:text-[12px]";
const CHIP_INACTIVE = "border-white/[0.08] bg-black/15 text-white/55 hover:border-white/[0.14] hover:bg-white/[0.065] hover:text-white/80";
// ─── Types ────────────────────────────────────────────────────────────────────
type Props = {
    activeSlug: string;
    onSelect: (slug: string) => void;
};
type ChipItem = {
    id: string;
    label: string;
    icon: string;
    accent: ShortcutAccent;
};
// ─── Chip component ───────────────────────────────────────────────────────────
function Chip({ item, active, onSelect }: {
    item: ChipItem;
    active: boolean;
    onSelect: (id: string) => void;
}) {
    return (<button type="button" onClick={() => onSelect(item.id)} className={[CHIP_BASE, active ? ACCENT_ACTIVE[item.accent] : CHIP_INACTIVE].join(" ")}>
      <span className="text-[13px] leading-none">{item.icon}</span>
      {item.label}
    </button>);
}
// ─── Scrollable chip row ──────────────────────────────────────────────────────
function ChipRow({ chips, activeSlug, onSelect }: {
    chips: ChipItem[];
    activeSlug: string;
    onSelect: (id: string) => void;
}) {
    return (<div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="flex gap-2 sm:flex-wrap">
        {chips.map((chip) => (<Chip key={chip.id} item={chip} active={activeSlug === chip.id} onSelect={onSelect}/>))}
      </div>
    </div>);
}
// ─── Section ──────────────────────────────────────────────────────────────────
function Section({ label, children }: {
    label: string;
    children: React.ReactNode;
}) {
    return (<div className="flex flex-col gap-2.5">
      <p className="text-[9.5px] font-black uppercase tracking-[0.22em] text-white/35">{label}</p>
      {children}
    </div>);
}
// ─── Component ────────────────────────────────────────────────────────────────
export default function ExploreShortcuts({ activeSlug, onSelect }: Props) {
    const trendingChips: ChipItem[] = TRENDING_SHORTCUTS.map((s) => ({
        id: s.id,
        label: s.label,
        icon: s.icon,
        accent: s.accent,
    }));
    const genreChips: ChipItem[] = [
        ...CURATED_GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon, accent: g.accent })),
        ...STANDALONE_GENRES.map((g) => ({ id: g.id, label: g.label, icon: g.icon, accent: g.accent })),
    ];
    const moodChips: ChipItem[] = MOODS.map((m) => ({
        id: m.id,
        label: m.label,
        icon: m.icon,
        accent: m.accent,
    }));
    return (<div className="flex flex-col gap-5 rounded-[1.35rem] border border-white/[0.055] bg-white/[0.018] p-4 sm:gap-6 sm:p-5 lg:p-6">
      <Section label={uiMessage("ui.5f872742d21f")}>
        <ChipRow chips={trendingChips} activeSlug={activeSlug} onSelect={onSelect}/>
      </Section>

      <Section label={uiMessage("ui.72eae8bad5da")}>
        <ChipRow chips={genreChips} activeSlug={activeSlug} onSelect={onSelect}/>
      </Section>

      <Section label="Moods">
        <ChipRow chips={moodChips} activeSlug={activeSlug} onSelect={onSelect}/>
      </Section>
    </div>);
}

