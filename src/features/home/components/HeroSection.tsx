import { uiMessageFor } from "@/lib/i18n/ui-message";
import Image from "next/image";
import Link from "next/link";
import { Film, Radar, Sparkles, Tv } from "lucide-react";
import SearchBar from "@/features/search/SearchBar";
import FeaturedCard from "@/features/home/components/FeaturedCard";
import { getHeroHeadline } from "@/features/home/home-utils";
import type { TMDBItem } from "@/types/tmdb";
type Props = {
    backdropUrl: string | null;
    featuredItem: TMDBItem | null;
    featuredType: "movie" | "tv";
    featuredTitle: string;
    featuredRank: number | null;
    featuredTypeLabel: string;
    posterUrl: string | null;
    year: string | null;
    runtime: string | null;
    seasons: number | null;
    genres: string | null;
    overview: string | null;
    interfaceLanguage: string;
};
const MOBILE_NAV_TONE = {
    sky: "border-sky-300/18 bg-sky-400/[0.08] text-sky-100",
    violet: "border-violet-300/18 bg-violet-400/[0.08] text-violet-100",
    emerald: "border-emerald-300/18 bg-emerald-400/[0.08] text-emerald-100",
    amber: "border-amber-300/18 bg-amber-400/[0.08] text-amber-100",
};
function mobileNavTriggers(language: string) {
    const ui = (key: string) => uiMessageFor(language, key);
    const isEnglish = language === "en-US";
    return [
        {
            href: "/radar",
            label: ui("ui.aad82db2cb77"),
            desc: isEnglish ? "What's premiering" : "O que estreia",
            icon: Radar,
            tone: "sky",
        },
        {
            href: "#trending",
            label: ui("ui.a43ecccd27a7"),
            desc: isEnglish ? "Trending now" : "Em alta agora",
            icon: Sparkles,
            tone: "violet",
        },
        {
            href: "/buscar?type=movie",
            label: isEnglish ? "Movies" : "Filmes",
            desc: ui("ui.b41f9ffd0e27"),
            icon: Film,
            tone: "emerald",
        },
        {
            href: "/buscar?type=tv",
            label: ui("ui.de212174bc0c"),
            desc: ui("ui.b41f9ffd0e27"),
            icon: Tv,
            tone: "amber",
        },
    ] as const;
}
export default function HeroSection({ backdropUrl, featuredItem, featuredType, featuredTitle, featuredRank, featuredTypeLabel, posterUrl, year, runtime, seasons, genres, overview, interfaceLanguage, }: Props) {
    const heroHeadline = getHeroHeadline(interfaceLanguage);
    const navTriggers = mobileNavTriggers(interfaceLanguage);
    return (<section className="-mx-4 -mt-4 relative z-30 min-h-[66vh] overflow-visible sm:-mx-6 md:-mx-8 md:-mt-6 lg:-mx-10">
      {/* Backdrop: next/image com priority garante fetchpriority=high e preload no <head> */}
      {backdropUrl && (<div className="absolute inset-0 overflow-hidden">
          <Image src={backdropUrl} alt="" fill priority sizes="(max-width: 768px) 100vw, (max-width: 1280px) 100vw, 1280px" className="object-cover object-center" aria-hidden/>
        </div>)}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(2,6,23,0.96)_0%,rgba(2,6,23,0.78)_32%,rgba(2,6,23,0.26)_64%,rgba(2,6,23,0.70)_100%)]"/>
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.86)_0%,transparent_22%,rgba(2,6,23,0.28)_54%,#020617_100%)]"/>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_38%_12%,rgba(56,189,248,0.22),transparent_32%)]"/>
      <div className="absolute inset-y-0 right-0 w-[48%] bg-[linear-gradient(to_left,rgba(2,6,23,0.98)_0%,rgba(2,6,23,0.88)_28%,rgba(2,6,23,0.46)_58%,rgba(2,6,23,0.10)_82%,transparent_100%)]"/>
      <div className="absolute inset-0 opacity-[0.035] [background-image:radial-gradient(circle_at_center,white_1px,transparent_1px)] [background-size:24px_24px]"/>

      <div className="relative z-10 mx-auto grid min-h-[66vh] max-w-[1560px] items-center gap-10 px-6 pb-16 pt-8 md:px-10 lg:grid-cols-[1fr_500px]">
        <div className="max-w-3xl">
          <p className="mb-7 text-[11px] font-bold uppercase leading-5 tracking-[0.38em] text-zinc-300">{uiMessageFor(interfaceLanguage, "ui.cd435800aca8")}<br />{uiMessageFor(interfaceLanguage, "ui.b5efcd17e77d")}</p>

          <h1 className="max-w-3xl text-[3.2rem] font-black leading-[0.88] tracking-tight text-white sm:text-[4.1rem] md:text-[5.4rem]">
            {heroHeadline.map((line) => (<span key={line} className="block">
                {line}
              </span>))}
          </h1>

          <div className="relative z-50 mt-8 max-w-2xl">
            <SearchBar />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 md:hidden">
            {navTriggers.map((item) => {
            const Icon = item.icon;
            const className = [
                "group flex min-h-[72px] items-center gap-3 rounded-2xl border p-3 text-left backdrop-blur-md transition active:scale-[0.98]",
                MOBILE_NAV_TONE[item.tone],
            ].join(" ");
            const content = (<>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-black/25">
                    <Icon className="h-5 w-5"/>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-black tracking-[-0.01em] text-white">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] font-semibold text-white/40">
                      {item.desc}
                    </span>
                  </span>
                </>);
            return item.href.startsWith("#") ? (<a key={item.href} href={item.href} className={className}>
                  {content}
                </a>) : (<Link key={item.href} href={item.href} className={className}>
                  {content}
                </Link>);
        })}
          </div>

        </div>

        {featuredItem && (<FeaturedCard item={featuredItem} mediaType={featuredType} title={featuredTitle} featuredRank={featuredRank} featuredTypeLabel={featuredTypeLabel} posterUrl={posterUrl} year={year} runtime={runtime} seasons={seasons} genres={genres} overview={overview} interfaceLanguage={interfaceLanguage}/>)}
      </div>
    </section>);
}
