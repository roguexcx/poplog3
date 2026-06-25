"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, } from "react";
import { ArrowRight, Building2, ImageIcon, Search, UserRound } from "lucide-react";
import TmdbImage from "@/components/images/TmdbImage";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import { getOriginalTitle, getRating, getReleaseYear, getTitle } from "@/lib/tmdb-utils";
import { useDebouncedGlobalSearch } from "@/hooks/useDebouncedGlobalSearch";
import { type QuickSearchCompany, type QuickSearchPerson, type QuickSearchTitle, } from "./useSearch";
// Static so the hook's effect deps stay stable across renders.
const SEARCH_EXTRA_PARAMS = { type: "all", page: "1" } as const;
const MAX_VISIBLE_TITLES = 5;
const MAX_VISIBLE_PEOPLE = 3;
const MAX_VISIBLE_COMPANIES = 2;
type SearchBarVariant = "hero" | "global";
type SearchBarProps = {
    variant?: SearchBarVariant;
    className?: string;
    placeholder?: string;
};
type SearchOption = {
    key: string;
    href: string;
};
function titleLinkId(item: QuickSearchTitle) {
    return (item.linkIdUsed ??
        item.poplogId ??
        item.externalIds?.imdbId ??
        item.externalIds?.balloonerismmId ??
        item.id);
}
function titleHref(item: QuickSearchTitle) {
    return `/title/${item.media_type}/${titleLinkId(item)}`;
}
function searchHref(query: string) {
    return `/buscar?q=${encodeURIComponent(query.trim())}`;
}
function optionDomId(listboxId: string, key: string) {
    return `${listboxId}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
function knownForLabel(person: QuickSearchPerson) {
    return person.known_for
        .map((item) => item.title)
        .filter(Boolean)
        .slice(0, 2)
        .join(", ");
}
function SectionLabel({ children }: {
    children: string;
}) {
    return (<div className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/28">
      {children}
    </div>);
}
export default function SearchBar({ variant = "hero", className = "", placeholder, }: SearchBarProps) {
    const router = useRouter();
    const listboxId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const isGlobal = variant === "global";
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const search = useDebouncedGlobalSearch({
        language: "pt-BR",
        region: "BR",
        endpoint: "/api/poplog3/search",
        includeExtras: true,
        extraParams: SEARCH_EXTRA_PARAMS,
        minQueryLength: 1,
        debounceMs: 300,
    });
    const setSearchQuery = search.setQuery;
    useEffect(() => {
        setSearchQuery(query);
    }, [query, setSearchQuery]);
    const results = search.results as unknown as QuickSearchTitle[];
    const people = (search.people as unknown as QuickSearchPerson[]).filter((person) => Boolean(person.href));
    const companies = search.companies as unknown as QuickSearchCompany[];
    const loading = search.isLoading;
    const trimmedQuery = query.trim();
    const visibleResults = results.slice(0, MAX_VISIBLE_TITLES);
    const visiblePeople = people.slice(0, MAX_VISIBLE_PEOPLE);
    const visibleCompanies = companies.slice(0, MAX_VISIBLE_COMPANIES);
    const titleOptions = visibleResults.map((item) => ({
        key: `title-${item.media_type}-${titleLinkId(item)}`,
        href: titleHref(item),
        item,
    }));
    const personOptions = visiblePeople.map((person) => ({
        key: `person-${person.id}`,
        href: person.href,
        item: person,
    }));
    const companyOptions = visibleCompanies.map((company) => ({
        key: `company-${company.id ?? company.name}`,
        href: searchHref(trimmedQuery),
        item: company,
    }));
    const actionOptions: SearchOption[] = [
        ...titleOptions,
        ...personOptions,
        ...companyOptions,
    ].map(({ key, href }) => ({ key, href }));
    const activeOption = actionOptions[activeIndex] ?? null;
    useEffect(() => {
        setActiveIndex(0);
        setIsOpen(trimmedQuery.length > 0);
    }, [trimmedQuery]);
    useEffect(() => {
        setActiveIndex((current) => {
            if (actionOptions.length === 0)
                return 0;
            return Math.min(current, actionOptions.length - 1);
        });
    }, [actionOptions.length]);
    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);
    function closeSearch() {
        setQuery("");
        setIsOpen(false);
    }
    function getOptionIndex(key: string) {
        return actionOptions.findIndex((option) => option.key === key);
    }
    function activateOption(key: string) {
        const index = getOptionIndex(key);
        if (index >= 0)
            setActiveIndex(index);
    }
    function navigateTo(index: number) {
        const item = actionOptions[index];
        if (!item) {
            if (trimmedQuery) {
                closeSearch();
                router.push(searchHref(trimmedQuery));
            }
            return;
        }
        closeSearch();
        router.push(item.href);
    }
    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Escape") {
            setIsOpen(false);
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            navigateTo(activeIndex);
            return;
        }
        if (!actionOptions.length)
            return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i >= actionOptions.length - 1 ? 0 : i + 1));
        }
        else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => (i <= 0 ? actionOptions.length - 1 : i - 1));
        }
    }
    const showDropdown = isOpen && trimmedQuery.length > 0;
    const inputClassName = [
        "w-full border text-white/85 outline-none transition placeholder:text-white/30",
        "focus:border-white/[0.18] focus:bg-white/[0.075]",
        isGlobal
            ? "h-11 rounded-2xl border-white/[0.08] bg-black/30 pl-11 pr-4 text-[13px] shadow-[0_10px_34px_rgba(0,0,0,0.18)]"
            : "h-[52px] rounded-[14px] border-white/[0.09] bg-white/[0.05] px-[46px] text-[14px]",
    ].join(" ");
    const dropdownClassName = [
        "absolute left-0 right-0 z-[90] overflow-hidden border border-white/[0.09]",
        "bg-[#0d1120]/95 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl",
        isGlobal
            ? "top-[calc(100%+8px)] max-h-[min(72vh,520px)] overflow-y-auto rounded-2xl thin-scrollbar"
            : "top-[calc(100%+10px)] rounded-[14px]",
    ].join(" ");
    const posterClassName = isGlobal
        ? "relative h-[58px] w-10 shrink-0 overflow-hidden rounded-md bg-white/[0.05]"
        : "relative h-[72px] w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]";
    return (<div ref={containerRef} className={[
            "relative z-[80] w-full",
            isGlobal ? "max-w-full" : "max-w-2xl",
            className,
        ].join(" ")}>
      <div className="relative">
        <Search className={[
            "pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 text-white/35",
            isGlobal ? "left-4 size-4" : "left-[18px] size-[17px]",
        ].join(" ")} aria-hidden/>
        <input type="text" role="combobox" aria-expanded={showDropdown} aria-controls={listboxId} aria-activedescendant={activeOption ? optionDomId(listboxId, activeOption.key) : undefined} aria-autocomplete="list" aria-label={uiMessage("ui.a2ff6876f791")} placeholder={placeholder ?? uiMessage("ui.be0f096ae3b3")} value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => {
            if (trimmedQuery)
                setIsOpen(true);
        }} onKeyDown={handleKeyDown} className={inputClassName}/>
      </div>

      {showDropdown && (<div id={listboxId} role="listbox" className={dropdownClassName}>
          {loading && (<p className="px-4 py-3 text-[13px] text-white/35">Buscando...</p>)}

          {!loading && titleOptions.length > 0 && (<>
              <SectionLabel>{uiMessage("ui.2677f29adf16")}</SectionLabel>
              {titleOptions.map((option) => {
                    const item = option.item;
                    const type = item.media_type;
                    const title = getTitle(item);
                    const originalTitle = getOriginalTitle(item);
                    const year = getReleaseYear(item);
                    const rating = getRating(item);
                    const posterPath = item.poster_path ?? null;
                    const isActive = activeOption?.key === option.key;
                    return (<Link id={optionDomId(listboxId, option.key)} key={option.key} href={option.href} role="option" aria-selected={isActive} className={[
                            "flex gap-3 border-b border-white/[0.05] px-4 py-3 transition last:border-b-0",
                            isActive
                                ? "bg-white/[0.07]"
                                : "bg-transparent hover:bg-white/[0.04]",
                        ].join(" ")} onMouseEnter={() => activateOption(option.key)} onClick={closeSearch}>
                    <div className={posterClassName}>
                      <TmdbImage path={posterPath} kind="poster" size="card" alt={title} fill sizes={isGlobal ? "40px" : "48px"} className="object-cover opacity-90" fallback={<div className="flex h-full w-full items-center justify-center text-white/20">
                            <ImageIcon className="size-4" aria-hidden/>
                          </div>}/>
                    </div>

                    <div className="min-w-0 flex-1 py-0.5">
                      <LocalizedTitle as="h3" title={title} originalTitle={originalTitle} variant="compact"/>
                      <p className="mt-[3px] truncate text-[11px] text-white/35">
                        {type === "movie" ? "Filme" : uiMessage("ui.74f19285073a")}
                        {year !== "----" ? ` · ${year}` : ""}
                      </p>
                      {rating && (<p className="mt-2 text-[11px] font-semibold text-yellow-400/70">
                          {rating}
                        </p>)}
                    </div>
                  </Link>);
                })}
            </>)}

          {!loading && personOptions.length > 0 && (<>
              <SectionLabel>Pessoas</SectionLabel>
              {personOptions.map((option) => {
                    const person = option.item;
                    const isActive = activeOption?.key === option.key;
                    const knownFor = knownForLabel(person);
                    return (<Link id={optionDomId(listboxId, option.key)} key={option.key} href={option.href} role="option" aria-selected={isActive} className={[
                            "flex gap-3 border-b border-white/[0.05] px-4 py-3 transition last:border-b-0",
                            isActive
                                ? "bg-white/[0.07]"
                                : "bg-transparent hover:bg-white/[0.04]",
                        ].join(" ")} onMouseEnter={() => activateOption(option.key)} onClick={closeSearch}>
                    <div className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.05]">
                      <TmdbImage path={person.profile_path} kind="poster" size="w185" alt={person.name} fill sizes="58px" className="object-cover opacity-90" fallback={<UserRound className="size-5 text-white/25" aria-hidden/>}/>
                    </div>

                    <div className="min-w-0 flex-1 py-0.5">
                      <p className="truncate text-[13px] font-bold text-white/88">
                        {person.name}
                      </p>
                      <p className="mt-[3px] truncate text-[11px] text-white/35">
                        {person.known_for_department ?? "Cinema e TV"}
                      </p>
                      {knownFor && (<p className="mt-1.5 line-clamp-1 text-[11px] text-white/30">
                          {knownFor}
                        </p>)}
                    </div>
                  </Link>);
                })}
            </>)}

          {!loading && companyOptions.length > 0 && (<>
              <SectionLabel>{uiMessage("ui.b357cfe89fe1")}</SectionLabel>
              {companyOptions.map((option) => {
                    const company = option.item as QuickSearchCompany;
                    const isActive = activeOption?.key === option.key;
                    return (<Link id={optionDomId(listboxId, option.key)} key={option.key} href={option.href} role="option" aria-selected={isActive} className={[
                            "flex gap-3 border-b border-white/[0.05] px-4 py-3 transition last:border-b-0",
                            isActive
                                ? "bg-white/[0.07]"
                                : "bg-transparent hover:bg-white/[0.04]",
                        ].join(" ")} onMouseEnter={() => activateOption(option.key)} onClick={closeSearch}>
                    <div className="relative flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.05]">
                      <TmdbImage path={company.logo_path} kind="poster" size="w185" alt={company.name} fill sizes="52px" className="object-contain p-2 opacity-90" fallback={<Building2 className="size-5 text-white/25" aria-hidden/>}/>
                    </div>

                    <div className="min-w-0 flex-1 py-0.5">
                      <p className="truncate text-[13px] font-bold text-white/88">
                        {company.name}
                      </p>
                      <p className="mt-[3px] truncate text-[11px] text-white/35">
                        {company.origin_country ?? "Explorar na busca"}
                      </p>
                      {company.description && (<p className="mt-1.5 line-clamp-1 text-[11px] text-white/30">
                          {company.description}
                        </p>)}
                    </div>
                  </Link>);
                })}
            </>)}

          {!loading && actionOptions.length === 0 && (<div className="px-4 py-4 text-[13px] text-white/35">{uiMessage("ui.6d9b8dedfdc6")}</div>)}

          <Link href={searchHref(trimmedQuery)} className="flex items-center justify-center gap-1.5 border-t border-white/[0.05] px-4 py-2.5 text-[11px] text-white/40 transition hover:bg-white/[0.04] hover:text-white/60" onClick={closeSearch}>{uiMessage("ui.9b44569bd1b9")}<ArrowRight className="size-3" aria-hidden/>
          </Link>
        </div>)}
    </div>);
}

