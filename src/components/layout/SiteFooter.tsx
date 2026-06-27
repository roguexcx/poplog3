import Link from "next/link";
import { cookies } from "next/headers";

import LocaleFooterSwitch from "@/components/layout/LocaleFooterSwitch";
import { normalizeInterfaceLanguage } from "@/server/source-engine/locale";

const FOOTER_COPY = {
  "pt-BR": {
    disclaimer:
      "O POPLOG e uma plataforma de curadoria e indexacao de metadados. Nao hospeda nem distribui obras protegidas por direitos autorais. Marcas, posters e titulos pertencem aos respectivos titulares.",
    legal: "Termos e Privacidade",
  },
  "en-US": {
    disclaimer:
      "POPLOG is a metadata curation and indexing platform. It does not host or distribute copyrighted works. Trademarks, posters and titles belong to their respective owners.",
    legal: "Terms and Privacy",
  },
} as const;

export default async function SiteFooter() {
  const cookieStore = await cookies();
  const language = normalizeInterfaceLanguage(cookieStore.get("poplog_interface_language")?.value) as keyof typeof FOOTER_COPY;
  const copy = FOOTER_COPY[language];

  return (
    <footer className="mx-auto mt-10 w-full max-w-[1600px] border-t border-white/[0.06] px-1 pb-28 pt-5 md:pb-8">
      <div className="flex flex-col gap-4 text-center md:flex-row md:items-center md:justify-between md:text-left">
        <p className="text-[10px] leading-5 text-white/25 md:max-w-2xl">
          {copy.disclaimer}
        </p>
        <nav className="flex flex-col items-center justify-center gap-3 md:items-end md:justify-end">
          <Link
            href="/legal"
            className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35 transition hover:text-white/70"
          >
            {copy.legal}
          </Link>
          <LocaleFooterSwitch />
        </nav>
      </div>
    </footer>
  );
}
