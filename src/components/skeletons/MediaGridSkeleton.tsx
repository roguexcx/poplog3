type MediaGridSkeletonProps = {
  items?: number;
  className?: string;
  showMetaRows?: boolean;
  ariaLabel?: string;
};

function SkeletonCard({ showMetaRows = true }: { showMetaRows?: boolean }) {
  return (
    <article className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] shadow-sm">
      <div className="relative aspect-[2/3] overflow-hidden bg-white/[0.06]">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      </div>
      <div className="space-y-3 p-3">
        <div className="h-4 w-4/5 rounded bg-white/[0.08]" />
        {showMetaRows ? (
          <>
            <div className="h-3 w-2/5 rounded bg-white/[0.06]" />
            <div className="flex items-center gap-2">
              <div className="h-6 w-16 rounded-full bg-white/[0.06]" />
              <div className="h-6 w-20 rounded-full bg-white/[0.06]" />
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}

export function MediaGridSkeleton({
  items = 12,
  className = "",
  showMetaRows = true,
  ariaLabel,
}: MediaGridSkeletonProps) {
  return (
    <section
      aria-busy="true"
      aria-label={ariaLabel}
      className={[
        "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
        className,
      ].filter(Boolean).join(" ")}
    >
      {Array.from({ length: items }).map((_, index) => (
        <SkeletonCard key={index} showMetaRows={showMetaRows} />
      ))}
    </section>
  );
}
