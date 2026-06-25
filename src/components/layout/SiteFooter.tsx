import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="mx-auto mt-10 w-full max-w-[1600px] border-t border-white/[0.06] px-1 pb-28 pt-5 md:pb-8">
      <div className="flex flex-col gap-3 text-center md:flex-row md:items-center md:justify-between md:text-left">
        <p className="text-[10px] leading-5 text-white/25 md:max-w-2xl">
          O POPLOG e uma plataforma de curadoria e indexacao de metadados. Nao hospeda nem
          distribui obras protegidas por direitos autorais. Marcas, posters e titulos pertencem aos
          respectivos titulares.
        </p>
        <nav className="flex items-center justify-center gap-4 md:justify-end">
          <Link
            href="/legal"
            className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35 transition hover:text-white/70"
          >
            Termos e Privacidade
          </Link>
        </nav>
      </div>
    </footer>
  );
}
