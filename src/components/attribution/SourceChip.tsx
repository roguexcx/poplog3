import { getSourceLabel } from "@/attribution/helpers";

type SourceChipProps = {
  sourceId: string;
  className?: string;
};

export default function SourceChip({
  sourceId,
  className = "",
}: SourceChipProps) {
  return (
    <span
      className={[
        "rounded-full bg-white/[0.035] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/38 ring-1 ring-white/[0.06]",
        className,
      ].join(" ")}
    >
      {getSourceLabel(sourceId)}
    </span>
  );
}
