"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { usePathname } from "next/navigation";
import SearchBar from "@/features/search/SearchBar";
const HIDDEN_EXACT_PATHS = new Set(["/", "/buscar"]);
const HIDDEN_PREFIXES = ["/admin", "/debug"];
export default function GlobalSearchHeader() {
    const pathname = usePathname();
    const shouldHide = HIDDEN_EXACT_PATHS.has(pathname) ||
        HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    if (shouldHide)
        return null;
    return (<div className="sticky top-0 z-40 -mx-4 mb-5 border-b border-white/[0.06] bg-[#020617]/86 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 md:-mx-8 md:mb-6 md:px-8 md:py-4 lg:-mx-10 lg:px-10">
      <div className="mx-auto w-full max-w-[920px]">
        <SearchBar variant="global" placeholder={uiMessage("ui.40e76332b289")}/>
      </div>
    </div>);
}

