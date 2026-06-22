import type { TitlePageData } from "./types";

type TitleSynopsisProps = {
  title: TitlePageData;
};

/**
 * Card de sinopse separado — usado fora do hero quando a overview é longa
 * o suficiente pra merecer respiro próprio (>= ~280 caracteres).
 *
 * No layout atual o hero já mostra a sinopse, então este componente fica
 * disponível como opção pra ativar depois ou em variantes de layout.
 */
export default function TitleSynopsis({ title }: TitleSynopsisProps) {
  if (!title.overview) return null;

  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-6 backdrop-blur-xl sm:p-8 md:p-10">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(99,102,241,0.10),transparent_45%),radial-gradient(circle_at_95%_100%,rgba(244,114,182,0.08),transparent_45%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
        aria-hidden
      />

      <div className="relative">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/70">
          Sinopse
        </p>
        <p className="mt-4 max-w-3xl text-[15px] leading-[1.75] text-white/76 sm:text-base">
          {title.overview}
        </p>
      </div>
    </section>
  );
}
