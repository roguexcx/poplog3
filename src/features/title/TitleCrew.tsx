import { uiMessage } from "@/lib/i18n/ui-message";
import Link from "next/link";
import SectionHeader from "@/components/ui/SectionHeader";
import { buildPersonHref } from "@/lib/routes/person";
import type { TitleCrewMember } from "./types";
type TitleCrewProps = {
    crew?: TitleCrewMember[];
    /** Criadores explicitos (serie) — entram como primeiro grupo. */
    creators?: Array<{
        id: number | string;
        name: string;
    }>;
};
type CrewGroup = {
    label: string;
    members: TitleCrewMember[];
};
// Mapa de job TMDB → label PT-BR. Jobs nao listados sao agrupados sob o label "Equipe".
const JOB_LABELS: Record<string, string> = {
    Director: uiMessage("ui.5f7970bcbecb"),
    Screenplay: "Roteiro",
    Writer: "Roteiro",
    Story: uiMessage("ui.da3160f7e8cd"),
    Teleplay: "Roteiro",
    Author: "Autor",
    "Original Music Composer": "Trilha sonora",
    Music: uiMessage("ui.578afe0c7fba"),
    "Director of Photography": uiMessage("ui.804c17356c6d"),
    Editor: "Montagem",
    Producer: uiMessage("ui.43a94f5ce3bc"),
    "Executive Producer": uiMessage("ui.5682da3e235a"),
};
// Ordem de exibicao das categorias.
const CATEGORY_ORDER = [
    uiMessage("ui.5f7970bcbecb"),
    uiMessage("ui.5da53a7a65e3"),
    "Roteiro",
    uiMessage("ui.da3160f7e8cd"),
    "Autor",
    "Trilha sonora",
    uiMessage("ui.578afe0c7fba"),
    uiMessage("ui.804c17356c6d"),
    "Montagem",
    uiMessage("ui.5682da3e235a"),
    uiMessage("ui.43a94f5ce3bc"),
    "Equipe",
];
export default function TitleCrew({ crew, creators }: TitleCrewProps) {
    const groups = new Map<string, TitleCrewMember[]>();
    // Criadores entram primeiro como categoria propria.
    if (creators && creators.length > 0) {
        groups.set(uiMessage("ui.5da53a7a65e3"), creators.map((c) => ({
            id: c.id,
            name: c.name,
            job: "Creator",
        })));
    }
    for (const person of crew ?? []) {
        const label = JOB_LABELS[person.job] ?? "Equipe";
        const arr = groups.get(label) ?? [];
        // Deduplica por id+label.
        if (!arr.some((p) => String(p.id) === String(person.id))) {
            arr.push(person);
        }
        groups.set(label, arr);
    }
    if (groups.size === 0)
        return null;
    const ordered: CrewGroup[] = CATEGORY_ORDER.filter((label) => groups.has(label)).map((label) => ({ label, members: groups.get(label)! }));
    return (<section className="flex flex-col gap-4 sm:gap-5">
      <SectionHeader eyebrow="Equipe" title={uiMessage("ui.9901c75a55bc")} accent="cyan"/>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((group) => (<div key={group.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 backdrop-blur-md transition duration-300 hover:border-white/[0.16] hover:bg-white/[0.05]">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200/70">
              {group.label}
            </p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {group.members.slice(0, 4).map((p) => {
                const href = buildPersonHref({ id: p.id });
                const jobBadge = p.job !== group.label && p.job !== "Creator" ? (<span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">
                      {p.job}
                    </span>) : null;
                return (<li key={`${p.id}-${p.job}`}>
                    {href ? (<Link href={href} className="group inline-flex items-baseline gap-2 text-[14px] leading-snug text-white/82 transition hover:text-white">
                        <span className="font-semibold tracking-[-0.01em] group-hover:underline group-hover:decoration-cyan-300/60 group-hover:decoration-2 group-hover:underline-offset-4">
                          {p.name}
                        </span>
                        {jobBadge}
                      </Link>) : (<span className="inline-flex items-baseline gap-2 text-[14px] leading-snug text-white/82">
                        <span className="font-semibold tracking-[-0.01em]">{p.name}</span>
                        {jobBadge}
                      </span>)}
                  </li>);
            })}
            </ul>
          </div>))}
      </div>
    </section>);
}

