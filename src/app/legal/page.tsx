import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import PageShell from "@/components/layout/PageShell";
import { getLegalDocument, LEGAL_TERMS_VERSION } from "@/lib/legal/legal-content";
import { normalizeInterfaceLanguage } from "@/server/source-engine/locale";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const interfaceLanguage = normalizeInterfaceLanguage(
    cookieStore.get("poplog_interface_language")?.value,
  );
  const doc = getLegalDocument(interfaceLanguage);
  return {
    title: doc.metaTitle,
    description: doc.metaDescription,
  };
}

export default async function LegalPage() {
  const cookieStore = await cookies();
  const interfaceLanguage = normalizeInterfaceLanguage(
    cookieStore.get("poplog_interface_language")?.value,
  );
  const doc = getLegalDocument(interfaceLanguage);

  return (
    <PageShell variant="centered">
      <article className="mx-auto w-full max-w-3xl py-6 sm:py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white/40 transition hover:text-white/70"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          POPLOG
        </Link>

        <header className="mt-5 border-b border-white/[0.08] pb-6">
          <h1 className="text-2xl font-black tracking-[-0.03em] text-white sm:text-4xl">
            {doc.title}
          </h1>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
            {doc.updatedLabel} {LEGAL_TERMS_VERSION}
          </p>
          <p className="mt-4 text-sm leading-7 text-white/55">{doc.intro}</p>
        </header>

        <div className="mt-8 flex flex-col gap-10">
          {doc.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-lg font-bold tracking-[-0.01em] text-white/90 sm:text-xl">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="text-sm leading-7 text-white/60">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}

          <section className="space-y-2 border-t border-white/[0.08] pt-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-white/45">
              {doc.referencesLabel}
            </h2>
            <ul className="space-y-1.5">
              {doc.references.map((reference) => (
                <li key={reference} className="text-xs leading-6 text-white/45">
                  {reference}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </article>
    </PageShell>
  );
}
