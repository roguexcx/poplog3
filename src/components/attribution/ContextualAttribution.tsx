import {
  formatContextualAttribution,
  resolveSources,
} from "@/attribution/helpers";
import type { AttributionContext } from "@/attribution/types";

type ContextualAttributionProps = {
  context: AttributionContext;
  sourcesUsed: Array<string | null | undefined>;
  className?: string;
};

export default function ContextualAttribution({
  context,
  sourcesUsed,
  className = "",
}: ContextualAttributionProps) {
  const label = formatContextualAttribution(context, sourcesUsed);
  const sources = resolveSources(sourcesUsed);

  if (!label || sources.length === 0) return null;

  return (
    <p
      className={[
        "text-[9px] font-bold uppercase tracking-[0.16em] text-white/24 transition-colors hover:text-white/42",
        className,
      ].join(" ")}
      title={sources.map((source) => source.role).join(" ")}
    >
      {label}
    </p>
  );
}
