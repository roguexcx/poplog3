import { API_SOURCES } from "@/attribution/api-sources";
import { getSourceLabel, normalizeSourceId } from "@/attribution/helpers";

type SourceLogoProps = {
  sourceId: string;
  className?: string;
};

export default function SourceLogo({
  sourceId,
  className = "",
}: SourceLogoProps) {
  const id = normalizeSourceId(sourceId);
  const source = id ? API_SOURCES[id] : null;

  if (source?.logoUrl) {
    return (
      <span
        className={[
          "inline-flex h-5 w-16 items-center opacity-65 grayscale transition group-hover/source:opacity-90 group-hover/source:grayscale-0",
          className,
        ].join(" ")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source.logoUrl}
          alt={source.name}
          className="max-h-5 w-auto object-contain"
        />
      </span>
    );
  }

  const label = getSourceLabel(sourceId);

  return (
    <span
      className={[
        "inline-flex h-5 min-w-10 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.025] px-2 text-[9px] font-black uppercase tracking-[0.16em] text-white/35 transition group-hover/source:border-white/[0.16] group-hover/source:text-white/60",
        className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
