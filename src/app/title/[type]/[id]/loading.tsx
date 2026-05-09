export default function TitleLoading() {
  return (
    <main className="min-h-screen bg-[#020617] text-white">
      {/* Backdrop skeleton */}
      <div className="absolute inset-x-0 top-0 h-[55vh] animate-pulse bg-white/[0.04]" />

      <div className="relative mx-auto max-w-[1200px] px-6 pt-[38vh] pb-16 md:px-10">
        <div className="flex flex-col gap-8 md:flex-row md:items-end">
          {/* Poster skeleton */}
          <div className="h-[210px] w-[140px] shrink-0 animate-pulse rounded-xl bg-white/[0.07] md:h-[330px] md:w-[220px]" />

          <div className="flex flex-1 flex-col gap-3">
            <div className="h-4 w-32 animate-pulse rounded-full bg-white/[0.06]" />
            <div className="h-10 w-3/4 animate-pulse rounded-xl bg-white/[0.08]" />
            <div className="h-4 w-48 animate-pulse rounded-full bg-white/[0.05]" />
            <div className="mt-2 h-4 w-full animate-pulse rounded-full bg-white/[0.04]" />
            <div className="h-4 w-5/6 animate-pulse rounded-full bg-white/[0.04]" />
            <div className="h-4 w-4/5 animate-pulse rounded-full bg-white/[0.03]" />
          </div>
        </div>
      </div>
    </main>
  );
}
